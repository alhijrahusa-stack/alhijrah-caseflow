import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261025021641_trusted_profile_role_claims.sql"),
  "utf8",
);

describe("trusted profile role provisioning", () => {
  it("rejects client-supplied admin roles while preserving authorized app metadata roles", async () => {
    await expect(db.begin(async (tx) => {
      await tx.unsafe("CREATE TYPE public.user_role AS ENUM ('seeker','employer','employer_member','recruiter','moderator','admin')");
      await tx.unsafe("CREATE TABLE public.profiles (id uuid PRIMARY KEY, phone text, email text, role public.user_role NOT NULL DEFAULT 'seeker')");
      await tx.unsafe(`CREATE TABLE public.cg_auth_role_fixture (
        id uuid PRIMARY KEY, phone text, email text,
        raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
      )`);
      await tx.unsafe("CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$");
      await tx.unsafe(migration);
      await tx.unsafe(`CREATE TRIGGER cg_profile_role_fixture_insert
        AFTER INSERT ON public.cg_auth_role_fixture
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`);

      const userSuppliedAdmin = randomUUID();
      const trustedEmployer = randomUUID();
      const malformedTrustedRole = randomUUID();
      await tx`INSERT INTO public.cg_auth_role_fixture (id, email, raw_user_meta_data)
        VALUES (${userSuppliedAdmin}, 'untrusted-role@test.invalid', '{"role":"admin"}'::jsonb)`;
      await tx`INSERT INTO public.cg_auth_role_fixture (id, email, raw_user_meta_data, raw_app_meta_data)
        VALUES (${trustedEmployer}, 'trusted-role@test.invalid', '{"role":"admin"}'::jsonb, '{"role":"employer"}'::jsonb)`;
      await tx`INSERT INTO public.cg_auth_role_fixture (id, email, raw_app_meta_data)
        VALUES (${malformedTrustedRole}, 'invalid-role@test.invalid', '{"role":"injected"}'::jsonb)`;

      const rows = await tx`SELECT id, role::text AS role FROM public.profiles
        WHERE id IN (${userSuppliedAdmin}, ${trustedEmployer}, ${malformedTrustedRole})`;
      const roleFor = (id: string) => String(rows.find(row => String(row.id) === id)?.role);
      expect(roleFor(userSuppliedAdmin)).toBe("seeker");
      expect(roleFor(trustedEmployer)).toBe("employer");
      expect(roleFor(malformedTrustedRole)).toBe("seeker");
      const [permissions] = await tx`SELECT
        has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') AS anon,
        has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') AS authenticated`;
      expect(permissions).toMatchObject({ anon: false, authenticated: false });
      throw new Error("ROLLBACK_ROLE_FIXTURE");
    })).rejects.toThrow("ROLLBACK_ROLE_FIXTURE");
  });
});
