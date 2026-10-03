import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

afterAll(async () => {
  await db.end();
});

describe("Smart Career Collect Client staging schema", () => {
  it("creates the three canonical staging tables with RLS enabled", async () => {
    const rows = await db`
      select c.relname as table_name, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('client_import_batches','client_import_cases','client_import_documents')
      order by c.relname`;
    expect(rows.map((r) => r.table_name)).toEqual(["client_import_batches", "client_import_cases", "client_import_documents"]);
    expect(rows.every((r) => r.rls === true)).toBe(true);
  });

  it("denies anonymous table access and keeps authenticated access policy-controlled", async () => {
    for (const table of ["client_import_batches", "client_import_cases", "client_import_documents"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const [{ allowed }] = await db`select has_table_privilege('anon', ${`public.${table}`}, ${privilege}) as allowed`;
        expect(allowed).toBe(false);
      }
      const [{ canSelect }] = await db`select has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as "canSelect"`;
      expect(canSelect).toBe(true);
    }
  });

  it("publishes only the case status surface needed by Realtime", async () => {
    const rows = await db`
      select tablename from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename in ('client_import_batches','client_import_cases','client_import_documents')`;
    expect(rows.map((r) => r.tablename)).toEqual(["client_import_cases"]);
  });

  it("enforces the exact import status set", async () => {
    const [{ definition }] = await db`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid='public.client_import_cases'::regclass and contype='c'
        and pg_get_constraintdef(oid) ilike '%PENDING%UNDER_REVIEW%MISSING_DOCUMENT%APPROVED_FILE%'
      limit 1`;
    expect(String(definition)).toContain("PENDING");
    expect(String(definition)).toContain("UNDER_REVIEW");
    expect(String(definition)).toContain("MISSING_DOCUMENT");
    expect(String(definition)).toContain("APPROVED_FILE");
  });
});
