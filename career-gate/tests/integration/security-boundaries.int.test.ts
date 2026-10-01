import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";

const db = sql();

afterAll(async () => {
  await db.end();
});

async function can(role: string, signature: string) {
  const [row] = await db`select has_function_privilege(${role}, ${signature}, 'EXECUTE') as ok`;
  return Boolean(row.ok);
}

describe("database SECURITY DEFINER boundaries", () => {
  it("does not expose Career Gate RLS helpers to anonymous callers", async () => {
    for (const fn of [
      "public.cg_staff_id()",
      "public.cg_staff_role()",
      "public.cg_can_access_client(uuid)",
      "public.cg_can_access_client_row(uuid,timestamp with time zone)",
      "public.cg_busy_intervals(text,timestamp with time zone,timestamp with time zone)",
    ]) {
      expect(await can("anon", fn), fn).toBe(false);
      expect(await can("authenticated", fn), fn).toBe(true);
    }
  });

  it("keeps generated identifiers usable by staff but not anonymous RPC callers", async () => {
    for (const fn of ["public.next_client_ref()", "public.next_staff_code()"]) {
      expect(await can("anon", fn), fn).toBe(false);
      expect(await can("authenticated", fn), fn).toBe(true);
    }
  });

  it("makes trigger-only functions non-callable by anon and authenticated", async () => {
    for (const fn of [
      "public.assign_client_round_robin()",
      "public.ensure_client_account()",
      "public.snapshot_payment_commission()",
    ]) {
      expect(await can("anon", fn), fn).toBe(false);
      expect(await can("authenticated", fn), fn).toBe(false);
    }
  });

  it("keeps enqueue_job restricted to authenticated staff/service execution", async () => {
    const fn = "public.enqueue_job(text,text,jsonb,text,text,integer,timestamp with time zone)";
    expect(await can("anon", fn)).toBe(false);
    expect(await can("authenticated", fn)).toBe(true);
    expect(await can("service_role", fn)).toBe(true);
  });
});

describe("canonical authorization rules", () => {
  it("preserves the established role behavior and fails closed", async () => {
    const rows = await db`
      select role,action,scope from permission_rules
       where (role,action) in (
         ('admin','create_staff'),('manager','create_staff'),('staff','create_staff'),
         ('manager','verify_document'),('staff','verify_document'),
         ('staff','add_note'),('staff','add_task'),('staff','mark_contacted')
       )`;
    const m = new Map(rows.map((r) => [`${r.role}:${r.action}`, r.scope]));
    expect(m.get("admin:create_staff")).toBe("ALL");
    expect(m.get("manager:create_staff")).toBe("NONE");
    expect(m.get("staff:create_staff")).toBe("NONE");
    expect(m.get("manager:verify_document")).toBe("ALL");
    expect(m.get("staff:verify_document")).toBe("NONE");
    expect(m.get("staff:add_note")).toBe("ASSIGNED");
    expect(m.get("staff:add_task")).toBe("ASSIGNED");
    expect(m.get("staff:mark_contacted")).toBe("ASSIGNED");
    const [{ n }] = await db`select count(*)::int n from permission_rules`;
    expect(n).toBeGreaterThan(100);
  });
});

describe("canonical workflow authority", () => {
  it("stores every status transition and default next action in the database", async () => {
    const [{ transitions }] = await db`select count(*)::int transitions from status_transitions`;
    const [{ rules }] = await db`select count(*)::int rules from workflow_status_rules where active`;
    const [{ missing }] = await db`
      select count(*)::int missing
      from (
        select from_status status from status_transitions
        union select to_status from status_transitions
      ) s
      left join workflow_status_rules r on r.status=s.status and r.active
      where r.status is null`;
    expect(transitions).toBeGreaterThan(0);
    expect(rules).toBe(15);
    expect(missing).toBe(0);
  });

  it("keeps entry states as database facts", async () => {
    const rows = await db`select status from status_entry_states order by status`;
    expect(rows.map((r) => r.status)).toEqual(["needs_review", "new_intake", "ready_to_apply"]);
  });
});
