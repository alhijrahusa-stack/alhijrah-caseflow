import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import { operationalAnswer } from "@/lib/operational-assistant";
import { OFFICE } from "@/lib/office";
import { G3_STAGES } from "@/lib/g3-stages";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
let manager: StaffSession;
let staff: StaffSession;
async function actor(role: "manager" | "staff"): Promise<StaffSession> {
  const id = randomUUID();
  const email = `assistant-${id}@test.invalid`;
  await db`insert into auth.users(id,email) values(${id},${email})`;
  const [member] = await db`insert into staff(display_name,email,role,auth_user_id) values(${`TEST Operations Assistant ${role} ${id}`},${email},${role},${id}) returning id,display_name,email,role`;
  return { authUserId: id, staff: member as StaffSession["staff"] };
}
beforeAll(async () => { manager = await actor("manager"); staff = await actor("staff"); });
afterAll(async () => { await db.end(); });

describe("read-only operational assistant against PostgreSQL with RLS", () => {
  it("rejects ordinary staff before accessing management analytics", async () => {
    await expect(operationalAnswer(staff, "Who passed this month and has not paid?")).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });
  it("counts latest passed outcomes this office month against actual unpaid ledger balances", async () => {
    const answer = await operationalAnswer(manager, "Who passed this month and has not paid?");
    const [reference] = await withStaff(manager, (tx) => tx`select count(*)::int count,coalesce(sum(greatest(b.balance,0)),0)::numeric amount
      from clients c join client_account_balances b on b.client_id=c.id
      join lateral(select decision,recorded_at from appointment_outcomes where client_id=c.id order by recorded_at desc,appointment_id desc limit 1)o on true
      where c.deleted_at is null and c.current_status<>'cancelled' and b.balance>0 and o.decision='pass'
      and (o.recorded_at at time zone ${OFFICE.timeZone})::date>=date_trunc('month',now() at time zone ${OFFICE.timeZone})::date`);
    expect(answer.facts[0].value).toBe(reference.count);
    expect(answer.facts[1].value).toBeCloseTo(Number(reference.amount), 2);
    expect(answer.links.length).toBeLessThanOrEqual(5);
  });
  it("counts only the newest uploaded document of each type and excludes completed or cancelled clients", async () => {
    const answer = await operationalAnswer(manager, "Which documents need attention?");
    const [reference] = await withStaff(manager, (tx) => tx`with ranked as(
      select d.*,row_number() over(partition by client_id,doc_type order by uploaded_at desc,id desc) rank from documents d)
      select count(distinct c.id)::int count from clients c join ranked d on d.client_id=c.id
      where c.deleted_at is null and c.current_status not in('completed','cancelled') and d.rank=1 and d.status in('needs_review','needs_reupload','rejected')`);
    expect(answer.facts[0].value).toBe(reference.count);
  });
  it("returns actual six-stage queue membership and withholds projections below the sample threshold", async () => {
    const answer = await operationalAnswer(manager, "Where is the workflow bottleneck?");
    expect(answer.forecast).toHaveLength(5);
    for (const stage of G3_STAGES.filter((item) => item.id !== "registry")) {
      const [reference] = await withStaff(manager, (tx) => tx`select count(*)::int count from clients where deleted_at is null and current_status=any(${[...stage.statuses]})`);
      const row = answer.forecast!.find((item) => item.stage === stage.id)!;
      expect(row.queued).toBe(reference.count);
      if (row.exits_28d < 5) expect(row.estimated_clearance_days).toBeNull();
    }
    expect(answer.method).toContain("not missed deadlines");
  });
});
