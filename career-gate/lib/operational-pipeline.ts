import "server-only";
import { ACCOUNT_NET_FEE } from "@/lib/accounting-schema";
import { withStaff, type StaffSession, type Tx } from "@/lib/auth";
import type { PipelineClient, PipelineStage } from "@/lib/operations";
import { DISPATCH_PERIODS, SHIFT_HOURS_PATTERN, type DispatchPeriod } from "@/lib/pipeline-period";

/** Cards sent per pipeline column and per location lane before the user asks for more. */
export const PIPELINE_COLUMN_BATCH = 20;
export const PIPELINE_LANE_BATCH = 24;
export const PIPELINE_EXCEPTION_BATCH = 20;
const NO_SITE = "no-location";

export type PipelineCard = PipelineClient & { dispatch_period: DispatchPeriod };
export type PipelineColumn = { cards: PipelineCard[]; total: number };

export type LocationAggregate = {
  code: string;
  name: string | null;
  morning: number;
  evening: number;
  night: number;
  needs_manual_review: number;
};

export type PipelineBoardData = {
  stages: PipelineStage[];
  columns: Record<string, PipelineColumn>;
  exceptions: PipelineColumn;
  telemetry: { locations: LocationAggregate[]; total: number; assigned: number };
};

export type LocationLanes = {
  key: string;
  siteCode: string;
  siteName: string;
  siteAddress: string | null;
  total: number;
  lanes: Record<DispatchPeriod, PipelineColumn>;
};

/**
 * The SQL form of `dispatchPeriod()` for a row aliased `alias` carrying
 * `shift_code`, `shift_period` and `hours`. The hour pattern is bound as a
 * parameter so both sides read the same expression.
 */
export function dispatchPeriodSql(tx: Tx, alias: string) {
  const a = tx.unsafe(alias);
  return tx`(case
    when ${a}.shift_code='night' then 'night'
    when ${a}.shift_code='morning' then 'morning'
    when ${a}.shift_period in ('morning','evening','night','needs_manual_review') then ${a}.shift_period
    when ${a}.shift_period='unspecified' then 'needs_manual_review'
    else (
      select case
        when hh.hour is null then 'needs_manual_review'
        when hh.hour between 5 and 11 then 'morning'
        when hh.hour between 12 and 21 then 'evening'
        when hh.hour between 0 and 23 then 'night'
        else 'needs_manual_review'
      end
      from (
        select case when hm.m is null then null else
          (hm.m[1])::int + case
            when lower(coalesce(hm.m[2],'')) in ('م','pm') and (hm.m[1])::int<12 then 12
            when lower(coalesce(hm.m[2],'')) in ('ص','am') and (hm.m[1])::int=12 then -12
            else 0 end
        end as hour
        from (select regexp_match(nullif(${a}.hours,''),${SHIFT_HOURS_PATTERN}) m) hm
      ) hh
    )
  end)`;
}

const ACTIVE = "c.deleted_at is null and c.current_status not in ('completed','cancelled')";

/** The primary preference of client `c`, as a lateral subquery. */
function primaryPreference(tx: Tx) {
  return tx`lateral (
    select site_code,site_name,site_address,shift_code,shift_name,days,hours,shift_period,auto_dispatched_at
    from client_preferences p where p.client_id=c.id
    order by case p.rank when 'primary' then 0 else 1 end,p.preference_order limit 1
  )`;
}

/** Active clients with only what grouping needs: stage, site, owner and dispatch period. */
function locatedBase(tx: Tx) {
  return tx`
    base as (
      select c.id,c.pipeline_stage,c.updated_at,c.assigned_staff,p.site_code,p.site_name,
             ${dispatchPeriodSql(tx, "p")} dispatch_period
      from clients c
      left join ${primaryPreference(tx)} p on true
      where ${tx.unsafe(ACTIVE)}
    )`;
}

/**
 * Card fields for the rows of a CTE named `picked(id, rn, total)` only, so
 * names, preferences and account figures are read for shown cards alone.
 */
