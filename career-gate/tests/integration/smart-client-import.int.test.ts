import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

const tables = ["client_import_batches", "client_import_cases", "client_import_documents"] as const;
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

afterAll(async () => { await db.end(); });

describe("Smart Career Collect Client staging security", () => {
  it("creates all three staging tables with RLS enabled", async () => {
    for (const table of tables) {
      const [row] = await db`
        select c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=${table}`;
      expect(row?.rls).toBe(true);
    }
  });

  it("denies direct anon/authenticated table privileges", async () => {
    for (const table of tables) {
      for (const role of ["anon", "authenticated"] as const) {
        for (const privilege of privileges) {
          const [{ allowed }] = await db`select has_table_privilege(${role}, ${`public.${table}`}, ${privilege}) as allowed`;
          expect(allowed).toBe(false);
        }
      }
    }
  });

  it("enforces the exact four import statuses", async () => {
    const [row] = await db`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid='public.client_import_cases'::regclass and conname='client_import_cases_status_check'`;
    expect(String(row?.definition)).toContain("PENDING");
    expect(String(row?.definition)).toContain("UNDER_REVIEW");
    expect(String(row?.definition)).toContain("MISSING_DOCUMENT");
    expect(String(row?.definition)).toContain("APPROVED_FILE");
  });

  it("keeps field evidence in the existing staging model", async () => {
    const rows = await db`
      select column_name,data_type
      from information_schema.columns
      where table_schema='public' and table_name='client_import_cases'
        and column_name in ('mapped_draft','field_evidence','reviewer_id','reviewed_at')
      order by column_name`;
    expect(rows.map((row) => row.column_name)).toEqual(["field_evidence", "mapped_draft", "reviewed_at", "reviewer_id"]);
    expect(rows.find((row) => row.column_name === "field_evidence")?.data_type).toBe("jsonb");
  });

  it("stores English proficiency additively on the canonical Client", async () => {
    const [column] = await db`
      select data_type,is_nullable
      from information_schema.columns
      where table_schema='public' and table_name='clients' and column_name='english_proficiency'`;
    expect(column?.data_type).toBe("text");
    expect(column?.is_nullable).toBe("YES");
    const [constraint] = await db`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid='public.clients'::regclass and conname='clients_english_proficiency_check'`;
    const definition = String(constraint?.definition);
    for (const value of ["EXCELLENT","GOOD","FAIR","WEAK","NONE"]) expect(definition).toContain(value);
  });
});