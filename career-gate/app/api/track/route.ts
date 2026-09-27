import { z } from "zod";
import { sql } from "@/lib/db";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import { err, ipHash } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { hit, securityEvent } from "@/lib/ratelimit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const RequestSchema = z.object({
  type: z.enum(["case", "email", "phone"]),
  value: z.string().trim().min(3).max(200),
});

function dt(v: unknown) {
  if (!v) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(String(v)));
}

function dateOnly(v: unknown) {
  if (!v) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit", dateStyle: "medium",
  }).format(new Date(String(v)));
}

function timeOnly(v: unknown) {
  if (!v) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit", timeStyle: "short",
  }).format(new Date(String(v)));
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const parsed = RequestSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Invalid search value" }, { status: 400 });

  const ip = ipHash(req);
  const a = await hit("status_lookup_15min", ip);
  const b = await hit("status_lookup_hour", ip);
  if (!a || !b) {
    await securityEvent({ event: "rate_limited_status_lookup", ipHash: ip, route: "/api/track", traceId });
    return err("rate_limited", "Too many lookups. Try again later.", 429, traceId);
  }

  const db = sql();
  const { type, value } = parsed.data;
  let client: { id: string } | undefined;

  if (type === "case") {
    [client] = await db`
      select c.id
      from clients c
      left join career_gate_applications a on a.client_id = c.id
      where c.deleted_at is null
        and (upper(c.ref) = ${value.toUpperCase()} or upper(a.case_number) = ${value.toUpperCase()})
      order by c.updated_at desc
      limit 1` as unknown as [{ id: string }?];
  } else if (type === "email") {
    [client] = await db`
      select id from clients
      where deleted_at is null and lower(email) = ${value.toLowerCase()}
      order by updated_at desc limit 1` as unknown as [{ id: string }?];
  } else {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7) return NextResponse.json({ ok: false, message: "No matching file" }, { status: 404 });
    [client] = await db`
      select id from clients
      where deleted_at is null and regexp_replace(phone, '\\D', '', 'g') = ${digits}
      order by updated_at desc limit 1` as unknown as [{ id: string }?];
  }

  if (!client) return NextResponse.json({ ok: false, message: "No matching file" }, { status: 404 });

  const [c] = await db`
    select c.id, c.ref, c.full_name, c.current_status, c.next_step, c.created_at, c.updated_at,
           a.case_number, a.expected_pay
    from clients c
    left join lateral (
      select case_number, expected_pay
      from career_gate_applications where client_id = c.id
      order by created_at desc limit 1
    ) a on true
    where c.id = ${client.id} and c.deleted_at is null`;

  const [pref] = await db`
    select site_code, site_name, site_address, shift_name, shift_code, days, hours, pay_snapshot
    from client_preferences
    where client_id = ${client.id}
    order by case rank when 'primary' then 0 else 1 end, preference_order, created_at
    limit 1`;

  const [interview] = await db`
    select appointment_type, scheduled_at, location
    from appointments
    where client_id = ${client.id}
      and status in ('scheduled', 'confirmed', 'rescheduled')
      and ends_at >= now()
      and lower(appointment_type) like '%interview%'
    order by scheduled_at limit 1`;

  const [doc] = await db`
    select count(*) filter (
             where file_name <> 'signature.png' and file_name not like 'client-photo-%'
           )::int as total,
           count(*) filter (
             where file_name <> 'signature.png' and file_name not like 'client-photo-%' and status = 'verified'
           )::int as verified
    from documents where client_id = ${client.id}`;

  const history = await db`
    select action, new_value, created_at
    from activity_log
    where client_id = ${client.id}
      and action in ('client_created', 'status_changed', 'status_overridden', 'next_step_changed')
    order by created_at asc`;

  const current = String(c.current_status) as Status;
  const updates = history.map((r) => {
    const nv = (r.new_value ?? {}) as Record<string, unknown>;
    const status = String(nv.status ?? (r.action === "next_step_changed" ? "Next Step" : current));
    const update = r.action === "next_step_changed"
      ? String(nv.next_step ?? nv.nextStep ?? "Next step updated")
      : (STATUS_LABELS[status as Status] ?? status.replace(/_/g, " "));
    return { status: STATUS_LABELS[status as Status] ?? status.replace(/_/g, " "), timestamp: dt(r.created_at), update };
  });

  const caseNumber = String(c.case_number ?? c.ref);
  const jobLocation = pref ? [pref.site_name, pref.site_address].filter(Boolean).join(" — ") : "";

  return NextResponse.json({
    ok: true,
    application: {
      fullName: c.full_name,
      caseNumber,
      submittedAt: dt(c.created_at),
      jobLocation,
      branchName: pref?.site_name ?? "",
      shift: pref?.shift_name ?? pref?.shift_code ?? "",
      shiftCode: pref?.shift_code ?? "",
      shiftDays: pref?.days ?? "",
      shiftHours: pref?.hours ?? "",
      expectedPay: c.expected_pay ?? pref?.pay_snapshot ?? "",
      currentStatus: STATUS_LABELS[current] ?? current.replace(/_/g, " "),
      nextStep: c.next_step,
      documentsStatus: Number(doc?.total ?? 0) > 0 && Number(doc?.verified ?? 0) === Number(doc?.total ?? 0) ? "Complete" : "Missing",
      lastStatusUpdate: dt(c.updated_at),
      interview: interview ? {
        date: dateOnly(interview.scheduled_at),
        time: timeOnly(interview.scheduled_at),
        location: interview.location ?? "",
      } : null,
    },
    updates,
  });
}
