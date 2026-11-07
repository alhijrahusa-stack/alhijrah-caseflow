import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as readInbox } from "@/app/api/staff/manager-inbox/route";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { applyAccountDiscount } from "@/lib/accounting-ledger";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { managerInbox, resolveManagerReview, submitManagerReview } from "@/lib/manager-inbox";
import { moveWorkflowClient } from "@/lib/manual-workflow";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));
const db = sql();
const trace = "manager-payment-issues";
let manager: StaffSession;
let owner: StaffSession;
let serial = 7100;

async function member(role: "manager" | "staff"): Promise<StaffSession> {
  const authUserId = randomUUID();
  const email = `payment-issues-${role}-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id)
    values(${`TEST Payment Issues ${role}`},${email},${role},${authUserId}) returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}
async function file(group: string, stage: ClientStageFilter = "new_intake") {
  const item = await db.begin(tx => insertClient(tx, {
    source: "staff_manual",
    profile: ProfileSchema.parse({ full_name: `TEST Payment ${group} ${++serial}`, phone: `7349${String(serial).padStart(6, "0")}`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null,
    assignedStaff: owner.staff.id, createdBy: manager.staff.id, communicationConsent: false,
  }, { staffId: manager.staff.id, traceId: trace }));
  if (stage !== "new_intake") await withStaff(manager, async tx => {
    const [current] = await tx`select id,current_status,pipeline_stage,next_step from clients where id=${item.id} for update`;
    await moveWorkflowClient(tx, manager, current as { id: string; current_status: string; pipeline_stage: string; next_step: string }, stage, "Payment issue fixture", trace);
  });
  return item;
}
async function review(clientId: string, relatedId?: string) {
  return submitManagerReview(owner, { kind: "client", client_id: clientId, related_client_id: relatedId, request_key: randomUUID(), note: "Payment issue regression" }, trace);
}
async function payment(clientId: string, amount: number, status: "confirmed" | "pending" = "confirmed") {
  return withStaff(manager, async tx => {
    const [account] = await tx`select id from client_accounts where client_id=${clientId}`;
    expect(account?.id).toBeTruthy();
    await tx`insert into payment_transactions(account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,source,recorded_by,idempotency_key)
      values(${account.id},${clientId},'payment','credit',${amount},${status},'cash',now(),'staff',${manager.staff.id},${randomUUID()})`;
  });
}
const issueCount = async () => (await managerInbox(manager)).summary.payment_issues;

beforeAll(async () => { manager = await member("manager"); owner = await member("staff"); });
afterAll(async () => { await db.end(); });

describe("manager Payment Issues uses pending review cases and actual balances", () => {
  it("excludes default intake fees, settled and fully discounted accounts; includes actual outstanding post-interview balances", async () => {
    const group = randomUUID();
    const before = await issueCount();
    const intake = await file(group);
    const due = await file(group, "payment_required");
    const paperwork = await file(group, "paperwork_pending");
    const completed = await file(group, "completed");
    const paid = await file(group, "payment_required");
    const partial = await file(group, "payment_required");
    const unconfirmed = await file(group, "payment_required");
    const waived = await file(group, "payment_required");
    await payment(paid.id, 150);
    await payment(partial.id, 25);
    await payment(unconfirmed.id, 150, "pending");
    await withStaff(manager, tx => applyAccountDiscount(tx, { clientId: waived.id, discountType: "percentage", discountValue: 100, reason: "Full fee waiver fixture", staffId: manager.staff.id, traceId: trace }));
    const items = [intake, due, paperwork, completed, paid, partial, unconfirmed, waived];
    const reviews = await Promise.all(items.map(item => review(item.id)));
    const expected = [reviews[1].id, reviews[2].id, reviews[3].id, reviews[5].id, reviews[6].id].sort();
    const filtered = await managerInbox(manager, 1, { payments: true, q: group });
    expect(filtered.total).toBe(5);
    expect(filtered.items.map(item => item.id).sort()).toEqual(expected);
    expect(filtered.items.every(item => item.is_payment_issue)).toBe(true);
    expect(filtered.summary.payment_issues).toBe(before + 5);
    const all = await managerInbox(manager, 1, { q: group });
    expect(all.total).toBe(8);
    expect(all.items.filter(item => item.is_payment_issue).map(item => item.id).sort()).toEqual(expected);
    expect((await db`select operational_location from clients where id=${due.id}`)[0].operational_location).toBe("manager");
  });

  it("counts one duplicate-review case even when both attached files have unpaid balances", async () => {
    const group = randomUUID();
    const before = await issueCount();
    const primary = await file(group, "payment_required");
    const related = await file(group, "paperwork_pending");
    const item = await review(primary.id, related.id);
    const filtered = await managerInbox(manager, 1, { payments: true, q: group });
    expect(filtered.total).toBe(1);
    expect(filtered.summary.payment_issues).toBe(before + 1);
    expect(filtered.items[0]).toMatchObject({ id: item.id, related_client_id: related.id, is_payment_issue: true });
  });

  it("finds an issue on the related file without requiring the primary record to be payable", async () => {
    const group = randomUUID();
    const before = await issueCount();
    const primary = await file(group);
    const related = await file(group, "payment_required");
    const item = await review(primary.id, related.id);
    const filtered = await managerInbox(manager, 1, { payments: true, q: group });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].id).toBe(item.id);
    expect(filtered.summary.payment_issues).toBe(before + 1);
  });

  it("updates both the badge and filtered list when the real ledger settles while the manager retains the file", async () => {
    const group = randomUUID();
    const client = await file(group, "payment_required");
    const item = await review(client.id);
    const before = await issueCount();
    expect((await managerInbox(manager, 1, { payments: true, q: group })).total).toBe(1);
    await payment(client.id, 150);
    const filtered = await managerInbox(manager, 1, { payments: true, q: group });
    expect(filtered.total).toBe(0);
    expect(filtered.summary.payment_issues).toBe(before - 1);
    const unfiltered = await managerInbox(manager, 1, { q: group });
    expect(unfiltered.items[0]).toMatchObject({ id: item.id, status: "open", is_payment_issue: false });
    expect((await db`select operational_location from clients where id=${client.id}`)[0].operational_location).toBe("manager");
  });

  it("removes a resolved review from the attention count while preserving its read-only history", async () => {
    const group = randomUUID();
    const client = await file(group, "payment_required");
    const item = await review(client.id);
    const before = await issueCount();
    const [current] = await db`select updated_at::text version from clients where id=${client.id}`;
    await resolveManagerReview(manager, { id: item.id, destination: "keep_current", note: "Payment reviewed", expected_client_version: String(current.version), operation_id: randomUUID() }, trace);
    expect(await issueCount()).toBe(before - 1);
    const history = await managerInbox(manager, 1, { status: "resolved", q: group });
    expect(history.items[0]).toMatchObject({ id: item.id, status: "resolved", is_payment_issue: false });
    expect((await managerInbox(manager, 1, { status: "resolved", payments: true, q: group })).total).toBe(0);
  });

  it("keeps an Urgent related original visible and first in the manager priority queue", async () => {
    const group = randomUUID();
    const ordinary = await file(group);
    const ordinaryReview = await review(ordinary.id);
    const primary = await file(group);
    const related = await file(group, "urgent");
    const urgentReview = await review(primary.id, related.id);
    const filtered = await managerInbox(manager, 1, { urgent: true, q: group });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({ id: urgentReview.id, client_id: primary.id, related_client_id: related.id, is_urgent: true });
    const ranked = await managerInbox(manager, 1, { sort: "priority", q: group });
    expect(ranked.items.map(item => item.id)).toEqual([urgentReview.id, ordinaryReview.id]);
    expect(ranked.items[1].is_urgent).toBe(false);
    // Department occupancy remains exclusive: both originals are held at the
    // manager, so this case never adds a copy to the operational Urgent count.
    const [state] = await db`select operational_location from clients where id=${related.id}`;
    expect(state.operational_location).toBe("manager");
  });

  it("connects GET payments=1 to the financial filter and retains management-only authorization", async () => {
    const group = randomUUID();
    const due = await file(group, "payment_required");
    const intake = await file(group);
    const item = await review(due.id);
    await review(intake.id);
    vi.mocked(staffGuard).mockResolvedValue({ session: manager, response: null });
    const result = await readInbox(new Request(`http://localhost/api/staff/manager-inbox?payments=1&q=${group}`));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    const body = await result.json();
    expect(body.inbox.total).toBe(1);
    expect(body.inbox.items[0]).toMatchObject({ id: item.id, is_payment_issue: true });
    vi.mocked(staffGuard).mockResolvedValue({ session: owner, response: null });
    const denied = await readInbox(new Request("http://localhost/api/staff/manager-inbox?payments=1"));
    expect(denied.status).toBe(403);
  });
});
