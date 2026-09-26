"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";

type Provider = { name: string; model: string; role: string; status: string };

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
      <h1 className="text-2xl font-semibold">{t("settings")}</h1>
      {msg && <p className="text-sm" role="status">{msg}</p>}

      <Card className="space-y-3">
        <CardTitle>{t("language")}</CardTitle>
        <div className="flex gap-2">
          <Button variant={lang === "ar" ? "default" : "secondary"} size="sm" onClick={() => setLang("ar")}>العربية</Button>
          <Button variant={lang === "en" ? "default" : "secondary"} size="sm" onClick={() => setLang("en")}>English</Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <CardTitle>{t("account")}</CardTitle>
        <p className="text-sm" dir="ltr">{user?.email} · {user?.role}</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input type="password" placeholder={t("current_password")} value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          <Input type="password" placeholder={t("new_password")} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          <Button variant="secondary" onClick={() => run(() => api("/api/auth/password", { method: "POST", json: pw }), "✓")}>{t("change_password")}</Button>
        </div>
        <Button variant="outline" onClick={signOut}>{t("sign_out")}</Button>
      </Card>

      {isAdmin && (
        <Card className="space-y-3">
          <CardTitle>{t("users")}</CardTitle>
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between text-sm" dir="ltr">
              <span>{u.email}</span>
              <Badge>{u.role}{u.is_active ? "" : " · inactive"}</Badge>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
            <Input type="email" placeholder={t("email")} value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} dir="ltr" />
            <Input type="password" placeholder={t("password")} value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} dir="ltr" />
            <select className="rounded-2xl border hairline bg-transparent px-3 text-sm" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
              {["admin", "transcriber", "reviewer", "viewer"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <Button onClick={() => run(async () => {
              await api("/api/admin/users", { method: "POST", json: nu });
              const r = await api<{ users: User[] }>("/api/admin/users");
              setUsers(r.users);
              setNu({ email: "", password: "", role: "transcriber" });
            })}>{t("add_user")}</Button>
          </div>
        </Card>
      )}

      <details id="advanced" className="glass rounded-3xl p-5">
        <summary className="cursor-pointer text-[15px] font-semibold">{t("advanced")}</summary>
        <div className="mt-4 space-y-4">
          <div>
            <div className="muted mb-2 text-xs">{t("providers")}</div>
            <div className="space-y-1.5" dir="ltr">
              {providers.map((p) => (
                <div key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border hairline px-3 py-2 text-xs" data-testid="provider-row">
                  <span className="font-medium">{p.name}</span>
                  <span className="muted">{p.model} · {p.role}</span>
                  <Badge tone={p.status === "CONFIGURED" ? "ok" : "danger"}>{p.status}</Badge>
                </div>
              ))}
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => run(async () => setChain(await api("/api/audit/verify")))}>{t("audit_verify")}</Button>
              {chain && <Badge tone={chain.valid ? "ok" : "danger"}>{chain.valid ? t("audit_valid") : t("audit_invalid")} · {chain.checked}</Badge>}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
