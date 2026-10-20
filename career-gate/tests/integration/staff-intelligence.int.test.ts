import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import { runAudit } from "@/lib/audit";
import { dashboardCommandData } from "@/lib/operational-dashboard";
import { accountingData, ACCOUNTING_PAGE_SIZE, parseAccountingFilters, type AccountingFilters } from "@/lib/operations";
import { REPORT_PERIODS, reportIntelligence } from "@/lib/reports";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

/**
 * Server-side accounting pages, the reworked dashboard aggregate, the reports
 * intelligence and the shared-email review rule, proven against the real
 * schema with RLS active. Synthetic data only.
 */

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const trace = "staff-intelligence-int";

let admin: StaffSession;
let owner: StaffSession;
// A range of its own: the integration suites share one database.
let phoneSequence = 8700;
const nextPhone = () => `313555${String(++phoneSequence).padStart(4, "0")}`;
const tag = randomUUID().slice(0, 8);

async function makeStaff(key: string, role: "admin" | "manager" | "staff"): Promise<StaffSession> {
  const authUserId = randomUUID();
  await db`insert into auth.users (id,email) values (${authUserId},${`${key}-${tag}@test.invalid`})`;
  const [staff] = await db`
    insert into staff (display_name,email,role,auth_user_id,active,commission_type,commission_value)
    values (${`TEST ${key} ${tag}`},${`${key}-${tag}@test.invalid`},${role},${authUserId},true,'fixed',10)
    returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}

async function makeClient(name: string, opts: { email?: string | null; dob?: string; assigned?: string | null; withAccount?: boolean } = {}) {
  const client = await db.begin((tx) =>
    insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({
        full_name: name, phone: nextPhone(), email: opts.email ?? null,
        date_of_birth: opts.dob ?? "1991-02-03", employment_history: [],
      }),
      primary: [], backup: [], status: "new_intake" as never, nextStep: null,
      assignedStaff: opts.assigned ?? null, createdBy: null, communicationConsent: true,
    }, { staffId: null, traceId: trace }));
  const clientId = String((client as { id: string }).id);
  if (opts.withAccount) await db`update clients set pipeline_stage='interview_passed' where id=${clientId}`;
  return clientId;
}

/** Every account the filter matches, read without paging, as the reference the pages must reproduce. */
async function referenceAccounts(session: StaffSession, filters: AccountingFilters) {
  const all: string[] = [];
  let totals = null as null | Awaited<ReturnType<typeof accountingData>>["totals"];
  for (let page = 1; page <= 400; page++) {
    const result = await accountingData(session, { ...filters, page });
    totals ??= result.totals;
    all.push(...result.rows.map((r) => r.account_id));
    if (page >= result.pageCount) break;
  }
  return { ids: all, totals: totals! };
}

beforeAll(async () => {
  admin = await makeStaff("intel-admin", "admin");
  owner = await makeStaff("intel-owner", "staff");
  for (let i = 0; i < 3; i++) await makeClient(`TEST Intel Account ${tag} ${i}`, { assigned: owner.staff.id, withAccount: true });
});

afterAll(async () => {
  await db.end();
});

describe("accounting pages", () => {
  it("parses untrusted parameters into a closed filter set", () => {
    expect(parseAccountingFilters({ status: "drop table", staff: "nope", client: "1", page: "-4", q: "  a  " })).toEqual({
      status: "all", staffId: null, q: "a", clientId: null, page: 1,
    });
    const id = randomUUID();
    expect(parseAccountingFilters({ status: "paid", staff: id, client: id, page: "3" })).toMatchObject({ status: "paid", staffId: id, clientId: id, page: 3 });
  });

  it("pages partition the filtered set exactly and totals cover every page", async () => {
    const filters = parseAccountingFilters({});
    const { ids, totals } = await referenceAccounts(admin, filters);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(totals.count);

    const [expected] = await withStaff(admin, (tx) => tx`
      select count(*)::int n, coalesce(sum(greatest(b.balance,0)),0)::numeric outstanding, coalesce(sum(b.amount_paid),0)::numeric paid
      from client_accounts a join client_account_balances b on b.account_id=a.id join clients c on c.id=a.client_id
      where c.deleted_at is null`);
    expect(totals.count).toBe(expected.n);
    expect(totals.outstanding).toBeCloseTo(Number(expected.outstanding), 2);
    expect(totals.paid).toBeCloseTo(Number(expected.paid), 2);
  });

  it("returns at most one page of rows with a ledger per row", async () => {
    const page = await accountingData(admin, parseAccountingFilters({}));
    expect(page.rows.length).toBeLessThanOrEqual(ACCOUNTING_PAGE_SIZE);
    for (const row of page.rows) expect(Array.isArray(row.transactions)).toBe(true);
  });

  it("filters by search term, status, staff and client in the database", async () => {
    const byName = await accountingData(admin, parseAccountingFilters({ q: `Intel Account ${tag}` }));
    expect(byName.totals.count).toBe(3);
    expect(byName.rows.every((r) => r.full_name.includes(tag))).toBe(true);

    const byStaff = await accountingData(admin, parseAccountingFilters({ staff: owner.staff.id }));
    expect(byStaff.rows.length).toBeGreaterThanOrEqual(3);
    expect(byStaff.rows.every((r) => r.assigned_staff === owner.staff.id || r.commission_staff_id === owner.staff.id || r.application_completed_by === owner.staff.id)).toBe(true);

    const unpaid = await accountingData(admin, parseAccountingFilters({ status: "unpaid" }));
    expect(unpaid.rows.every((r) => r.payment_status === "unpaid")).toBe(true);

    const focus = byName.rows[0];
    const one = await accountingData(admin, parseAccountingFilters({ client: focus.client_id }));
    expect(one.rows.map((r) => r.client_id)).toEqual([focus.client_id]);
  });

  it("treats LIKE wildcards in the search term as literal text", async () => {
    const wildcard = await accountingData(admin, parseAccountingFilters({ q: "%" }));
    const [literal] = await withStaff(admin, (tx) => tx`
      select count(*)::int n from client_accounts a join clients c on c.id=a.client_id
      where c.deleted_at is null and (strpos(c.full_name,'%')>0 or strpos(c.ref,'%')>0 or strpos(coalesce(c.email,''),'%')>0 or strpos(coalesce(c.phone,''),'%')>0)`);
    expect(wildcard.totals.count).toBe(literal.n);
  });

  it("answers an out-of-range page with the totals and no rows", async () => {
    const far = await accountingData(admin, parseAccountingFilters({ page: "9999" }));
    expect(far.rows).toEqual([]);
    expect(far.totals.count).toBeGreaterThan(0);
  });
});

describe("dashboard aggregate", () => {
  it("document attention equals the latest-document-per-type reference", async () => {
    const data = await dashboardCommandData(admin);
    const [reference] = await withStaff(admin, (tx) => tx`
      with active as (select id from clients where deleted_at is null and current_status not in ('completed','cancelled')),
      latest as (
        select distinct on (d.client_id,d.doc_type) d.client_id,d.status
        from documents d join active a on a.id=d.client_id
        order by d.client_id,d.doc_type,d.uploaded_at desc,d.id desc
      )
      select count(distinct client_id)::int n from latest where status in ('needs_review','needs_reupload','rejected')`);
    expect(data.document_attention).toBe(reference.n);
  });
});

describe("reports intelligence", () => {
  it("returns consistent figures for every period", async () => {
    for (const period of REPORT_PERIODS) {
      const r = await reportIntelligence(admin, period);
      expect(r.period).toBe(period);
      expect(r.weekly).toHaveLength(12);
      expect(r.funnel.reduce((n, f) => n + f.n, 0)).toBe(r.byStatus.reduce((n, s) => n + s.n, 0));
      expect(r.kpis.unassignedActive).toBeLessThanOrEqual(r.kpis.active);
      expect(r.kpis.stalled).toBe(r.stalled.reduce((n, s) => n + s.n, 0));
      expect(r.insights.length).toBeGreaterThan(0);
      expect(r.staff.some((s) => s.id === owner.staff.id)).toBe(true);
    }
  });
});

describe("shared-email identity review", () => {
  it("keeps both files and raises one review alert per file", async () => {
    const email = `shared-${tag}@test.invalid`;
    const first = await makeClient(`TEST Shared Alpha ${tag}`, { email, dob: "1980-01-01" });
    const second = await makeClient(`TEST Shared Beta ${tag}`, { email, dob: "1999-12-31" });
    await runAudit(second, trace);
    await runAudit(first, trace);
    const alerts = await db`
      select client_id,evidence from audit_alerts
      where rule='identity_review_shared_email' and status='open' and client_id in ${db([first, second])}`;
    expect(alerts.map((a) => a.client_id).sort()).toEqual([first, second].sort());
    const [firstRow] = await db`select ref from clients where id=${first}`;
    const evidence = alerts.find((a) => a.client_id === second)!.evidence as { shared_with: string[] };
    expect(evidence.shared_with).toContain(String(firstRow.ref));
  });

  it("closes the alert once the email is no longer shared", async () => {
    const email = `solo-${tag}@test.invalid`;
    const a = await makeClient(`TEST Solo One ${tag}`, { email, dob: "1970-05-05" });
    const b = await makeClient(`TEST Solo Two ${tag}`, { email, dob: "1988-08-08" });
    await runAudit(a, trace);
    await db`update clients set email=${`moved-${tag}@test.invalid`} where id=${b}`;
    await runAudit(a, trace);
    const [open] = await db`select count(*)::int n from audit_alerts where rule='identity_review_shared_email' and status='open' and client_id=${a}`;
    expect(open.n).toBe(0);
  });
});
