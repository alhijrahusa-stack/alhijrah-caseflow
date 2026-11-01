import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import { getImportCase, saveImportReview, stageSheetRows } from "@/lib/smart-client-import";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });
let manager: StaffSession;

beforeAll(async () => {
  const authId = randomUUID(), email = `revision-${authId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id,active)
    values(${`TEST Revision ${authId}`},${email},'manager',${authId},true) returning id,display_name,email,role`;
  manager = { authUserId: authId, staff: staff as StaffSession["staff"] };
});
afterAll(async () => { await db.end(); });

describe("monotonic smart review revision", () => {
  it("increments on every update even when timestamps are equal and prevents assigning the counter", async () => {
    const staged = await stageSheetRows({ session: manager, source: "csv", idempotencyKey: randomUUID(), rows: [{ full_name: `TEST Revision ${randomUUID()}`, phone: "6165510221" }] });
    const id = String(staged.cases[0].id);
    const initial = await getImportCase(manager, id);
    expect(initial.case.revision).toBe("1");
    const [first, second] = await db.begin(async tx => {
      const [a] = await tx`update client_import_cases set verification_result=verification_result where id=${id} returning revision::text as revision,updated_at::text as stamp`;
      const [b] = await tx`update client_import_cases set revision=999 where id=${id} returning revision::text as revision,updated_at::text as stamp`;
      return [a,b];
    });
    expect(first.stamp).toBe(second.stamp);
    expect(first.revision).toBe("2");
    expect(second.revision).toBe("3");
    await expect(saveImportReview(manager, { id, reviewerId: manager.staff.id, draft: initial.case.mapped_draft,
      documentConfirmed: false, informationConfirmed: false, expectedRevision: "2" })).rejects.toMatchObject({ code: "review_changed" });
  });

  it("serializes simultaneous edits and rejects the stale writer without overwriting the winner", async () => {
    const staged = await stageSheetRows({ session: manager, source: "csv", idempotencyKey: randomUUID(), rows: [{ full_name: `TEST Revision Race ${randomUUID()}`, phone: "6165510222" }] });
    const id = String(staged.cases[0].id);
    const detail = await getImportCase(manager, id);
    const left = structuredClone(detail.case.mapped_draft), right = structuredClone(detail.case.mapped_draft);
    left.profile.city = "Detroit"; right.profile.city = "Dearborn";
    const make = (draft: unknown) => saveImportReview(manager, { id, reviewerId: manager.staff.id, draft,
      documentConfirmed: false, informationConfirmed: false, expectedRevision: String(detail.case.revision) });
    const results = await Promise.allSettled([make(left),make(right)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find(result => result.status === "rejected");
    expect(failure).toMatchObject({ status: "rejected", reason: { code: "review_changed" } });
    const after = await getImportCase(manager, id);
    expect(after.case.revision).toBe("2");
    expect(after.case.mapped_draft.profile.city).toBe(results[0].status === "fulfilled" ? "Detroit" : "Dearborn");
  });
});
