import "server-only";
import { registry } from "./config";

export type AuthResult<T> = { ok: true; data: T } | { ok: false; code: "NOT_CONFIGURED" | "REJECTED" | "PROVIDER_ERROR"; message: string };

export type Session = { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email: string } };

type GeneratedLinkResponse = {
  email_otp?: string;
  properties?: { email_otp?: string } | null;
};

async function call<T>(path: string, body: unknown, opts: { service?: boolean; bearer?: string } = {}): Promise<AuthResult<T>> {
  const { url, anonKey, serviceKey } = registry.supabase();
  const key = opts.service ? serviceKey : anonKey;
  if (!url || !key) return { ok: false, code: "NOT_CONFIGURED", message: "Supabase Auth is NOT_CONFIGURED" };
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, "")}/auth/v1${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${opts.bearer ?? key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, code: "PROVIDER_ERROR", message: e instanceof Error ? e.message : "network error" };
  }
  const data = (await res.json().catch(() => ({}))) as T & { msg?: string; error_description?: string; message?: string };
  if (!res.ok) {
    return {
      ok: false,
      code: res.status >= 500 ? "PROVIDER_ERROR" : "REJECTED",
      message: (data.msg ?? data.error_description ?? data.message ?? `HTTP ${res.status}`).slice(0, 200),
    };
  }
  return { ok: true, data };
}

/** Sends a 6-digit email sign-in code through the configured Supabase Auth mailer. */
export const sendEmailOtp = (email: string, createUser: boolean) =>
  call<Record<string, never>>("/otp", { email, create_user: createUser });

/**
 * Generates the same Supabase Auth email OTP without sending it.
 * This is used only as a delivery fallback when Supabase SMTP is unavailable;
 * verification still happens through Supabase Auth, so the session authority is unchanged.
 */
export async function generateEmailOtp(email: string): Promise<AuthResult<{ email_otp: string }>> {
  const r = await call<GeneratedLinkResponse>("/admin/generate_link", { type: "magiclink", email }, { service: true });
  if (!r.ok) return r;
  const otp = r.data.email_otp ?? r.data.properties?.email_otp;
  if (!otp || !/^\d{6}$/.test(otp)) {
    return { ok: false, code: "PROVIDER_ERROR", message: "Supabase Auth did not return a valid email OTP" };
  }
  return { ok: true, data: { email_otp: otp } };
}

export const verifyEmailOtp = (email: string, token: string) =>
  call<Session>("/verify", { type: "email", email, token });

export const refreshSession = (refreshToken: string) =>
  call<Session>("/token?grant_type=refresh_token", { refresh_token: refreshToken });

export const signOut = (accessToken: string) => call<unknown>("/logout", {}, { bearer: accessToken });

/** Admin invite (service role). Returns the created auth user. */
export const inviteUser = (email: string) =>
  call<{ id: string; email: string }>("/invite", { email }, { service: true });
