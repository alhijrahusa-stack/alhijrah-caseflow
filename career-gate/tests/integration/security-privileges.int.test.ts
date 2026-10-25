import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { REALTIME_ENTITIES } from "@/lib/realtime-resources";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

const matrix = [
  { table: "client_accounts", authenticated: ["SELECT", "INSERT", "UPDATE"] },
  { table: "requirements", authenticated: ["SELECT", "INSERT", "UPDATE"] },
  { table: "payment_transactions", authenticated: ["SELECT", "INSERT"] },
  { table: "commission_rules", authenticated: ["SELECT"] },
  { table: "commissions", authenticated: ["SELECT", "INSERT", "UPDATE"] },
  { table: "assignment_settings", authenticated: ["SELECT", "UPDATE"] },
  { table: "ownership_transfer_requests", authenticated: ["SELECT", "INSERT", "UPDATE"] },
  { table: "pipeline_stages", authenticated: ["SELECT"] },
] as const;

const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

afterAll(async () => {
  await db.end();
});

describe("Career Gate least-privilege table grants", () => {
  for (const entry of matrix) {
    it(`${entry.table} denies anon and grants authenticated only the intended capabilities`, async () => {
      for (const privilege of privileges) {
        const [{ allowed: anonAllowed }] = await db`
          select has_table_privilege('anon', ${`public.${entry.table}`}, ${privilege}) as allowed`;
        expect(anonAllowed).toBe(false);

        const [{ allowed: authenticatedAllowed }] = await db`
          select has_table_privilege('authenticated', ${`public.${entry.table}`}, ${privilege}) as allowed`;
        expect(authenticatedAllowed).toBe(entry.authenticated.includes(privilege as never));
      }
    });
  }

  it("enforces RLS on every operational table streaming staff data", async () => {
    const rows = await db`
      select c.relname as table_name, c.relrowsecurity as enabled
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ${db(REALTIME_ENTITIES)}
        and c.relkind in ('r', 'p')`;
    expect(rows).toHaveLength(REALTIME_ENTITIES.length);
    for (const row of rows) expect(row.enabled, row.table_name).toBe(true);
  });

  it("publishes every client/dashboard realtime entity without silently missing a table", async () => {
    const published = await db`
      select tablename from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'`;
    const names = new Set(published.map((row) => String(row.tablename)));
    for (const table of REALTIME_ENTITIES) expect(names.has(table), table).toBe(true);
  });

  it("requires an authorized client scope for BOTH account INSERT and UPDATE row checks", async () => {
    const policies = await db`
      select policyname, cmd, qual, with_check
      from pg_policies
      where schemaname = 'public' and tablename = 'client_accounts'
        and policyname in ('accounts_insert', 'accounts_update')
      order by policyname`;
    expect(policies).toHaveLength(2);
    for (const policy of policies) {
      expect(policy.with_check).toContain("cg_staff_role()");
      expect(policy.with_check).toContain("cg_can_access_client(client_id)");
      if (policy.cmd === "UPDATE") {
        expect(policy.qual).toContain("cg_staff_role()");
        expect(policy.qual).toContain("cg_can_access_client(client_id)");
      } else {
        expect(policy.cmd).toBe("INSERT");
      }
    }
  });

  it("keeps the email outbox server-only", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      for (const privilege of privileges) {
        const [{ allowed }] = await db`
          select has_table_privilege(${role}, 'public.career_gate_email_outbox', ${privilege}) as allowed`;
        expect(allowed).toBe(false);
      }
    }
  });

  it("keeps Career Gate SECURITY DEFINER helpers unavailable to anon", async () => {
    const signatures = [
      "public.cg_staff_id()",
      "public.cg_staff_role()",
      "public.cg_can_access_client(uuid)",
      "public.cg_can_access_client_row(uuid,timestamp with time zone)",
      "public.cg_busy_intervals(text,timestamp with time zone,timestamp with time zone)",
      "public.enqueue_job(text,text,jsonb,text,text,integer,timestamp with time zone)",
      "public.next_client_ref()",
      "public.next_staff_code()",
      "public.cg_update_staff_permissions(uuid,text,text[],timestamp with time zone,text)",
    ];
    for (const signature of signatures) {
      const [{ allowed }] = await db`
        select has_function_privilege('anon', ${signature}, 'EXECUTE') as allowed`;
      expect(allowed).toBe(false);
    }
  });

  it("exposes the audited B3 permission update helper only to authenticated callers", async () => {
    const signature = "public.cg_update_staff_permissions(uuid,text,text[],timestamp with time zone,text)";
    const [{ anon_allowed: anonAllowed, authenticated_allowed: authenticatedAllowed }] = await db`
      select
        has_function_privilege('anon', ${signature}, 'EXECUTE') as anon_allowed,
        has_function_privilege('authenticated', ${signature}, 'EXECUTE') as authenticated_allowed`;
    expect(anonAllowed).toBe(false);
    expect(authenticatedAllowed).toBe(true);
  });
});
