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