function pickedCards(tx: Tx) {
  return tx`
    select c.id,c.ref,c.full_name,c.pipeline_stage,c.current_status,c.next_step,c.assigned_staff,
           s.display_name assigned_name,
           p.site_code,p.site_name,p.site_address,p.shift_code,p.shift_name,p.days shift_days,p.hours shift_hours,p.shift_period,p.auto_dispatched_at,
           a.payment_status,${tx.unsafe(ACCOUNT_NET_FEE("a"))} fee_amount,
           ${dispatchPeriodSql(tx, "p")} dispatch_period,
           k.rn,k.total
    from picked k
    join clients c on c.id=k.id
    left join staff s on s.id=c.assigned_staff
    left join ${primaryPreference(tx)} p on true
    left join client_accounts a on a.client_id=c.id`;
}

function card(row: Record<string, unknown>): PipelineCard {
  return {
    id: String(row.id),
    ref: String(row.ref),
    full_name: String(row.full_name),
    pipeline_stage: String(row.pipeline_stage),
    current_status: String(row.current_status),
    next_step: String(row.next_step ?? ""),
    assigned_staff: (row.assigned_staff as string | null) ?? null,
    assigned_name: (row.assigned_name as string | null) ?? null,
    site_code: (row.site_code as string | null) ?? null,
    site_name: (row.site_name as string | null) ?? null,
    site_address: (row.site_address as string | null) ?? null,
    shift_code: (row.shift_code as string | null) ?? null,
    shift_name: (row.shift_name as string | null) ?? null,
    shift_days: (row.shift_days as string | null) ?? null,
    shift_hours: (row.shift_hours as string | null) ?? null,
    shift_period: (row.shift_period as PipelineClient["shift_period"]) ?? null,
    auto_dispatched_at: row.auto_dispatched_at == null ? null : String(row.auto_dispatched_at),
    payment_status: (row.payment_status as PipelineClient["payment_status"]) ?? null,
    fee_amount: row.fee_amount == null ? null : Number(row.fee_amount),
    dispatch_period: row.dispatch_period as DispatchPeriod,
  };
}

async function readStages(tx: Tx) {
  const stages = (await tx`select key,position,label_en,label_ar,color,terminal from pipeline_stages order by position`) as unknown as PipelineStage[];
  return { stages, terminal: stages.filter((s) => s.terminal).map((s) => s.key) };
}

/**
 * The pipeline board: the first cards of every column with each column's
 * exact total, the files held in terminal stages, and location/shift totals
 * aggregated over every active client.
 */
export async function activePipelineData(session: StaffSession): Promise<PipelineBoardData> {
  return withStaff(session, async (tx) => {
    const { stages, terminal } = await readStages(tx);
    const [columnRows, telemetryRows] = await Promise.all([
      tx`
        with ranked as (
          select c.id,c.pipeline_stage,
                 row_number() over (partition by c.pipeline_stage order by c.updated_at desc,c.id) rn,
                 count(*) over (partition by c.pipeline_stage)::int total
          from clients c
          where ${tx.unsafe(ACTIVE)}
        ),
        picked as (select id,rn,total from ranked where rn <= ${Math.max(PIPELINE_COLUMN_BATCH, PIPELINE_EXCEPTION_BATCH)})
        ${pickedCards(tx)}
        order by c.pipeline_stage,k.rn`,
      tx`
        with ${locatedBase(tx)}
        select coalesce(site_code,'unselected') code,min(site_name) name,dispatch_period,
               count(*)::int n,count(*) filter (where assigned_staff is not null)::int assigned
        from base
        where pipeline_stage <> all(${terminal})
        group by 1,3`,
    ]);

    const columns: Record<string, PipelineColumn> = {};
    const exceptions: PipelineColumn = { cards: [], total: 0 };
    const terminalSet = new Set(terminal);
    for (const stage of stages) if (!stage.terminal) columns[stage.key] = { cards: [], total: 0 };
    for (const row of columnRows as unknown as Record<string, unknown>[]) {
      const key = String(row.pipeline_stage);
      if (terminalSet.has(key)) {
        if (exceptions.cards.length < PIPELINE_EXCEPTION_BATCH) exceptions.cards.push(card(row));
        continue;
      }
      const column = (columns[key] ??= { cards: [], total: 0 });
      column.total = Number(row.total);
      if (Number(row.rn) <= PIPELINE_COLUMN_BATCH) column.cards.push(card(row));
    }
    const terminalTotals = new Map<string, number>();
    for (const row of columnRows as unknown as Record<string, unknown>[]) {
      const key = String(row.pipeline_stage);
      if (terminalSet.has(key)) terminalTotals.set(key, Number(row.total));
    }
    exceptions.total = [...terminalTotals.values()].reduce((n, v) => n + v, 0);

    const byCode = new Map<string, LocationAggregate>();
    let total = 0;
    let assigned = 0;
    for (const row of telemetryRows as unknown as { code: string; name: string | null; dispatch_period: DispatchPeriod; n: number; assigned: number }[]) {
      const entry = byCode.get(row.code) ?? { code: row.code, name: row.name, morning: 0, evening: 0, night: 0, needs_manual_review: 0 };
      entry[row.dispatch_period] += Number(row.n);
      entry.name ??= row.name;
      byCode.set(row.code, entry);
      total += Number(row.n);
      assigned += Number(row.assigned);
    }

    return {
      stages: stages.filter((s) => !s.terminal),
      columns,
      exceptions,
      telemetry: { locations: [...byCode.values()], total, assigned },
    };
  });
}

