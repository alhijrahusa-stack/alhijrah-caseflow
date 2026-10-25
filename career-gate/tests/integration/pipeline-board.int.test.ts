import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import {
  activePipelineData,
  dispatchPeriodSql,
  PIPELINE_COLUMN_BATCH,
  pipelineCards,
  pipelineLocationLanes,
} from "@/lib/operational-pipeline";
import { dispatchPeriod } from "@/lib/pipeline-period";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

/**
 * The windowed pipeline board: exact totals while only the first cards of a
 * column travel, gap-free paging, and one dispatch-period rule shared by the
 * browser and SQL. Real schema, RLS active, synthetic data only.
 */

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const trace = "pipeline-board-int";
const tag = randomUUID().slice(0, 8);
const STAGE = "interview_scheduled";
const SITE = `PB-${tag}`;
// A range of its own: the integration suites share one database.
let phoneSequence = 8900;
const nextPhone = () => `313556${String(++phoneSequence).padStart(4, "0")}`;

let admin: StaffSession;
const created: string[] = [];

async function makeStaff(key: string, role: "admin" | "manager" | "staff"): Promise<StaffSession> {
  const authUserId = randomUUID();
  await db`insert into auth.users (id,email) values (${authUserId},${`${key}-${tag}@test.invalid`})`;
  const [staff] = await db`
    insert into staff (display_name,email,role,auth_user_id,active,commission_type,commission_value)
    values (${`TEST ${key} ${tag}`},${`${key}-${tag}@test.invalid`},${role},${authUserId},true,'fixed',10)
    returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}

async function makeClient(i: number, hours: string) {
  const client = await db.begin((tx) =>
    insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: `TEST Pipeline ${tag} ${i}`, phone: nextPhone(), email: null, date_of_birth: "1992-03-04", employment_history: [] }),
      primary: [], backup: [], status: "new_intake" as never, nextStep: null,
      assignedStaff: null, createdBy: null, communicationConsent: true,
    }, { staffId: null, traceId: trace }));
  const id = String((client as { id: string }).id);
  await db`
    insert into client_preferences (client_id,rank,preference_order,city,site_code,site_name,job_id,job_title,shift_code,hours)
    values (${id},'primary',1,'Detroit',${SITE},${`TEST Site ${tag}`},'pb-job','TEST job','S1',${hours})`;
  await db`update clients set pipeline_stage=${STAGE},updated_at=now()-make_interval(secs => ${i}) where id=${id}`;
  created.push(id);
  return id;
}

beforeAll(async () => {
  admin = await makeStaff("pipeline-admin", "admin");
  const hours = ["06:00 AM", "1:30 PM", "11:00 م", "12:00 ص", "", "flexible", "18:15", "4:00"];
  for (let i = 0; i < PIPELINE_COLUMN_BATCH + 12; i++) await makeClient(i, hours[i % hours.length]);
});

afterAll(async () => {
  await db.end();
});

describe("dispatch period", () => {
  it("SQL and the browser classify every input the same way", async () => {
    const cases: [string | null, string | null, string | null][] = [];
    const codes = [null, "night", "morning", "S1"];
    const periods = [null, "morning", "evening", "night", "needs_manual_review", "unspecified", "other"];
    const hours = [null, "", "flexible", "06:00 AM", "6:00 am", "12:00 AM", "12:00 PM", "11:59 pm", "1:30 PM", "11:00 م", "12:00 ص",
      "4:00", "5:00", "11:59", "12:00", "21:59", "22:00", "23:30", "0:15", "24:00", "99:00", "from 7:00 to 15:00", "٠٧:٠٠", "7:00ص", "3:15 م"];
    for (const c of codes) for (const p of periods) for (const h of hours) cases.push([c, p, h]);

    const rows = await withStaff(admin, (tx) => tx`
      select i, ${dispatchPeriodSql(tx, "p")} period
      from jsonb_to_recordset(${tx.json(cases.map(([shift_code, shift_period, hours], i) => ({ i, shift_code, shift_period, hours })) as never)})
        as p(i int, shift_code text, shift_period text, hours text)
      order by i`);
    expect(rows).toHaveLength(cases.length);
    for (const row of rows) {
      const [shift_code, shift_period, shift_hours] = cases[row.i as number];
      expect(row.period, JSON.stringify(cases[row.i as number])).toBe(dispatchPeriod({ shift_code, shift_period, shift_hours }));
    }
  });
});

describe("pipeline board", () => {
  it("sends one window per column with each column's exact total", async () => {
    const data = await activePipelineData(admin);
    const [{ n }] = await withStaff(admin, (tx) => tx`
      select count(*)::int n from clients
      where deleted_at is null and current_status not in ('completed','cancelled') and pipeline_stage=${STAGE}`);
    const column = data.columns[STAGE];
    expect(column.total).toBe(n);
    expect(column.cards.length).toBe(Math.min(n, PIPELINE_COLUMN_BATCH));
    for (const stage of data.stages) expect(data.columns[stage.key].cards.length).toBeLessThanOrEqual(PIPELINE_COLUMN_BATCH);

    const [{ active }] = await withStaff(admin, (tx) => tx`
      select count(*)::int active from clients c
      where c.deleted_at is null and c.current_status not in ('completed','cancelled')
        and c.pipeline_stage not in (select key from pipeline_stages where terminal)`);
    expect(data.telemetry.total).toBe(active);
  });

  it("pages a column without gaps or repeats", async () => {
    const data = await activePipelineData(admin);
    const ids = data.columns[STAGE].cards.map((c) => c.id);
    while (ids.length < data.columns[STAGE].total) {
      const batch = await pipelineCards(admin, { kind: "stage", stage: STAGE, offset: ids.length });
      expect(batch.cards.length).toBeGreaterThan(0);
      ids.push(...batch.cards.map((c) => c.id));
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of created) expect(ids).toContain(id);
  });

  it("groups the test site into lanes whose totals cover every client", async () => {
    const locations = await pipelineLocationLanes(admin);
    const site = locations.find((l) => l.key === SITE);
    expect(site).toBeDefined();
    const laneTotal = Object.values(site!.lanes).reduce((n, lane) => n + lane.total, 0);
    expect(laneTotal).toBe(created.length);
    expect(site!.total).toBe(created.length);

    const shown = new Set<string>();
    for (const [period, lane] of Object.entries(site!.lanes)) {
      const ids = lane.cards.map((c) => c.id);
      while (ids.length < lane.total) {
        const batch = await pipelineCards(admin, { kind: "lane", site: SITE, period: period as never, offset: ids.length });
        ids.push(...batch.cards.map((c) => c.id));
      }
      for (const id of ids) shown.add(id);
    }
    expect([...shown].sort()).toEqual([...created].sort());
  });

  it("returns nothing past the end of a column", async () => {
    const past = await pipelineCards(admin, { kind: "stage", stage: STAGE, offset: 10_000 });
    expect(past.cards).toEqual([]);
  });
});
