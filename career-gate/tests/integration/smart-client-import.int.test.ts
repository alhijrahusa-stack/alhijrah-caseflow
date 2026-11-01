import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import { runAudit } from "@/lib/audit";
import { publicImportStatus } from "@/lib/public-status";
import { stageMobileImportV2 } from "@/lib/smart-client-mobile";
import { archiveImportCase, listActiveImportQueue, listArchivedImportQueue } from "@/lib/smart-import-archive";
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
  it("preserves microsecond cursor boundaries and does not double-skip when page is also supplied", async () => {
    const exactTimestamp = "2025-01-01 00:00:00.000013+00";
    const [roundTrip] = await db`select ${exactTimestamp}::text::timestamptz::text as value`;
    expect(String(roundTrip.value)).toContain(".000013");
    const marker = `TEST Cursor Intake ${randomUUID()}`;
    const staged = await stageSheetRows({ session: manager, source: "csv", idempotencyKey: randomUUID(), rows: Array.from({ length: 23 }, (_, index) => ({ full_name: `${marker} ${index}`, phone: `616553${String(1000 + index)}` })) });
    for (let index = 0; index < staged.cases.length; index++) {
      await db`update client_import_cases set created_at='2025-01-01 00:00:00+00'::timestamptz + ${index} * interval '1 microsecond' where id=${staged.cases[index].id}`;
    }
    for (const archive of [false, true]) {
      if (archive) await db`update client_import_cases set archived_at=now(),archived_by=${manager.staff.id} where id=any(${staged.cases.map(row => row.id)}::uuid[])`;
      const list = (page: number, cursor?: string | null) => archive
        ? listArchivedImportQueue(manager, { q: marker, page, cursor })
        : listActiveImportQueue(manager, { q: marker, page, cursor });
      const first = await list(1);
      expect(Buffer.from(first.next_cursor!, "base64url").toString("utf8")).toContain(".000013");
      const second = await list(2, first.next_cursor);
      const third = await list(3, second.next_cursor);
      expect(first.rows).toHaveLength(10);
      expect(second.rows).toHaveLength(10);
      expect(third.rows).toHaveLength(3);
      expect(second.rows.map(row => row.id)).toEqual((await list(2)).rows.map(row => row.id));
      expect(third.rows.map(row => row.id)).toEqual((await list(3)).rows.map(row => row.id));
      expect(new Set([...first.rows, ...second.rows, ...third.rows].map(row => row.id)).size).toBe(23);
    }
  });

  it("rejects malformed import cursors before running a UUID query", async () => {
    const malformedUuid = Buffer.from("2025-01-01T00:00:00Z|not-a-uuid").toString("base64url");
    const extraField = Buffer.from(`2025-01-01T00:00:00Z|${randomUUID()}|extra`).toString("base64url");
    for (const cursor of [malformedUuid, extraField, "!invalid!", "a".repeat(513)]) {
      await expect(listActiveImportQueue(manager, { cursor })).rejects.toMatchObject({ code: "invalid_cursor", status: 400 });
      await expect(listArchivedImportQueue(manager, { cursor })).rejects.toMatchObject({ code: "invalid_cursor", status: 400 });
    }
  });

  it("paginates exactly ten matching active imports and keeps archived files out of the queue", async () => {
    const marker = `TEST Paged Intake ${randomUUID()}`;
    const staged = await stageSheetRows({ session: manager, source: "csv", idempotencyKey: randomUUID(), rows: Array.from({ length: 23 }, (_, index) => ({full_name: `${marker} ${index}`, phone: `616551${String(1000+index)}`})) });
    const first = await listActiveImportQueue(manager, {q:marker,page:1});
    const second = await listActiveImportQueue(manager, {q:marker,page:2});
    const third = await listActiveImportQueue(manager, {q:marker,page:3});
    expect(first.total).toBe(23); expect(first.rows).toHaveLength(10); expect(second.rows).toHaveLength(10); expect(third.rows).toHaveLength(3);
    expect(new Set([...first.rows,...second.rows,...third.rows].map((row) => row.id)).size).toBe(23);
    await archiveImportCase(manager, String(staged.cases[0].id));
    const active = await listActiveImportQueue(manager, {q:marker,page:1});
    const archived = await listArchivedImportQueue(manager, {q:marker,page:1});
    expect(active.total).toBe(22); expect(archived.total).toBe(1); expect(archived.rows[0].id).toBe(staged.cases[0].id);
    await expect(listActiveImportQueue({...manager,staff:{...manager.staff,role:"staff"}}, {q:marker,page:1})).rejects.toMatchObject({code:"forbidden"});
  });

  it("requires and audits the explicit missing-item reason before creating the Intake client", async () => {
    const staged = await stageSheetRows({session:manager,source:"csv",idempotencyKey:randomUUID(),rows:[{full_name:"TEST Explicit Missing Approval",phone:"6165529001"}]});
    const id = String(staged.cases[0].id);
    const [before] = await db`select mapped_draft,field_evidence from client_import_cases where id=${id}`;
    const args = {id,reviewerId:manager.staff.id,draft:before.mapped_draft,documentConfirmed:false,informationConfirmed:false,traceId:"explicit-override-test"};
    await expect(approveImportCase(manager,args)).rejects.toMatchObject({code:"override_required"});
    await expect(approveImportCase(manager,{...args,override:true,overrideReason:" "})).rejects.toMatchObject({code:"override_required"});
    const [untouched] = await db`select status,created_client_id from client_import_cases where id=${id}`;
    expect(untouched.status).toBe("PENDING"); expect(untouched.created_client_id).toBeNull();
    const reason = "Identity checked in person; source documents due at the next visit.";
    const approved = await approveImportCase(manager,{...args,override:true,overrideReason:reason});
    const [saved] = await db`select verification_result,field_evidence from client_import_cases where id=${id}`;
    expect(saved.verification_result.override).toMatchObject({approved_with_missing_items:true,reason,actor_id:manager.staff.id,reviewer_id:manager.staff.id,outstanding_fields:expect.arrayContaining(["source_documents"])});
    expect(saved.field_evidence).toEqual(before.field_evidence);
    const [client] = await db`select current_status from clients where id=${approved.client_id}`;
    expect(client.current_status).toBe("new_intake");
    const [followup] = await db`select count(*)::int as n from tasks where client_id=${approved.client_id}`;
    expect(followup.n).toBeGreaterThan(0);
  });

  it("UPSERT stages a concurrent retry once and returns the same canonical staging batch", async () => {
    const idempotencyKey = randomUUID();
    const rows = [{ full_name: "TEST Atomic Import Claim", phone: "3135558891", date_of_birth: "1995-01-05" }];
    const [first, second] = await Promise.all([
      stageSheetRows({ session: manager, source: "csv", idempotencyKey, rows }),
      stageSheetRows({ session: manager, source: "csv", idempotencyKey, rows }),
    ]);
    expect(first.batch_id).toBe(second.batch_id);
    expect([first.idempotent, second.idempotent].sort()).toEqual([false, true]);
    const [batch] = await db`select count(*)::int as n from client_import_batches where created_by=${manager.staff.id} and idempotency_key=${idempotencyKey}`;
    const [cases] = await db`select count(*)::int as n from client_import_cases where batch_id=${first.batch_id}`;
    expect(batch.n).toBe(1);
    expect(cases.n).toBe(1);
    expect(first.cases[0].id).toBe(second.cases[0].id);
  });

  it("rejects reusing an import idempotency key for different applicant data", async () => {
    const idempotencyKey = randomUUID();
    const first = await stageSheetRows({
      session: manager, source: "csv", idempotencyKey,
      rows: [{ full_name: "TEST Import Request A", phone: "3135558892" }],
    });
    await expect(stageSheetRows({
      session: manager, source: "csv", idempotencyKey,
      rows: [{ full_name: "TEST Import Request B", phone: "3135558893" }],
    })).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    const [count] = await db`select count(*)::int as n from client_import_cases where batch_id=${first.batch_id}`;
    expect(count.n).toBe(1);
  });

  it("keeps an assigned import reviewer immutable across save and approval", async () => {
    const reviewerAuthId = randomUUID();
    await db`insert into auth.users(id,email) values (${reviewerAuthId},${`reviewer-${reviewerAuthId}@test.invalid`})`;
    const [alternate] = await db`insert into staff(display_name,email,role,auth_user_id,active)
      values ('TEST Alternate Import Reviewer',${`alternate-${reviewerAuthId}@test.invalid`},'manager',${reviewerAuthId},true)
      returning id`;
    const staged = await stageSheetRows({
      session: manager, source: "csv", idempotencyKey: randomUUID(),
      rows: [{ full_name: "TEST Immutable Import Reviewer", phone: "3135558838", date_of_birth: "1994-03-02" }],
    });
    const id = String(staged.cases[0].id);
    const [initial] = await db`select mapped_draft from client_import_cases where id=${id}`;
    await startImportReview(manager, id, manager.staff.id);

    await expect(saveImportReview(manager, {
      id, reviewerId: String(alternate.id), draft: initial.mapped_draft,
      documentConfirmed: true, informationConfirmed: true,
    })).rejects.toMatchObject({ code: "review_assigned", status: 409 });

    await expect(approveImportCase(manager, {
      id, reviewerId: String(alternate.id), draft: initial.mapped_draft,
      documentConfirmed: true, informationConfirmed: true, traceId: "review-ownership-test", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
    })).rejects.toMatchObject({ code: "review_assigned", status: 409 });

    const [unchanged] = await db`select status,reviewer_id,created_client_id,document_match_confirmed
      from client_import_cases where id=${id}`;
    expect(unchanged).toMatchObject({
      status: "UNDER_REVIEW", reviewer_id: manager.staff.id,
      created_client_id: null, document_match_confirmed: false,
    });
    expect(await db`select id from clients where ref=(select public_ref from client_import_cases where id=${id})`)
      .toHaveLength(0);

    const updated = await saveImportReview(manager, {
      id, reviewerId: manager.staff.id, draft: initial.mapped_draft,
      documentConfirmed: true, informationConfirmed: true,
    });
    expect(updated.status).toBe("UNDER_REVIEW");
  });

  it("serializes concurrent review claims and retains exactly one reviewer", async () => {
    const reviewerAuthId = randomUUID();
    await db`insert into auth.users(id,email) values (${reviewerAuthId},${`reviewer-${reviewerAuthId}@test.invalid`})`;
    const [alternate] = await db`insert into staff(display_name,email,role,auth_user_id,active)
      values ('TEST Concurrent Import Reviewer',${`concurrent-${reviewerAuthId}@test.invalid`},'manager',${reviewerAuthId},true)
      returning id`;
    const staged = await stageSheetRows({
      session: manager, source: "csv", idempotencyKey: randomUUID(),
      rows: [{ full_name: "TEST Concurrent Import Claim", phone: "3135558839" }],
    });
    const id = String(staged.cases[0].id);
    const results = await Promise.allSettled([
      startImportReview(manager, id, manager.staff.id),
      startImportReview(manager, id, String(alternate.id)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const denied = results.find((result) => result.status === "rejected");
    expect(denied).toMatchObject({ status: "rejected", reason: { code: "review_assigned", status: 409 } });
    const [caseRow] = await db`select status,reviewer_id from client_import_cases where id=${id}`;
    expect(caseRow.status).toBe("UNDER_REVIEW");
    expect([manager.staff.id, alternate.id]).toContain(caseRow.reviewer_id);
  });

  it("creates all three staging tables with RLS enabled", async () => {
    for (const table of tables) {
      const [row] = await db`
        select c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=${table}`;
      expect(row?.rls).toBe(true);
    }
  });

  it("resolves a confirmed source conflict atomically, preserves its audit evidence and rejects stale saves", async () => {
    const staged = await stageSheetRows({
      session: manager, source: "csv", idempotencyKey: randomUUID(),
      rows: [{ full_name: "TEST Conflict Review", phone: "3135558840", date_of_birth: "1976-01-01" }],
    });
    const id = String(staged.cases[0].id);
    await startImportReview(manager, id, manager.staff.id);
    const conflict = { field_key: "date_of_birth", type: "SOURCE_CONFLICT", values: [{ value: "1976-01-01" }, { value: "1977-01-01" }] };
    await db`update client_import_cases set conflicts=${db.json([conflict])},verification_result=${db.json({ approval_ready: true })} where id=${id}`;
    const [before] = await db`select mapped_draft,field_evidence,
      to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as revision from client_import_cases where id=${id}`;
    const revision = String(before.revision);
    const saved = await saveImportReview(manager, {
      id, reviewerId: manager.staff.id, draft: before.mapped_draft,
      documentConfirmed: true, informationConfirmed: true,
      resolvedFields: ["date_of_birth"], expectedUpdatedAt: revision,
    });
    expect(saved.updated_at).toBeTruthy();
    const [after] = await db`select conflicts,field_evidence,verification_result from client_import_cases where id=${id}`;
    expect(after.conflicts).toEqual([]);
    expect(after.verification_result).toEqual({});
    expect(after.field_evidence.slice(0, before.field_evidence.length)).toEqual(before.field_evidence);
    expect(after.field_evidence.at(-1)).toMatchObject({
      field_key: "date_of_birth", value: "1976-01-01", previous_value: "1976-01-01",
      reviewer_id: manager.staff.id, actor_id: manager.staff.id,
      resolution: "CONFIRMED_BY_REVIEWER", resolved_conflicts: [conflict],
    });
    await expect(saveImportReview(manager, {
      id, reviewerId: manager.staff.id, draft: before.mapped_draft,
      documentConfirmed: false, informationConfirmed: false, expectedUpdatedAt: revision,
    })).rejects.toMatchObject({ code: "review_changed", status: 409 });
    const [unchanged] = await db`select field_evidence,document_match_confirmed from client_import_cases where id=${id}`;
    expect(unchanged.field_evidence).toEqual(after.field_evidence);
    expect(unchanged.document_match_confirmed).toBe(true);
  });

  it("retains direct approval edits in the import evidence and canonical Client", async () => {
    const staged = await stageSheetRows({
      session: manager, source: "csv", idempotencyKey: randomUUID(),
      rows: [{ full_name: "TEST Direct Approval Audit", phone: "3135558841", city: "Detroit" }],
    });
    const id = String(staged.cases[0].id);
    const [before] = await db`select mapped_draft,field_evidence,
      to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as revision from client_import_cases where id=${id}`;
    const draft = { ...before.mapped_draft, profile: { ...before.mapped_draft.profile, city: "Dearborn" } };
    const approved = await approveImportCase(manager, {
      id, reviewerId: manager.staff.id, draft,
      documentConfirmed: true, informationConfirmed: true,
      expectedUpdatedAt: String(before.revision), traceId: "direct-review-audit", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
    });
    const [client] = await db`select city from clients where id=${approved.client_id}`;
    expect(client.city).toBe("Dearborn");
    const [after] = await db`select field_evidence from client_import_cases where id=${id}`;
    expect(after.field_evidence.slice(0, before.field_evidence.length)).toEqual(before.field_evidence);
    expect(after.field_evidence.at(-1)).toMatchObject({
      field_key: "city", value: "Dearborn", previous_value: "Detroit", authority: "MANUAL",
      reviewer_id: manager.staff.id, actor_id: manager.staff.id,
    });
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
      traceId: trace, override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
      traceId: trace, override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
    });
    expect(again).toEqual({ client_id: approved.client_id, idempotent: true });
    expect((await listActiveImportQueue(manager, { q: caseId })).rows).toHaveLength(0);
    expect((await listArchivedImportQueue(manager, { q: caseId })).rows.map((row) => row.id)).toContain(caseId);
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
        traceId: `family-approval-${randomUUID()}`, override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
      documentConfirmed: false,
      informationConfirmed: false,
      traceId: "smart-optional-integration", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
    // Incomplete verification remains truthful after approval and can be completed later.
    expect(row.document_match_confirmed).toBe(false);
    expect(row.information_match_confirmed).toBe(false);
    expect(row.verification_result.readiness).toBe("APPROVE_WITH_WARNINGS");
    expect(row.verification_result.blockers).toEqual([]);
    expect(Array.isArray(row.verification_result.warnings)).toBe(true);
    expect(row.verification_result.warnings.length).toBeGreaterThan(0);
  });

  it("approves unmatched source readings without confirmations and preserves truthful follow-up work", async () => {
    const staged = await stageSheetRows({
      session: manager, source: "csv", idempotencyKey: randomUUID(),
      rows: [{ full_name: "TEST Deferred Source Review", phone: "3135557851", date_of_birth: "1976-01-01" }],
    });
    const id = String(staged.cases[0].id);
    const [before] = await db`select mapped_draft,field_evidence from client_import_cases where id=${id}`;
    const conflict = {
      field_key: "date_of_birth", type: "SOURCE_CONFLICT",
      values: [{ value: "1976-01-01", source: "csv" }, { value: "1977-01-01", source: "local_text" }],
    };
    const evidence = [...before.field_evidence, {
      field_key: "date_of_birth", value: "1977-01-01", normalized_value: "1977-01-01",
      source_type: "local_text", authority: "SOURCE", verification_state: "CONFLICT",
      source_text_reference: "Alternate birth date supplied: 1977-01-01",
    }];
    await db`update client_import_cases set conflicts=${db.json([conflict])},field_evidence=${db.json(evidence)} where id=${id}`;
    const [version] = await db`select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as revision
      from client_import_cases where id=${id}`;
    const args = {
      id, reviewerId: manager.staff.id, draft: before.mapped_draft,
      documentConfirmed: false, informationConfirmed: false,
      expectedUpdatedAt: String(version.revision), traceId: "deferred-source-review", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
    };
    const approved = await approveImportCase(manager, args);
    const [client] = await db`select full_name,phone,date_of_birth::text from clients where id=${approved.client_id}`;
    expect(client).toMatchObject({ full_name: "TEST Deferred Source Review", phone: "3135557851", date_of_birth: "1976-01-01" });
    const [saved] = await db`select status,created_client_id,reviewer_id,review_started_at,reviewed_at,approved_by,approved_at,
      document_match_confirmed,information_match_confirmed,conflicts,field_evidence,verification_result
      from client_import_cases where id=${id}`;
    expect(saved).toMatchObject({
      status: "APPROVED_FILE", created_client_id: approved.client_id,
      reviewer_id: manager.staff.id, approved_by: manager.staff.id,
      document_match_confirmed: false, information_match_confirmed: false,
      conflicts: [conflict], field_evidence: evidence,
    });
    expect(saved.review_started_at).toBeTruthy();
    expect(saved.reviewed_at).toBeTruthy();
    expect(saved.approved_at).toBeTruthy();
    expect(saved.verification_result.blockers).toEqual([]);
    expect(saved.verification_result.blocking_conflicts).toBe(0);
    expect(saved.verification_result.source_conflicts).toBe(1);
    for (const field of ["date_of_birth", "review_confirmations", "source_documents"]) {
      expect(saved.verification_result.warnings.some((warning: { field?: string }) => warning.field === field), field).toBe(true);
    }
    const tasks = await db`select title,description,assigned_to,status from tasks where client_id=${approved.client_id}`;
    expect(tasks.find((task) => task.title === "Collect missing client documents")).toMatchObject({ assigned_to: manager.staff.id, status: "pending" });
    expect(tasks.find((task) => task.title === "Complete client intake review")).toMatchObject({
      assigned_to: manager.staff.id, status: "pending",
      description: expect.stringContaining("Date of Birth has differing source readings"),
    });
    const [audit] = await db`select staff_id,new_value from activity_log
      where client_id=${approved.client_id} and action='client_updated' and entity_type='client_import_case' and entity_id=${id}
      order by id desc limit 1`;
    expect(audit.staff_id).toBe(manager.staff.id);
    expect(audit.new_value).toMatchObject({
      approved_from_import: true, document_match_confirmed: false, information_match_confirmed: false,
      follow_up_required: true, source_conflict_count: 1,
      outstanding_fields: expect.arrayContaining(["date_of_birth", "review_confirmations", "source_documents"]),
    });
    const repeated = await approveImportCase(manager, args);
    expect(repeated).toMatchObject({ client_id: approved.client_id, idempotent: true });
    const [afterRetry] = await db`select count(*)::int as n from tasks where client_id=${approved.client_id}`;
    expect(afterRetry.n).toBe(tasks.length);
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
      traceId: "stable-ref-integration", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
      traceId: "shared-email-alpha", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
      traceId: "shared-email-beta", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
    });
    const [secondClient] = await db`select ref,email,phone from clients where id=${approved.client_id}`;
    expect(secondClient.ref).toBe(secondCase.public_ref);
    expect(secondClient.email).toBe(sharedEmail);
    expect(secondClient.phone).toBe("3135558812");

    const [{ count }] = await db`select count(*)::int as count from clients where lower(email)=lower(${sharedEmail})`;
    expect(count).toBe(2);
  });

  it("approves distinct staff applicants sharing a phone, preserves refs, and queues an auditable alert", async () => {
    const phone = "3135558840";
    const stage = async (name: string, dob: string) => {
      const staged = await stageSheetRows({ session: manager, source: "csv",
        idempotencyKey: randomUUID(), rows: [{ full_name: name, phone, date_of_birth: dob }] });
      const id = String(staged.cases[0].id);
      const [row] = await db`select public_ref,mapped_draft from client_import_cases where id=${id}`;
      return { id, row };
    };
    const approve = (item: Awaited<ReturnType<typeof stage>>) => approveImportCase(manager, {
      id: item.id, reviewerId: manager.staff.id, draft: item.row.mapped_draft,
      documentConfirmed: true, informationConfirmed: true, traceId: "staff-shared-phone", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
    });
    const first = await stage("TEST Phone Family Alpha", "1980-01-01");
    await approve(first);
    const [preview] = await previewImportRows(manager, [{
      full_name: "TEST Phone Family Beta", phone, date_of_birth: "1995-02-02",
    }]);
    expect(preview.result).toBe("VALID");
    expect(preview.message).toContain("verify the applicant");
    const second = await stage("TEST Phone Family Beta", "1995-02-02");
    // A previous verification result must not survive correction of the draft.
    await db`update client_import_cases set conflicts='[{"type":"IDENTITY"}]'::jsonb where id=${second.id}`;
    await startImportReview(manager, second.id, manager.staff.id);
    const verification = await verifyImportCase(manager, second.id);
    expect(verification.approval_ready).toBe(true);
    const created = await approve(second);
    expect(created.ref).toBe(second.row.public_ref);
    expect((await approve(second)).idempotent).toBe(true);
    const [job] = await db`select payload from jobs where dedupe_key=${`identity-audit:${created.client_id}`}`;
    expect(job.payload.client_id).toBe(created.client_id);
    await runAudit(created.client_id, "staff-shared-phone");
    await runAudit(created.client_id, "staff-shared-phone-retry");
    const alerts = await db`select evidence from audit_alerts where client_id=${created.client_id}
      and rule='identity_review_shared_phone' and status='open'`;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].evidence.shared_with).toContain(first.row.public_ref);
    // The same person remains blocked even without an email anchor.
    const [repeat] = await previewImportRows(manager, [{ full_name: "TEST Phone Family Beta", phone, date_of_birth: "1995-02-02" }]);
    expect(repeat.result).toBe("DUPLICATE");
    // Bypassing application validation cannot bypass the database guard.
    await expect(db`insert into clients(source,full_name,phone,date_of_birth,next_step)
      values('staff_manual','TEST Phone Family Beta',${phone},'1995-02-02','Review')`)
      .rejects.toMatchObject({ code: "P0001" });
    const [count] = await db`select count(*)::int n from clients where phone=${phone}`;
    expect(count.n).toBe(2);
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
      traceId: "same-applicant-first", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
      documentConfirmed: false,
      informationConfirmed: false,
      traceId: "same-applicant-second", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
        documentConfirmed: true, informationConfirmed: true, traceId: "smart-schema-fail", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
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
      documentConfirmed: true, informationConfirmed: true, traceId: "smart-schema-fail-retry", override: true, overrideReason: "Reviewed identity; missing details will be collected at the next visit.",
    });
    const [client] = await db`select english_proficiency from clients where id=${approved.client_id}`;
    expect(client.english_proficiency).toBe("GOOD");
  });
});