/** Location & shift dispatcher: the first cards of every (site, period) lane with each lane's exact total. */
export async function pipelineLocationLanes(session: StaffSession): Promise<LocationLanes[]> {
  return withStaff(session, async (tx) => {
    const { terminal } = await readStages(tx);
    const rows = (await tx`
      with ${locatedBase(tx)},
      ranked as (
        select id,coalesce(site_code,${NO_SITE}) site_key,dispatch_period lane,
               row_number() over (partition by coalesce(site_code,${NO_SITE}),dispatch_period order by updated_at desc,id) rn,
               count(*) over (partition by coalesce(site_code,${NO_SITE}),dispatch_period)::int total
        from base
        where pipeline_stage <> all(${terminal})
      ),
      picked as (select id,rn,total from ranked where rn <= ${PIPELINE_LANE_BATCH})
      ${pickedCards(tx)}
      order by coalesce(p.site_code,${NO_SITE}),k.rn`) as unknown as Record<string, unknown>[];

    const groups = new Map<string, LocationLanes>();
    for (const row of rows) {
      const c = card(row);
      const key = c.site_code ?? NO_SITE;
      const group = groups.get(key) ?? {
        key,
        siteCode: c.site_code ?? "NO SITE",
        siteName: c.site_name ?? "Location not selected",
        siteAddress: c.site_address,
        total: 0,
        lanes: Object.fromEntries(DISPATCH_PERIODS.map((p) => [p, { cards: [], total: 0 }])) as unknown as Record<DispatchPeriod, PipelineColumn>,
      };
      const lane = group.lanes[c.dispatch_period];
      if (lane.cards.length === 0) {
        lane.total = Number(row.total);
        group.total += lane.total;
      }
      lane.cards.push(c);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => `${a.siteName} ${a.siteCode}`.localeCompare(`${b.siteName} ${b.siteCode}`));
  });
}

export type PipelineCardQuery =
  | { kind: "stage"; stage: string; offset: number }
  | { kind: "lane"; site: string; period: DispatchPeriod; offset: number };

/** The next batch of one column or lane, in the board's own order. */
export async function pipelineCards(session: StaffSession, query: PipelineCardQuery): Promise<PipelineColumn> {
  return withStaff(session, async (tx) => {
    const { terminal } = await readStages(tx);
    const limit = query.kind === "stage" ? PIPELINE_COLUMN_BATCH : PIPELINE_LANE_BATCH;
    const rows = (query.kind === "stage"
      ? await tx`
          with ranked as (
            select c.id,row_number() over (order by c.updated_at desc,c.id) rn,count(*) over ()::int total
            from clients c
            where ${tx.unsafe(ACTIVE)} and c.pipeline_stage=${query.stage}
          ),
          picked as (select id,rn,total from ranked where rn > ${query.offset} and rn <= ${query.offset + limit})
          ${pickedCards(tx)}
          order by k.rn`
      : await tx`
          with ${locatedBase(tx)},
          ranked as (
            select id,row_number() over (order by updated_at desc,id) rn,count(*) over ()::int total
            from base
            where pipeline_stage <> all(${terminal}) and coalesce(site_code,${NO_SITE})=${query.site} and dispatch_period=${query.period}
          ),
          picked as (select id,rn,total from ranked where rn > ${query.offset} and rn <= ${query.offset + limit})
          ${pickedCards(tx)}
          order by k.rn`) as unknown as Record<string, unknown>[];
    return { cards: rows.map(card), total: Number(rows[0]?.total ?? 0) };
  });
}
