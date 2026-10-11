import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import { publicImportStatus } from "@/lib/public-status";
import { stageMobileImportV2 } from "@/lib/smart-client-mobile";
import {
  approveImportCase,
  previewImportRows,
  saveImportReview,
  stageSheetRows,
  startImportReview,
  verifyImportCase,
} from "@/lib/smart-client-import";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

const tables = ["client_import_batches", "client_import_cases", "client_import_documents"] as const;
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

let manager: StaffSession;

beforeAll(async () => {
  const authId = randomUUID();
  await db`insert into auth.users (id,email) values (${authId},'smart-import-manager@test.invalid')`;
  const [staff] = await db`
    insert into staff (display_name,email,role,auth_user_id,active)
    values ('TEST Smart Import Manager','smart-import-manager@test.invalid','manager',${authId},true)
    returning id,display_name,email,role`;
  manager = { authUserId: authId, staff: staff as StaffSession["staff"] };
});

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

  it("stores the reviewed Smart preference fields canonically without forcing a default language", async () => {
    const rows = await db`
      select column_name,data_type,is_nullable,column_default
      from information_schema.columns
      where table_schema='public' and table_name='clients'
        and column_name in (
          'preferred_language','preferred_location','location_option_1','location_option_2',
          'shift_days','shift_start_time','shift_end_time'
        )
      order by column_name`;
    const byName = Object.fromEntries(rows.map((row) => [row.column_name, row]));
    expect(byName.preferred_language?.is_nullable).toBe("YES");
    expect(byName.preferred_language?.column_default).toBeNull();
    expect(byName.preferred_location?.data_type).toBe("text");
    expect(byName.location_option_1?.data_type).toBe("text");
    expect(byName.location_option_2?.data_type).toBe("text");
    expect(byName.shift_days?.data_type).toBe("ARRAY");
    expect(byName.shift_start_time?.data_type).toBe("time without time zone");
    expect(byName.shift_end_time?.data_type).toBe("time without time zone");
  });

  it("carries a reviewed Smart file through staging, review and approval onto the canonical Client", async () => {
    const trace = "smart-import-approval-integration";
    const staged = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `smart-approval-${randomUUID()}`,
      rows: [{
        full_name: "TEST Smart Approval",
        phone: "3135557781",
        email: "bbelalgv@gmail.com",
        date_of_birth: "03/14/1990",
        english_proficiency: "Englis is goog",
        street: "28772 GOODSON ST",
        city: "DETROIT",
        state: "MI",
        zip: "48212-3768",
        site_code: "Romulus",
        shift_days: "Thu-Mon",
        shift_start_time: "6pm",
        shift_end_time: "4:30am",
      }],
    });
    expect(staged.staged).toBe(1);
    const caseId = String(staged.cases[0].id);

    // Source evidence is staged for the approved field contract under SOURCE authority.
    const [stagedCase] = await db`select public_ref,mapped_draft,field_evidence from client_import_cases where id=${caseId}`;
    const sourceEvidence = stagedCase.field_evidence as { field_key: string; authority: string; value: string }[];
    expect(sourceEvidence.some((entry) => entry.field_key === "english_proficiency" && entry.authority === "SOURCE" && entry.value === "Englis is goog")).toBe(true);
    expect(stagedCase.mapped_draft.profile.english_proficiency).toBe("GOOD");
    expect(stagedCase.mapped_draft.profile.date_of_birth).toBe("1990-03-14");
    expect(stagedCase.mapped_draft.profile.preferred_language).toBeNull();
    expect(stagedCase.mapped_draft.review_fields.preferred_location).toBe("Romulus");
    expect(stagedCase.mapped_draft.review_fields.location_option_1).toBeNull();

    await startImportReview(manager, caseId, manager.staff.id);

    // A manual edit becomes the current authority without rewriting source evidence.
    const reviewedDraft = {
      ...stagedCase.mapped_draft,
      profile: { ...stagedCase.mapped_draft.profile, english_proficiency: "FAIR", preferred_language: "ar" },
    };
    await saveImportReview({ ...manager }, {
      id: caseId,
      reviewerId: manager.staff.id,
      draft: reviewedDraft,
      documentConfirmed: true,
      informationConfirmed: true,
    });
    const [reviewed] = await db`select mapped_draft,field_evidence,status from client_import_cases where id=${caseId}`;
    const reviewedEvidence = reviewed.field_evidence as { field_key: string; authority: string; value: string; reviewer_id?: string; reviewed_at?: string }[];
    expect(reviewedEvidence.slice(0, sourceEvidence.length)).toEqual(sourceEvidence);
    const manual = reviewedEvidence.filter((entry) => entry.authority === "MANUAL");
    expect(manual.map((entry) => entry.field_key).sort()).toEqual(["english_proficiency", "preferred_language"]);
    for (const entry of manual) {
      expect(entry.reviewer_id).toBe(manager.staff.id);
      expect(typeof entry.reviewed_at).toBe("string");
    }
    expect(reviewed.mapped_draft.profile.english_proficiency).toBe("FAIR");
    expect(reviewed.mapped_draft.profile.preferred_language).toBe("ar");

    const verification = await verifyImportCase(manager, caseId);
    expect(verification.client_schema_valid).toBe(true);

    const approved = await approveImportCase(manager, {
      id: caseId,
      reviewerId: manager.staff.id,
      draft: reviewed.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: trace,
    });
    expect(approved.idempotent).toBe(false);

    // All 16 approved fields land on the canonical Client row.
    const [client] = await db`
      select ref,full_name,phone,email,date_of_birth,preferred_language,english_proficiency,
             street,city,state,zip,preferred_location,location_option_1,location_option_2,
             shift_days,shift_start_time,shift_end_time
      from clients where id=${approved.client_id}`;
    expect(client.ref).toBe(stagedCase.public_ref);
    expect(client.full_name).toBe("TEST Smart Approval");
    expect(client.phone).toBe("3135557781");
    expect(client.email).toBe("bbelalgv@gmail.com");
    expect(String(client.date_of_birth instanceof Date ? client.date_of_birth.toISOString().slice(0, 10) : client.date_of_birth)).toBe("1990-03-14");
    expect(client.preferred_language).toBe("ar");
    expect(client.english_proficiency).toBe("FAIR");
    expect(client.street).toBe("28772 GOODSON ST");
    expect(client.city).toBe("DETROIT");
    expect(client.state).toBe("MI");
    expect(client.zip).toBe("48212-3768");
    expect(client.preferred_location).toBe("Romulus");
    expect(client.location_option_1).toBeNull();
    expect(client.location_option_2).toBeNull();
    expect(client.shift_days).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(String(client.shift_start_time)).toBe("18:00:00");
    expect(String(client.shift_end_time)).toBe("04:30:00");

    // Duplicate approval is idempotent and never creates a second Client.
    const again = await approveImportCase(manager, {
      id: caseId,
      reviewerId: manager.staff.id,
      draft: reviewed.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: trace,
    });
    expect(again).toEqual({ client_id: approved.client_id, idempotent: true });
    const [{ count }] = await db`select count(*)::int as count from clients where phone='3135557781'`;
    expect(count).toBe(1);
    await expect(saveImportReview(manager, {
      id: caseId,
      reviewerId: manager.staff.id,
      draft: reviewed.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
    })).rejects.toMatchObject({ code: "already_approved" });
  });


  it("approves two different public-intake applicants sharing an email and phone without changing either Case Number", async () => {
    const sharedEmail = `shared-family-${randomUUID()}@test.invalid`;
    const sharedPhone = "3135550184";
    const people = [
      { name: "TEST Family Alpha", dob: "1990-04-12" },
      { name: "TEST Family Beta", dob: "1997-08-24" },
    ];
    const approved: { ref: string; client_id: string }[] = [];

    for (const person of people) {
      const notes = [
        `Full Name: ${person.name}`,
        `Phone: ${sharedPhone}`,
        `Email: ${sharedEmail}`,
        `Date of Birth: ${person.dob}`,
      ].join("\n");
      const staged = await stageMobileImportV2({
        session: manager,
        notes,
        files: [],
        idempotencyKey: `client-link:${randomUUID().replace(/-/g, "")}`,
      });
      const caseId = staged.case_id;
      const [row] = await db`select public_ref,mapped_draft from client_import_cases where id=${caseId}`;
      expect(row.public_ref).toMatch(/^CG-\d{4}-\d{6}$/);
      expect(row.mapped_draft.profile.email).toBe(sharedEmail);
      await startImportReview(manager, caseId, manager.staff.id);
      const verification = await verifyImportCase(manager, caseId);
      expect(verification.blocking_conflicts).toBe(0);
      expect(verification.client_schema_valid).toBe(true);

      const done = await approveImportCase(manager, {
        id: caseId,
        reviewerId: manager.staff.id,
        draft: row.mapped_draft,
        documentConfirmed: true,
        informationConfirmed: true,
        traceId: `family-approval-${randomUUID()}`,
      });
      expect(done.idempotent).toBe(false);
      expect(done.ref).toBe(row.public_ref);
      approved.push({ ref: String(done.ref), client_id: String(done.client_id) });
    }
    expect(approved[0].ref).not.toBe(approved[1].ref);
    const clients = await db`
      select id,ref,full_name,email from clients
      where id in (${approved[0].client_id},${approved[1].client_id}) order by full_name`;
    expect(clients).toHaveLength(2);
    expect(clients.map(row => row.full_name)).toEqual(people.map(person => person.name));
    expect(clients.every(row => row.email === sharedEmail)).toBe(true);
    expect(new Set(clients.map(row => row.ref)).size).toBe(2);
  });

  it("restores the english_proficiency contract that production reported missing", async () => {
    const [column] = await db`
      select data_type,is_nullable,column_default
      from information_schema.columns
      where table_schema='public' and table_name='clients' and column_name='english_proficiency'`;
    expect(column?.data_type).toBe("text");
    expect(column?.is_nullable).toBe("YES");
    expect(column?.column_default).toBeNull();
    const [constraint] = await db`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid='public.clients'::regclass and conname='clients_english_proficiency_check'`;
    const definition = String(constraint?.definition);
    for (const value of ["EXCELLENT", "GOOD", "FAIR", "WEAK", "NONE"]) expect(definition).toContain(value);
  });

  it("approves a file whose optional fields are all unset and persists NULL rather than invented values", async () => {
    const staged = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `smart-optional-${randomUUID()}`,
      rows: [{ full_name: "TEST Optional Only", phone: "3135557782" }],
    });
    const caseId = String(staged.cases[0].id);

    // Approval needs neither a separate START REVIEW nor the two confirmations: it makes
    // the legal PENDING -> UNDER_REVIEW transition itself and records the reviewer.
    expect((await db`select status,reviewer_id from client_import_cases where id=${caseId}`)[0]).toMatchObject({ status: "PENDING", reviewer_id: null });
    const approved = await approveImportCase(manager, {
      id: caseId,
      reviewerId: manager.staff.id,
      draft: (await db`select mapped_draft from client_import_cases where id=${caseId}`)[0].mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: "smart-optional-integration",
    });
    expect(approved.idempotent).toBe(false);

    const [client] = await db`
      select preferred_language,english_proficiency,preferred_location,location_option_1,location_option_2,
             shift_days,shift_start_time,shift_end_time,deleted_at
      from clients where id=${approved.client_id}`;
    // Absent optional values persist as NULL; nothing is invented to satisfy approval.
    for (const [key, value] of Object.entries(client)) {
      if (key === "deleted_at") continue;
      expect(value, key).toBeNull();
    }
    expect(client.deleted_at).toBeNull();

    const [row] = await db`select status,reviewer_id,review_started_at,document_match_confirmed,information_match_confirmed,verification_result from client_import_cases where id=${caseId}`;
    expect(row.status).toBe("APPROVED_FILE");
    expect(row.reviewer_id).toBe(manager.staff.id);
    expect(row.review_started_at).toBeTruthy();
    // Confirmations are recorded as given; client_import_cases_approved_ck requires both.
    expect(row.document_match_confirmed).toBe(true);
    expect(row.information_match_confirmed).toBe(true);
    expect(row.verification_result.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(row.verification_result.blockers).toEqual([]);
    expect(Array.isArray(row.verification_result.warnings)).toBe(true);
    expect(row.verification_result.warnings.length).toBeGreaterThan(0);
  });

  it("keeps the public Case Number stable before and after approval", async () => {
    const staged = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `stable-ref-${randomUUID()}`,
      rows: [{
        full_name: "TEST Stable Ref",
        phone: "3135558801",
        email: "stable-ref@test.invalid",
        date_of_birth: "1991-02-03",
      }],
    });
    const caseId = String(staged.cases[0].id);
    const [before] = await db`select public_ref,mapped_draft from client_import_cases where id=${caseId}`;
    expect(String(before.public_ref)).toMatch(/^CG-\d{4}-\d{6}$/);

    const pendingStatus = await publicImportStatus(caseId);
    expect(pendingStatus?.ref).toBe(before.public_ref);
    expect(pendingStatus?.status_label).toBeTruthy();

    const approved = await approveImportCase(manager, {
      id: caseId,
      reviewerId: manager.staff.id,
      draft: before.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: "stable-ref-integration",
    });
    const [client] = await db`select ref from clients where id=${approved.client_id}`;
    expect(client.ref).toBe(before.public_ref);
  });

  it("allows a different applicant to use an email already attached to another file", async () => {
    const sharedEmail = `family-${randomUUID()}@test.invalid`;

    const first = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `shared-email-a-${randomUUID()}`,
      rows: [{
        full_name: "TEST Shared Email Alpha",
        phone: "3135558811",
        email: sharedEmail,
        date_of_birth: "1985-01-01",
      }],
    });
    const firstId = String(first.cases[0].id);
    const [firstCase] = await db`select mapped_draft from client_import_cases where id=${firstId}`;
    await approveImportCase(manager, {
      id: firstId,
      reviewerId: manager.staff.id,
      draft: firstCase.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: "shared-email-alpha",
    });

    const second = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `shared-email-b-${randomUUID()}`,
      rows: [{
        full_name: "TEST Shared Email Beta",
        phone: "3135558812",
        email: sharedEmail,
        date_of_birth: "1993-09-09",
      }],
    });
    const secondId = String(second.cases[0].id);
    const [secondCase] = await db`select public_ref,mapped_draft from client_import_cases where id=${secondId}`;

    const verification = await verifyImportCase(manager, secondId);
    expect(verification.identity).toBe("NEW");

    const approved = await approveImportCase(manager, {
      id: secondId,
      reviewerId: manager.staff.id,
      draft: secondCase.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: "shared-email-beta",
    });
    const [secondClient] = await db`select ref,email,phone from clients where id=${approved.client_id}`;
    expect(secondClient.ref).toBe(secondCase.public_ref);
    expect(secondClient.email).toBe(sharedEmail);
    expect(secondClient.phone).toBe("3135558812");

    const [{ count }] = await db`select count(*)::int as count from clients where lower(email)=lower(${sharedEmail})`;
    expect(count).toBe(2);
  });

  it("still blocks the same applicant when email and identity match an existing file", async () => {
    const email = `same-applicant-${randomUUID()}@test.invalid`;
    const first = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `same-applicant-a-${randomUUID()}`,
      rows: [{
        full_name: "TEST Same Applicant",
        phone: "3135558821",
        email,
        date_of_birth: "1990-04-04",
      }],
    });
    const firstId = String(first.cases[0].id);
    const [firstCase] = await db`select mapped_draft from client_import_cases where id=${firstId}`;
    await approveImportCase(manager, {
      id: firstId,
      reviewerId: manager.staff.id,
      draft: firstCase.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: "same-applicant-first",
    });

    // Same name and date of birth on the shared email: the same applicant.
    const repeatRow = {
      full_name: "TEST Same Applicant",
      phone: "3135558822",
      email,
      date_of_birth: "1990-04-04",
    };

    const [preview] = await previewImportRows(manager, [repeatRow]);
    expect(preview.result).toBe("DUPLICATE");
    expect(preview.identity).toBe("POSSIBLE_DUPLICATE");
    expect(preview.existing_client_ref).toBeTruthy();

    // A flagged duplicate is never staged by default; a manager must select it
    // deliberately. Approval is the authoritative block, so stage it and prove
    // approval still refuses.
    await expect(stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `same-applicant-default-${randomUUID()}`,
      rows: [repeatRow],
    })).rejects.toMatchObject({ code: "nothing_to_stage" });

    const second = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `same-applicant-b-${randomUUID()}`,
      rows: [repeatRow],
      selectedRows: [preview.row],
    });
    const secondId = String(second.cases[0].id);
    const [secondCase] = await db`select mapped_draft from client_import_cases where id=${secondId}`;

    const verification = await verifyImportCase(manager, secondId);
    expect(verification.identity).toBe("POSSIBLE_DUPLICATE");

    const [before] = await db`select count(*)::int as n from clients where lower(email)=${email}`;

    await expect(approveImportCase(manager, {
      id: secondId,
      reviewerId: manager.staff.id,
      draft: secondCase.mapped_draft,
      documentConfirmed: true,
      informationConfirmed: true,
      traceId: "same-applicant-second",
    })).rejects.toMatchObject({ code: "approval_blocked" });

    // The rule that matters: no second lifecycle was created for this applicant.
    const [after] = await db`select count(*)::int as n from clients where lower(email)=${email}`;
    expect(after.n).toBe(before.n);
  });

  it("blocks approval with the real database error when the persistence column is absent", async () => {
    const staged = await stageSheetRows({
      session: manager,
      source: "csv",
      idempotencyKey: `smart-schema-fail-${randomUUID()}`,
      rows: [{ full_name: "TEST Schema Failure", phone: "3135557783", english_proficiency: "Good" }],
    });
    const caseId = String(staged.cases[0].id);
    const draft = (await db`select mapped_draft from client_import_cases where id=${caseId}`)[0].mapped_draft;

    // Reproduce exactly the production drift: the column the write needs is gone.
    await db`alter table public.clients drop constraint if exists clients_english_proficiency_check`;
    await db`alter table public.clients drop column english_proficiency`;
    try {
      await expect(approveImportCase(manager, {
        id: caseId, reviewerId: manager.staff.id, draft,
        documentConfirmed: true, informationConfirmed: true, traceId: "smart-schema-fail",
      })).rejects.toThrow(/english_proficiency/);

      // No Client and no fake approval survived the failure.
      const [{ count: clients }] = await db`select count(*)::int as count from clients where phone='3135557783'`;
      expect(clients).toBe(0);
      const [row] = await db`select status,created_client_id from client_import_cases where id=${caseId}`;
      expect(row.status).not.toBe("APPROVED_FILE");
      expect(row.created_client_id).toBeNull();
    } finally {
      await db`alter table public.clients add column if not exists english_proficiency text null`;
      await db`alter table public.clients add constraint clients_english_proficiency_check
        check (english_proficiency is null or english_proficiency in ('EXCELLENT','GOOD','FAIR','WEAK','NONE'))`;
    }

    // With the column restored the same file approves.
    const approved = await approveImportCase(manager, {
      id: caseId, reviewerId: manager.staff.id, draft,
      documentConfirmed: true, informationConfirmed: true, traceId: "smart-schema-fail-retry",
    });
    const [client] = await db`select english_proficiency from clients where id=${approved.client_id}`;
    expect(client.english_proficiency).toBe("GOOD");
  });
});
