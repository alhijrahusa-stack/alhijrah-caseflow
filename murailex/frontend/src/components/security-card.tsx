"use client";

import { KeyRound, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";

type SessionRow = {
  id: string;
  current: boolean;
  created_at: string | null;
  last_seen_at: string | null;
  ip: string | null;
  user_agent: string | null;
  mfa_verified: boolean;
};

function device(ua: string | null): string {
  if (!ua) return "—";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

/** Two-factor authentication (TOTP) enrolment and active-session management. */
export function SecurityCard({ rtl }: { rtl: boolean }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disablePw, setDisablePw] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      api<{ enabled: boolean }>("/api/auth/mfa"),
      api<{ sessions: SessionRow[] }>("/api/auth/sessions"),
    ]);
    setEnabled(m.enabled);
    setSessions(s.sessions);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load().catch(() => undefined);
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setErr(null);
    try {
      await fn();
      toast(ok);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Error");
    }
  }

  return (
    <Card className="space-y-5" data-testid="security-card">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>{rtl ? "الأمان" : "Security"}</CardTitle>
        {enabled !== null && (
          <Badge tone={enabled ? "ok" : "warn"}>
            <ShieldCheck className="size-3.5" /> {enabled ? (rtl ? "التحقق الثنائي مفعّل" : "2FA on") : rtl ? "التحقق الثنائي غير مفعّل" : "2FA off"}
          </Badge>
        )}
      </div>

      {enabled === false && !setup && (
        <Button variant="secondary" onClick={() => act(async () => setSetup(await api("/api/auth/mfa/setup", { method: "POST" })), rtl ? "امسح المفتاح في تطبيق المصادقة" : "Add the key to your authenticator app")} data-testid="mfa-setup">
          <KeyRound /> {rtl ? "تفعيل التحقق الثنائي" : "Enable two-factor authentication"}
        </Button>
      )}

      {enabled === false && setup && (
        <div className="space-y-3 rounded-xl border border-line bg-surface-2/60 p-4">
          <p className="text-sm text-fg-muted">
            {rtl
              ? "أضف هذا المفتاح إلى تطبيق مصادقة (TOTP، 6 أرقام، 30 ثانية)، ثم أدخل الرمز الحالي."
              : "Add this key to an authenticator app (TOTP, 6 digits, 30 s), then enter the current code."}
          </p>
          <code className="block select-all break-all rounded-lg border border-line bg-canvas px-3 py-2 text-center font-mono text-sm tracking-widest text-primary-text" dir="ltr" data-testid="mfa-secret">
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <a href={setup.otpauth_uri} className="block text-center text-xs text-primary-text underline" dir="ltr">
            {rtl ? "فتح في تطبيق المصادقة على هذا الجهاز" : "Open in an authenticator app on this device"}
          </a>
          <div className="flex gap-2">
            <Input inputMode="numeric" autoComplete="one-time-code" dir="ltr" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className="text-center font-mono tracking-[0.3em]" data-testid="mfa-code" />
            <Button onClick={() => act(async () => { await api("/api/auth/mfa/enable", { method: "POST", json: { code: code.replace(/\s/g, "") } }); setSetup(null); setCode(""); }, rtl ? "تم تفعيل التحقق الثنائي" : "Two-factor authentication enabled")} data-testid="mfa-enable">
              {rtl ? "تأكيد" : "Confirm"}
            </Button>
          </div>
        </div>
      )}

      {enabled && (
        <details className="rounded-xl border border-line bg-surface-2/40 p-3">
          <summary className="cursor-pointer text-sm text-fg-muted">{rtl ? "إيقاف التحقق الثنائي" : "Turn off two-factor authentication"}</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
            <Input type="password" placeholder={rtl ? "كلمة المرور الحالية" : "Current password"} value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
            <Input inputMode="numeric" dir="ltr" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className="text-center font-mono" />
            <Button variant="outline" onClick={() => act(async () => { await api("/api/auth/mfa/disable", { method: "POST", json: { password: disablePw, code: code.replace(/\s/g, "") } }); setDisablePw(""); setCode(""); }, rtl ? "تم إيقاف التحقق الثنائي" : "Two-factor authentication turned off")}>
              {rtl ? "إيقاف" : "Turn off"}
            </Button>
          </div>
        </details>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="eyebrow flex items-center gap-1.5"><MonitorSmartphone className="size-3.5" /> {rtl ? "الجلسات النشطة" : "Active sessions"}</div>
          {sessions.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => act(() => api("/api/auth/sessions/revoke-others", { method: "POST" }), rtl ? "تم إنهاء الجلسات الأخرى" : "Other sessions signed out")} data-testid="revoke-others">
              {rtl ? "إنهاء الجلسات الأخرى" : "Sign out other sessions"}
            </Button>
          )}
        </div>
        <ul className="divide-y divide-line rounded-xl border border-line" data-testid="session-list">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate text-fg" dir="ltr">{device(s.user_agent)}</div>
                <div className="truncate text-xs text-fg-subtle" dir="ltr">
                  {s.ip ?? "—"} · {s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : "—"}
                  {s.mfa_verified ? " · 2FA" : ""}
                </div>
              </div>
              {s.current ? (
                <Badge tone="ok">{rtl ? "هذا الجهاز" : "This device"}</Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => act(() => api(`/api/auth/sessions/${s.id}/revoke`, { method: "POST" }), rtl ? "تم إنهاء الجلسة" : "Session signed out")}>
                  {rtl ? "إنهاء" : "Sign out"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {err && <Notice tone="danger" role="alert">{err}</Notice>}
    </Card>
  );
}
