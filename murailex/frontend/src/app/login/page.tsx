"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Wordmark } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
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
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: needOtp ? { email, password, otp } : { email, password } });
      await refresh();
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") && next !== "/login" ? next : "/");
    } catch (err) {
      const code = err instanceof ApiError && err.detail && typeof err.detail === "object" ? (err.detail as { code?: string }).code : undefined;
      if (code === "mfa_required") {
        setNeedOtp(true);
        setError(null);
        return;
      }
      setError(err instanceof ApiError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm fade-in">
        <div className="mb-8 text-center">
          <Wordmark className="justify-center" />
          <div className="mt-3 text-sm text-fg-muted">{lang === "ar" ? "الذكاء الجنائي للصوت" : "Forensic Audio Intelligence"}</div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-card sm:p-7">
          <Field label={t("email")}>
            <Input name="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </Field>
          <Field label={t("password")}>
            <Input
              name="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
            />
          </Field>
          {needOtp && (
            <Field label={lang === "ar" ? "رمز التحقق (6 أرقام)" : "Authentication code (6 digits)"}>
              <Input
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                dir="ltr"
                required
                autoFocus
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="h-11 text-center font-mono tracking-[0.4em]"
                data-testid="otp"
              />
            </Field>
          )}
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? t("signing_in") : t("sign_in")}
          </Button>
        </form>

        <div className="mt-5 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            {lang === "ar" ? "English" : "العربية"}
          </Button>
        </div>

        <div className="mt-6 text-center text-[11.5px] leading-5 text-fg-subtle">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-ok" /> {lang === "ar" ? "وضع السلامة الجنائية" : "Forensic integrity mode"}
          </div>
          <div className="mt-2">
            Powered by <span className="font-semibold text-fg-muted">ALHIJRAH SERVICES</span>
          </div>
          <div>عبدالله المريسي</div>
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
