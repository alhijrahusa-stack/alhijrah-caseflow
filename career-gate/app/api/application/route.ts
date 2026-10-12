import { randomBytes } from "node:crypto";
import { z } from "zod";
import { fingerprint, newSessionToken, sha256Hex } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { DEFAULT_NEXT_STEP } from "@/lib/domain";
import { err, ipHash } from "@/lib/http";
import { claimKey, completeKey } from "@/lib/idempotency";
import { traceIdFrom } from "@/lib/obs";
import { hit } from "@/lib/ratelimit";
import { lockClientIdentity, logActivity, normalizeClientPhone, type Tx } from "@/lib/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OPERATION = "career_gate_html_application";
const UPLOAD_GRANT_SECONDS = 2 * 60 * 60;
const CASE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const FileMeta = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().max(100),
  size: z.number().int().nonnegative().max(4 * 1024 * 1024),
});

const Payload = z.object({
  uid: z.string().trim().min(8).max(200),
  caseNumber: z.string().trim().max(80).optional().default(""),
  service: z.string().trim().min(1).max(80),
  serviceLabel: z.string().trim().max(160).optional().default(""),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  dob: z.string().trim().max(20).optional().default(""),
  nationality: z.string().trim().max(100).optional().default(""),
  gender: z.string().trim().max(60).optional().default(""),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(200),
  preferredLanguage: z.enum(["ar", "en", "es"]).optional().default("ar"),
  address1: z.string().trim().max(200).optional().default(""),
  address2: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  state: z.string().trim().max(60).optional().default(""),
  zip: z.string().trim().max(20).optional().default(""),
  employmentStatus: z.string().trim().max(100).optional().default(""),
  hasExperience: z.string().trim().max(20).optional().default(""),
  englishLevel: z.string().trim().max(60).optional().default(""),
  education: z.string().trim().max(120).optional().default(""),
  lastTitle: z.string().trim().max(160).optional().default(""),
  startDate: z.string().trim().max(20).optional().default(""),
  workType: z.string().trim().min(1).max(100),
  shiftCode: z.string().trim().min(1).max(100),
  shift: z.string().trim().max(160).optional().default(""),
  shiftName: z.string().trim().max(160).optional().default(""),
  selectedShift: z.string().trim().max(160).optional().default(""),
  shiftDays: z.string().trim().max(160).optional().default(""),
  shiftHours: z.string().trim().max(160).optional().default(""),
  basePay: z.string().trim().max(80).optional().default(""),
  shiftDifferential: z.string().trim().max(80).optional().default(""),
  totalPay: z.string().trim().max(80).optional().default(""),
  branch: z.string().trim().min(1).max(100),
  branchName: z.string().trim().min(1).max(200),
  branchAddress: z.string().trim().max(300).optional().default(""),
  expectedPay: z.string().trim().max(80).optional().default(""),
  preferredLocations: z.array(z.string().trim().max(240)).max(3).default([]),
  location1Score: z.string().trim().max(20).optional().default(""),
  location2Score: z.string().trim().max(20).optional().default(""),
  location3Score: z.string().trim().max(20).optional().default(""),
  skills: z.array(z.string().trim().max(100)).max(30).default([]),
  docPrefs: z.array(z.string().trim().max(120)).max(20).default([]),
  files: z.array(FileMeta).max(8).default([]),
  photo: FileMeta.nullable().optional().default(null),
  signature: z.object({ captured: z.boolean(), type: z.string().trim().max(100).optional() }),
  consent: z.literal(true),
  userAgent: z.string().max(500).optional().default(""),
  honeypot: z.string().max(0).optional().default(""),
}).passthrough();

type Intake = z.infer<typeof Payload>;
type ClientRow = { id: string; ref: string; created_at: Date };

class IdentityConflictError extends Error {}

function makeCaseNumber() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const bytes = randomBytes(4);
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += CASE_ALPHABET[bytes[i] % CASE_ALPHABET.length];
  return `ALH-${get("year")}${get("month")}${get("day")}-${suffix}`;
}

const nullable = (v: string) => v.trim() || null;
const dateOrNull = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const branchCity = (name: string) => name.split(/\s+-\s+/)[0]?.trim() || name.trim();

async function newUploadGrant(clientId: string) {
  const token = newSessionToken();
  await sql()`insert into upload_grants (client_id, token_hash, expires_at)
              values (${clientId}, ${sha256Hex(`upload:${token}`)}, ${new Date(Date.now() + UPLOAD_GRANT_SECONDS * 1000)})`;
  return token;
}

