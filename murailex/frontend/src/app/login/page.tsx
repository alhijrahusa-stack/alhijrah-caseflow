"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

function LoginForm() {
  const { t, lang, setLang } = useI18n();
  const { refresh } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      await refresh();
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") && next !== "/login" ? next : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-sm fade-in">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-semibold tracking-[0.22em]">MURAILEX</h1>
          <div className="muted mt-2 text-sm">{t("tagline")}</div>
        </div>
        <form onSubmit={submit} className="glass space-y-4 rounded-3xl p-6">
          <label className="block space-y-1.5">
            <span className="muted text-xs">{t("email")}</span>
            <Input name="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="muted text-xs">{t("password")}</span>
            <Input
              name="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-rose-600">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("signing_in") : t("sign_in")}
          </Button>
        </form>
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            {lang === "ar" ? "English" : "العربية"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
