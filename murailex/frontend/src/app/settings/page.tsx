"use client";

import { useEffect, useState } from "react";

import { SecurityCard } from "@/components/security-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";

type Provider = {
  internal_id: string;
  provider: string;
  name: string;
  model: string;
  role: string;
  locale: string;
  status: "READY" | "NOT_CONFIGURED" | "FAILED" | "BLOCKED";
  blocker?: string | null;
  required_environment_variables?: string[];
  benchmark?: string;
};

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { user, signOut } = useSession();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [chain, setChain] = useState<{ valid: boolean; checked: number } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [nu, setNu] = useState({ email: "", password: "", role: "transcriber" });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api<{ providers: Provider[] }>("/api/providers").then((r) => setProviders(r.providers)).catch(() => undefined);
    if (isAdmin) api<{ users: User[] }>("/api/admin/users").then((r) => setUsers(r.users)).catch(() => undefined);
  }, [isAdmin]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : t("error"));
    }
  }

  return (
    <div className="space-y-5 fade-in">
      <PageHeader title={t("settings")} />
      {msg && (
        <Notice tone="info" role="status">
          {msg}
        </Notice>
      )}

      <Card className="space-y-3">
        <CardTitle>{t("language")}</CardTitle>
        <div className="flex gap-2">
          <Button variant={lang === "ar" ? "default" : "secondary"} size="sm" onClick={() => setLang("ar")}>العربية</Button>
          <Button variant={lang === "en" ? "default" : "secondary"} size="sm" onClick={() => setLang("en")}>English</Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <CardTitle>{t("account")}</CardTitle>
          <p className="mt-1 text-sm text-fg-muted" dir="ltr">{user?.email} · {user?.role}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input type="password" aria-label={t("current_password")} placeholder={t("current_password")} value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          <Input type="password" aria-label={t("new_password")} placeholder={t("new_password")} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          <Button variant="secondary" onClick={() => run(() => api("/api/auth/password", { method: "POST", json: pw }), "✓")}>{t("change_password")}</Button>
        </div>
        <Button variant="outline" onClick={signOut}>{t("sign_out")}</Button>
      </Card>

      <SecurityCard rtl={lang === "ar"} />

      {isAdmin && (
        <Card className="space-y-4">
          <CardTitle>{t("users")}</CardTitle>
          <div className="divide-y divide-line rounded-lg border border-line">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm" dir="ltr">
                <span className="truncate text-fg">{u.email}</span>
                <Badge>{u.role}{u.is_active ? "" : " · inactive"}</Badge>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]">
            <Input type="email" aria-label={t("email")} placeholder={t("email")} value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} dir="ltr" />
            <Input type="password" aria-label={t("password")} placeholder={t("password")} value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} dir="ltr" />
            <Select aria-label="Role" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
              {["admin", "transcriber", "reviewer", "viewer"].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <Button onClick={() => run(async () => {
              await api("/api/admin/users", { method: "POST", json: nu });
              const r = await api<{ users: User[] }>("/api/admin/users");
              setUsers(r.users);
              setNu({ email: "", password: "", role: "transcriber" });
            })}>{t("add_user")}</Button>
          </div>
        </Card>
      )}

      <details id="advanced" className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <summary className="cursor-pointer text-[15px] font-semibold text-fg">{t("advanced")}</summary>
        <div className="mt-4 space-y-4">
          <div>
            <div className="eyebrow mb-2">{t("providers")}</div>
            <div className="space-y-1.5" dir="ltr">
              {providers.map((p) => (
                <div key={p.internal_id} className="rounded-lg border border-line bg-surface-2/60 px-3.5 py-2.5 text-xs" data-testid="provider-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-fg">{p.provider}</span>
                    <span className="text-fg-muted">{p.model} · {p.role} · {p.locale}</span>
                    <Badge tone={p.status === "READY" ? "ok" : "danger"}>{p.status}</Badge>
                  </div>
                  {p.blocker ? <div className="mt-1.5 text-warn">{p.blocker}</div> : null}
                  {p.benchmark && p.benchmark !== "APPROVED" ? <div className="mt-1 text-fg-subtle">Benchmark: {p.benchmark}</div> : null}
                  {p.required_environment_variables?.length ? (
                    <div className="mt-1 font-mono text-[11px] text-fg-subtle">
                      Requires: {p.required_environment_variables.join(", ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => run(async () => setChain(await api("/api/audit/verify")))}>{t("audit_verify")}</Button>
              {chain && <Badge tone={chain.valid ? "ok" : "danger"}>{chain.valid ? t("audit_valid") : t("audit_invalid")} · {chain.checked}</Badge>}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