async function insertApplication(tx: Tx, clientId: string, d: Intake) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const caseNumber = makeCaseNumber();
    const rows = await tx`
      insert into career_gate_applications (
        submission_uid, case_number, client_id, service, status, next_step, branch, branch_name, branch_address,
        work_type, shift, shift_code, shift_days, shift_hours, expected_pay, start_date, intake_snapshot
      ) values (
        ${d.uid}, ${caseNumber}, ${clientId}, ${d.service}, 'new_intake', ${DEFAULT_NEXT_STEP.new_intake},
        ${d.branch}, ${d.branchName}, ${nullable(d.branchAddress)}, ${d.workType},
        ${nullable(d.shiftName || d.shift || d.selectedShift)}, ${d.shiftCode},
        ${nullable(d.shiftDays)}, ${nullable(d.shiftHours)}, ${nullable(d.expectedPay || d.totalPay)},
        ${dateOrNull(d.startDate)}, ${tx.json(d as never)}
      )
      on conflict (case_number) do nothing
      returning id, case_number, created_at`;
    if (rows.length) return rows[0] as { id: string; case_number: string; created_at: Date };
  }
  throw new Error("Could not allocate a unique case number");
}

async function upsertOperationalClient(tx: Tx, d: Intake, digits: string): Promise<{ client: ClientRow; reused: boolean }> {
  const email = d.email.trim().toLowerCase();
  const fullName = `${d.firstName} ${d.lastName}`.trim();
  const normalizedName = fullName.replace(/\s+/g, " ").toLowerCase();
  const street = [d.address1, d.address2].filter(Boolean).join(", ") || null;
  const dob = dateOrNull(d.dob);

  // Email is only a candidate identity key; shared family/office email is permitted.
  // Phone alone must never overwrite or merge another applicant's client record.
  await lockClientIdentity(tx, email, null);
  const [sameApplicant] = await tx`
    select id from clients
    where deleted_at is null
      and lower(trim(email)) = ${email}
      and (
        (
          lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) = ${normalizedName}
          and ${dob}::date is not null and date_of_birth = ${dob}::date
        )
        or (
          lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) = ${normalizedName}
          and (date_of_birth is null or ${dob}::date is null or date_of_birth = ${dob}::date)
          and length(${digits}) >= 7
          and regexp_replace(coalesce(phone,''), '\\D', '', 'g') = ${digits}
        )
        or (
          ${dob}::date is not null and date_of_birth = ${dob}::date
          and length(${digits}) >= 7
          and regexp_replace(coalesce(phone,''), '\\D', '', 'g') = ${digits}
          and (full_name is null or lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) = ${normalizedName})
        )
      )
    limit 1 for update`;
  if (sameApplicant) {
    throw new IdentityConflictError("A prior application for this applicant needs staff review.");
  }

  const [client] = await tx`
    insert into clients (
      source, full_name, phone, email, date_of_birth, preferred_language, street, city, state, zip,
      communication_consent, current_status, next_step, start_date
    ) values (
      'public_intake', ${fullName}, ${digits}, ${email}, ${dob}, ${d.preferredLanguage || 'ar'},
      ${street}, ${nullable(d.city)}, ${nullable(d.state)}, ${nullable(d.zip)},
      true, 'new_intake', ${DEFAULT_NEXT_STEP.new_intake}, ${dateOrNull(d.startDate)}
    )
    returning id, ref, created_at`;
  return { client: client as ClientRow, reused: false };
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const raw = await req.json().catch(() => undefined);
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const d = parsed.data;
  if (!d.signature.captured) return NextResponse.json({ ok: false, message: "Signature is required" }, { status: 400 });

  if (d.zip && !/^\d{5}(-\d{4})?$/.test(d.zip)) {
    return NextResponse.json({ ok: false, code: "invalid_zip", message: "Enter a valid five-digit US ZIP code." }, { status: 400 });
  }
  if (d.dob && !dateOrNull(d.dob)) {
    return NextResponse.json({ ok: false, code: "invalid_date", message: "Enter a valid date of birth." }, { status: 400 });
  }
  const digits = normalizeClientPhone(d.phone) ?? "";
  if (digits.length < 10 || digits.length > 15) {
    return NextResponse.json({ ok: false, message: "Enter a valid phone number" }, { status: 400 });
  }

  const ip = ipHash(req);
  if (!(await hit("intake_attempt_hour", ip))) return err("rate_limited", "Too many submissions. Try again later.", 429, traceId);

  const fp = fingerprint(d);
  const db = sql();

  try {
    const out = await db.begin(async (tx) => {
      const claim = await claimKey(tx, OPERATION, d.uid, fp);
      if (claim.kind === "conflict") return { kind: "conflict" as const };
      if (claim.kind === "replay") return { kind: "replay" as const, status: claim.status, body: claim.body as Record<string, unknown> };

      // Public-provided references are NEVER identity proof. Block exact existing
      // case/client reference before any new canonical client is created.
      if (d.caseNumber.trim()) {
        const caseKey = d.caseNumber.trim().toUpperCase();
        const matches = await tx`
          select 1 from clients where deleted_at is null and upper(ref) = ${caseKey}
          union all
          select 1 from career_gate_applications where upper(case_number) = ${caseKey}
          limit 1`;
        if (matches.length) return { kind: "case_duplicate" as const };
      }

      const { client, reused } = await upsertOperationalClient(tx, d, digits);
      const app = await insertApplication(tx, client.id, d);

      await tx`
        insert into client_preferences (
          client_id, rank, preference_order, city, site_code, site_name, site_address,
          job_id, job_title, employment_type, shift_code, days, hours, pay_snapshot,
          catalog_source, catalog_verified_at, catalog_version, amazon_job_id, shift_name, source_url, source_verified_at, pay_detail
        ) values (
          ${client.id}, 'primary', 1, ${branchCity(d.branchName)}, ${d.branch}, ${d.branchName}, ${nullable(d.branchAddress)},
          'career-gate-intake', ${nullable(d.lastTitle) ?? 'Employment Request'}, ${d.workType}, ${d.shiftCode},
          ${nullable(d.shiftDays)}, ${nullable(d.shiftHours)}, ${nullable(d.expectedPay || d.totalPay)},
          'career_gate_html', null, 'career_gate_html', null, ${nullable(d.shiftName || d.shift || d.selectedShift)},
          null, null, ${tx.json({ display_pay: d.expectedPay || d.totalPay || null } as never)}
        )`;

      await logActivity(tx, {
        clientId: client.id,
        action: reused ? "client_updated" : "client_created",
        actor: { staffId: null, traceId },
        entityType: "application",
        entityId: app.id,
        newValue: {
          ref: client.ref,
          case_number: app.case_number,
          status: "new_intake",
          source: "career_gate_html",
          existing_client: reused,
        },
      });

      const body = {
        ok: true,
        caseNumber: app.case_number,
        systemId: client.ref,
        trackingUrl: `/career-gate.html?track=1&case=${encodeURIComponent(app.case_number)}`,
        submittedAt: new Date(app.created_at).toISOString(),
        client_id: client.id,
        existing_client: reused,
      };
      await completeKey(tx, OPERATION, d.uid, 201, body);
      return { kind: "new" as const, status: 201, body };
    });

    if (out.kind === "conflict") {
      return NextResponse.json({ ok: false, message: "This submission ID was already used with different data." }, { status: 409 });
    }
    if (out.kind === "case_duplicate") {
      // Do not disclose matching applicant name, case, email, DOB or account details.
      return NextResponse.json({
        ok: false, code: "case_number_exists",
        message: "An application reference already exists. Please contact customer service.",
      }, { status: 409 });
    }

    const body = out.body;
    const clientId = String(body.client_id ?? "");
    let uploadToken: string | undefined;
    if (clientId) {
      try {
        uploadToken = await newUploadGrant(clientId);
      } catch (grantError) {
        // The application transaction already committed. Never report a false submit failure.
        console.error("application_upload_grant_failed", { traceId, grantError });
      }
    }
    const caseNumber = String(body.caseNumber ?? "");

    return NextResponse.json({
      ok: true,
      duplicate: out.kind === "replay",
      existingCase: out.kind === "replay" ? caseNumber : undefined,
      caseNumber,
      systemId: body.systemId,
      trackingUrl: body.trackingUrl,
      submittedAt: body.submittedAt,
      upload_token: uploadToken,
      upload_available: Boolean(uploadToken),
    }, { status: out.kind === "new" ? 201 : 200 });
  } catch (e) {
    console.error(e);
    if (e instanceof IdentityConflictError) {
      return NextResponse.json({
        ok: false,
        code: "existing_applicant",
        message: "An application for this applicant already exists. Please contact customer service for assistance.",
        trace_id: traceId,
      }, { status: 409 });
    }
    return NextResponse.json({ ok: false, code: "submission_failed", message: "Could not submit the application. Please retry without changing your information.", trace_id: traceId }, { status: 500 });
  }
}
