import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { confirmEmployment, currentEmploymentConfirmation, employmentConfirmationHistory } from "@/lib/employment-registry";
import type { EmploymentConfirmationCommand } from "@/lib/employment-registry-schema";
import { todayInOffice } from "@/lib/format";
import { moveWorkflowClient } from "@/lib/manual-workflow";
import { submitManagerReview } from "@/lib/manager-inbox";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { executeWorksiteChange } from "@/lib/worksite-changes";
import { WORKSITE_OPTIONS } from "@/lib/worksite-change-schema";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";

const db = sql(), trace = "employment-registry-integration";
let owner: StaffSession, outsider: StaffSession, manager: StaffSession;
let serial = 9300;
async function member(role: "staff" | "manager") {
  const authUserId = randomUUID(), email = `employment-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [staff] = await db`insert into staff(display_name,email,role,auth_user_id)
    values(${`TEST Employment ${role} ${authUserId}`},${email},${role},${authUserId}) returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}
async function client() {
  serial++;
  return db.begin(tx => insertClient(tx, {
    source: "staff_manual", profile: ProfileSchema.parse({ full_name: `TEST Employment Applicant ${serial}`, phone: `313555${serial}`, email: `employment-applicant-${serial}@test.invalid`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: owner.staff.id, createdBy: manager.staff.id, communicationConsent: true,
  }, { staffId: manager.staff.id, traceId: trace }));
}
async function move(as: StaffSession, id: string, destination: ClientStageFilter) {
  return withStaff(as, async tx => {
    const [row] = await tx`select id,current_status,pipeline_stage,next_step from clients where id=${id} for update`;
    return moveWorkflowClient(tx, as, row as {id:string;current_status:string;pipeline_stage:string;next_step:string}, destination, "Employment integration workflow", trace);
  });
}
const version = async (id: string) => String((await db`select updated_at::text value from clients where id=${id}`)[0].value);
const actual = (offset = -1) => { const d = new Date(`${todayInOffice()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0,10); };
const command = async (clientId: string, patch: Partial<EmploymentConfirmationCommand> = {}): Promise<EmploymentConfirmationCommand> => ({
  client_id: clientId, operation_id: randomUUID(), expected_updated_at: await version(clientId), actual_start_date: actual(), site_code: WORKSITE_OPTIONS[0].code, confirmation: true, ...patch,
});
const current = (as: StaffSession, id: string) => withStaff(as, tx => currentEmploymentConfirmation(tx, id));

beforeAll(async () => { owner = await member("staff"); outsider = await member("staff"); manager = await member("manager"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await db.end(); });

describe("actual employment registry keeps evidence separate from planned dates", () => {
  it("keeps legacy completed files unconfirmed and confirms the original without overwriting its planned start", async () => {
    const c = await client();
    const planned = actual(20);
    await db`update clients set start_date=${planned} where id=${c.id}`;
    await move(owner, c.id, "completed");
    expect(await current(owner, c.id)).toBeNull();
    const input = await command(c.id);
    const before = Date.now();
    const result = await confirmEmployment(owner, input, trace);
    expect(result).toMatchObject({ changed: true, confirmation: { client_id: c.id, actual_start_date: actual(), site_code: WORKSITE_OPTIONS[0].code, confirmed_by: owner.staff.id, confirmed_by_name: owner.staff.display_name, worksite_change_id: null } });
    expect(new Date(result.confirmation.confirmed_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await db`select start_date,operational_location from clients where id=${c.id}`)[0]).toMatchObject({ start_date: planned, operational_location: "completed" });
    expect(result.client_version).not.toBe(input.expected_updated_at);
    expect((await db`select count(*)::int count from clients where id=${c.id}`)[0].count).toBe(1);
    const sameKey = await confirmEmployment(owner, input, trace);
    expect(sameKey).toEqual(result);
    const anotherKey = await confirmEmployment(owner, await command(c.id), trace);
    expect(anotherKey.changed).toBe(false);
    expect((await employmentConfirmationHistory(owner, c.id))).toHaveLength(1);
    await expect(confirmEmployment(owner, await command(c.id, {actual_start_date: actual(-2)}), trace)).rejects.toMatchObject({ code: "employment_already_confirmed" });
  });

  it("requires valid past/present dates, affirmative confirmation, matching versions and current permissions", async () => {
    const c = await client();
    await expect(confirmEmployment(owner, await command(c.id, {actual_start_date: actual(1)}), trace)).rejects.toMatchObject({ code: "actual_start_in_future" });
    await expect(confirmEmployment(owner, await command(c.id, {actual_start_date: "2026-02-31"}), trace)).rejects.toThrow();
    await expect(confirmEmployment(owner, await command(c.id, {confirmation: false as true}), trace)).rejects.toThrow();
    const stale = await command(c.id);
    await db`update clients set next_step='Changed while reviewing employment' where id=${c.id}`;
    await expect(confirmEmployment(owner, stale, trace)).rejects.toMatchObject({ code: "client_changed" });
    await db`update staff set permission_mode='custom',custom_permissions='{}' where id=${owner.staff.id}`;
    try { await expect(confirmEmployment(owner, await command(c.id), trace)).rejects.toMatchObject({ code: "42501" }); }
    finally { await db`update staff set permission_mode='full',custom_permissions='{}' where id=${owner.staff.id}`; }
    expect((await employmentConfirmationHistory(manager, c.id))).toHaveLength(0);
  });

  it("enforces client scope and manager custody without creating a partial certificate", async () => {
    const c = await client();
    await expect(confirmEmployment(outsider, await command(c.id), trace)).rejects.toMatchObject({ code: "not_found" });
    expect(await current(outsider, c.id)).toBeNull();
    await submitManagerReview(owner, { kind: "client", client_id: c.id, note: "Review actual employment first", request_key: randomUUID() }, trace);
    await expect(confirmEmployment(owner, await command(c.id), trace)).rejects.toMatchObject({ code: "manager_review_pending" });
    await expect(confirmEmployment(manager, await command(c.id), trace)).rejects.toMatchObject({ code: "manager_review_pending" });
    expect((await db`select count(*)::int count from employment_confirmations where client_id=${c.id}`)[0].count).toBe(0);
    expect((await db`select operational_location from clients where id=${c.id}`)[0].operational_location).toBe("manager");
  });

  it("prevents Data API forgery, editing or deleting historical confirmations", async () => {
    const c = await client();
    await expect(withStaff(owner, tx => tx`insert into employment_confirmations(client_id,actual_start_date,site_code,site_name,confirmed_by,confirmed_by_name,operation_id)
      values(${c.id},${actual()},${WORKSITE_OPTIONS[0].code},${WORKSITE_OPTIONS[0].name},${owner.staff.id},'Forged actor',${randomUUID()})`)).rejects.toMatchObject({ code: "42501" });
    const result = await confirmEmployment(owner, await command(c.id), trace);
    await expect(db`update employment_confirmations set actual_start_date=${actual(-3)} where id=${result.confirmation.id}`).rejects.toMatchObject({ code: "42501" });
    await expect(db`delete from employment_confirmations where id=${result.confirmation.id}`).rejects.toMatchObject({ code: "42501" });
    expect((await employmentConfirmationHistory(owner, c.id))[0]).toMatchObject({ actual_start_date: actual(), confirmed_by_name: owner.staff.display_name });
  });

  it("allows only one of two conflicting staff/manager confirmations", async () => {
    const c = await client(), input = await command(c.id);
    const results = await Promise.allSettled([
      confirmEmployment(owner, input, trace),
      confirmEmployment(manager, {...input, operation_id: randomUUID()}, trace),
    ]);
    expect(results.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(value => value.status === "rejected")).toHaveLength(1);
    const rejected = results.find(value => value.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "client_changed" });
    expect((await db`select count(*)::int count from employment_confirmations where client_id=${c.id}`)[0].count).toBe(1);
  });

  it("retains previous actual employment history while a new relocation needs its own actual-start attestation", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_FROM_EMAIL", "");
    const c = await client();
    const old = await confirmEmployment(owner, await command(c.id, {actual_start_date: actual(-10)}), trace);
    await move(owner, c.id, "worksite_change");
    expect(await current(owner, c.id)).toBeNull();
    const newStart = actual(10);
    const changed = await executeWorksiteChange(owner, {operation:"confirm",client_id:c.id,operation_id:randomUUID(),expected_updated_at:await version(c.id),
      current_site_code:WORKSITE_OPTIONS[0].code,requested_site_code:WORKSITE_OPTIONS[1].code,final_site_code:WORKSITE_OPTIONS[1].code,
      shift_days:"Wednesday – Saturday",shift_start:"18:30",shift_end:"05:00",new_start_date:newStart,confirmed_at:new Date().toISOString()}, trace);
    await move(owner, c.id, "completed");
    expect(await current(owner, c.id)).toBeNull();
    await expect(confirmEmployment(owner, await command(c.id), trace)).rejects.toMatchObject({ code: "worksite_mismatch" });
    const next = await confirmEmployment(owner, await command(c.id, {site_code:WORKSITE_OPTIONS[1].code}), trace);
    expect(next.confirmation.worksite_change_id).toBe(changed.row!.id);
    expect(next.confirmation.site_code).toBe(WORKSITE_OPTIONS[1].code);
    expect((await employmentConfirmationHistory(owner, c.id))).toHaveLength(2);
    expect((await employmentConfirmationHistory(owner, c.id)).find(row => row.id===old.confirmation.id)).toMatchObject({actual_start_date:actual(-10),site_code:WORKSITE_OPTIONS[0].code});
    expect((await db`select start_date from clients where id=${c.id}`)[0].start_date).toBe(newStart);
    expect((await current(owner, c.id))?.id).toBe(next.confirmation.id);
    const [precision] = await db`select e.worksite_recorded_at=w.recorded_at exact_context from employment_confirmations e
      join worksite_changes w on w.id=e.worksite_change_id where e.id=${next.confirmation.id}`;
    expect(precision.exact_context).toBe(true);
  });

  it("permits an explicit current-site attestation after routing out of a pending relocation, and invalidates it when that relocation is later confirmed", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_FROM_EMAIL", "");
    const c = await client();
    await confirmEmployment(owner, await command(c.id, {actual_start_date:actual(-10)}), trace);
    await move(owner, c.id, "worksite_change");
    const saved = await executeWorksiteChange(owner, {operation:"save_request",client_id:c.id,operation_id:randomUUID(),expected_updated_at:await version(c.id),
      current_site_code:WORKSITE_OPTIONS[0].code,requested_site_code:WORKSITE_OPTIONS[1].code}, trace);
    await expect(confirmEmployment(owner, await command(c.id), trace)).rejects.toMatchObject({code:"worksite_confirmation_required"});
    await move(owner, c.id, "completed");
    expect(await current(owner, c.id)).toBeNull();
    await expect(confirmEmployment(owner, await command(c.id, {site_code:WORKSITE_OPTIONS[1].code}), trace)).rejects.toMatchObject({code:"worksite_mismatch"});
    const originalSite = await confirmEmployment(owner, await command(c.id), trace);
    expect(originalSite.confirmation).toMatchObject({site_code:WORKSITE_OPTIONS[0].code,worksite_change_id:saved.row!.id,worksite_recorded_at:null});
    expect((await current(owner, c.id))?.id).toBe(originalSite.confirmation.id);
    await move(owner, c.id, "worksite_change");
    await executeWorksiteChange(owner, {operation:"save_request",client_id:c.id,operation_id:randomUUID(),expected_updated_at:await version(c.id),
      current_site_code:WORKSITE_OPTIONS[2].code,requested_site_code:WORKSITE_OPTIONS[1].code}, trace);
    await move(owner, c.id, "completed");
    // The same pending row can be edited without recorded_at changing. Its old
    // current-site attestation must not become current again after routing out.
    expect(await current(owner, c.id)).toBeNull();
    await move(owner, c.id, "worksite_change");
    await executeWorksiteChange(owner, {operation:"confirm",client_id:c.id,operation_id:randomUUID(),expected_updated_at:await version(c.id),
      current_site_code:WORKSITE_OPTIONS[2].code,requested_site_code:WORKSITE_OPTIONS[1].code,final_site_code:WORKSITE_OPTIONS[1].code,
      shift_days:"Wednesday – Saturday",shift_start:"18:30",shift_end:"05:00",new_start_date:actual(10),confirmed_at:new Date().toISOString()}, trace);
    await move(owner, c.id, "completed");
    expect(await current(owner, c.id)).toBeNull();
    const finalSite = await confirmEmployment(owner, await command(c.id, {site_code:WORKSITE_OPTIONS[1].code}), trace);
    expect(finalSite.confirmation.worksite_recorded_at).not.toBeNull();
    expect((await employmentConfirmationHistory(owner, c.id))).toHaveLength(3);
    expect((await current(owner, c.id))?.id).toBe(finalSite.confirmation.id);
  });

  it("preserves the recorded worksite name and address when the directory changes before actual employment is confirmed", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_FROM_EMAIL", "");
    const c = await client(); await move(owner, c.id, "worksite_change");
    const option = WORKSITE_OPTIONS[1], originalName = option.name, originalAddress = option.address;
    try {
      option.name = "TEST Recorded worksite snapshot";
      option.address = "123 TEST Historical Address, Michigan";
      await executeWorksiteChange(owner, {operation:"confirm",client_id:c.id,operation_id:randomUUID(),expected_updated_at:await version(c.id),
        current_site_code:WORKSITE_OPTIONS[0].code,requested_site_code:option.code,final_site_code:option.code,
        shift_days:"Wednesday – Saturday",shift_start:"18:30",shift_end:"05:00",new_start_date:actual(10),confirmed_at:new Date().toISOString()}, trace);
    } finally { option.name = originalName; option.address = originalAddress; }
    const result = await confirmEmployment(owner, await command(c.id, {site_code:option.code}), trace);
    expect(result.confirmation).toMatchObject({site_name:"TEST Recorded worksite snapshot",site_address:"123 TEST Historical Address, Michigan"});
    expect((await current(owner, c.id))?.id).toBe(result.confirmation.id);
  });
});
