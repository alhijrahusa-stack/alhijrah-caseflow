import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test";
import { SignJWT } from "jose";
import postgres from "postgres";

/** Choose through the visible custom combobox, including its portalled listbox. */
export async function selectChoice(control: Locator, choice: string | { label: string } | { value: string }) {
  // A broad getByLabel locator may also match the listbox after it opens.
  // Keep the locator restricted to the actual control throughout the action.
  const combobox = control.and(control.page().getByRole("combobox"));
  await combobox.click();
  const listId = await combobox.getAttribute("aria-controls");
  if (!listId) throw new Error("Dropdown did not open an accessible listbox");
  const list = control.page().locator(`[id=${JSON.stringify(listId)}]`);
  const option = typeof choice === "object" && "label" in choice
    ? list.getByRole("option", { name: choice.label, exact: true })
    : list.locator(`[role="option"][data-value=${JSON.stringify(typeof choice === "string" ? choice : choice.value)}]`);
  await option.click();
}

// Use the employee's file-picker flow. Injecting a hidden input before React
// attaches its change handler can leave the native file and form state apart.
export async function chooseImportSpreadsheet(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Choose XLSX \/ CSV/ }).click(),
  ]);
  await chooser.setFiles(file);
}

// Local e2e helpers. Staff sessions are Supabase-format access tokens signed
// with the test SUPABASE_JWT_SECRET, which exercises the app's real JWT
// verification, RBAC and RLS. The Supabase login round trip itself needs the
// live project and is not covered here.
export const STAFF = {
  admin: "00000000-0000-4000-8000-00000000a001",
  manager: "00000000-0000-4000-8000-00000000a002",
  staff: "00000000-0000-4000-8000-00000000a003",
} as const;
export type Role = keyof typeof STAFF;

export const RUN = Date.now().toString(36);
/** Set by e2e/run.sh: "fixture" (test catalog built in) or "real" (committed catalog, currently empty). */
export const FIXTURE_CATALOG = (process.env.E2E_CATALOG ?? "fixture") === "fixture";
export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000004000000040802000000269309290000000970485973000003e8000003e801b57b526b0000000f49444154089963f88f041888e30000db902fd1ecba04730000000049454e44ae426082",
  "hex",
);

let sqlClient: postgres.Sql | null = null;
export const db = () => (sqlClient ??= postgres(process.env.DATABASE_URL!, { max: 2, prepare: false, types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } } }));

export async function accessToken(role: Role) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return new SignJWT({ role: "authenticated", email: `${role}@test.invalid` })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(`${url}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(STAFF[role])
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!));
}

export async function signIn(context: BrowserContext, baseURL: string, role: Role) {
  await context.clearCookies();
  await context.addCookies([{ name: "cg_at", value: await accessToken(role), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}

export const uniqueIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** Seeds a known code for a challenge (delivery providers are NOT_CONFIGURED locally). */
export async function seedOtp(challengeId: string, code: string) {
  const [r] = await db()`select client_id from otp_requests where id = ${challengeId}`;
  if (!r?.client_id) return false;
  const hash = createHmac("sha256", process.env.STATUS_OTP_PEPPER!).update(`${challengeId}:${code}`).digest("hex");
  await db()`update otp_requests set otp_hash = ${hash}, delivery_status = 'sent' where id = ${challengeId}`;
  return true;
}

export function intakeBody(name: string, extra: Record<string, unknown> = {}) {
  const identity = randomUUID().replace(/-/g, "");
  const phoneToken = parseInt(identity.slice(0, 8), 16) % 10_000_000;
  const phone = `313${String(phoneToken).padStart(7, "0")}`;
  const emailToken = identity.slice(8, 20);
  const emailName = name.replace(/\W/g, "").toLowerCase() || "test";
  return {
    state: "MI",
    profile: { full_name: name, phone, email: `${emailName}.${emailToken}@test.invalid`, employment_history: [] },
    primary: FIXTURE_CATALOG ? [{ site_code: "TST1", job_id: "J-A", shift_code: "S1" }] : [],
    backup: [],
    communication_consent: true,
    authorization: { version: "2026-09-28.1", accepted: true, accuracy_acknowledged: true, printed_name: name, signature: name },
    ...extra,
  };
}

export async function submitIntake(request: APIRequestContext, body: unknown, key = randomUUID(), ip = uniqueIp()) {
  const res = await request.post("/api/intake", { data: body, headers: { "Idempotency-Key": key, "x-forwarded-for": ip } });
  return { res, json: await res.json(), key, ip };
}

export async function staffAction(request: APIRequestContext, role: Role, payload: Record<string, unknown>) {
  const res = await request.post("/api/staff/action", {
    data: payload,
    headers: { cookie: `cg_at=${await accessToken(role)}`, "x-forwarded-for": uniqueIp() },
  });
  return { status: res.status(), json: await res.json() };
}


export async function passedInterviewFixture(request:APIRequestContext,clientId:string){
  const moved=await staffAction(request,"admin",{action:"override_status",client_id:clientId,status:"appointment_scheduled",reason:"E2E interview fixture"});
  if(moved.status!==200)throw new Error(JSON.stringify(moved.json));
  const [actor]=await db()`select id from staff where auth_user_id=${STAFF.admin}`;
  const [appointment]=await db()`insert into appointments(client_id,appointment_type,appointment_kind,scheduled_at,ends_at,resource_key,created_by_staff,status)
    values(${clientId},'E2E employment interview','employment_interview',now()-interval '4 days',now()-interval '4 days'+interval '30 minutes','office',${actor.id},'attended') returning id`;
  const result=await staffAction(request,"admin",{action:"appointment_decision",appointment_id:appointment.id,decision:"pass",note:"E2E verified interview result"});
  if(result.status!==200)throw new Error(JSON.stringify(result.json));
  return result;
}
