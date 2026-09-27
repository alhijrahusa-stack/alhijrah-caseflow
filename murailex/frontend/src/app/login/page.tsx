"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
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
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute -start-36 -top-28 size-[32rem] rounded-full bg-indigo-500/[0.12] blur-3xl" />
      <div className="pointer-events-none absolute -end-40 bottom-0 size-[28rem] rounded-full bg-cyan-400/[0.07] blur-3xl" />

      <div className="relative w-full max-w-sm fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-[20px] border border-indigo-300/15 bg-indigo-400/10 shadow-[0_0_42px_rgba(99,102,241,.16)]">
            <Sparkles className="size-6 text-indigo-200" />
          </div>
          <h1 className="brand-gradient text-[34px] font-extrabold tracking-[0.22em]">MURAILEX</h1>
          <div className="mt-2 text-sm font-medium text-slate-300">{lang === "ar" ? "الذكاء الجنائي للصوت" : "Forensic Audio Intelligence"}</div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[10px] tracking-[0.08em] text-slate-500">
            <ShieldCheck className="size-3.5 text-cyan-300" /> FORENSIC INTEGRITY MODE
          </div>
        </div>

        <form onSubmit={submit} className="glass-elevated space-y-4 rounded-[26px] p-6 sm:p-7">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-400">{t("email")}</span>
            <Input name="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 bg-black/20" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-400">{t("password")}</span>
            <Input
              name="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-black/20"
            />
          </label>
          {error && <p role="alert" className="rounded-xl border border-rose-400/15 bg-rose-400/[0.06] p-3 text-sm text-rose-300">{error}</p>}
          <Button type="submit" className="h-12 w-full" disabled={busy}>
            {busy ? t("signing_in") : t("sign_in")}
          </Button>
        </form>

        <div className="mt-5 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            {lang === "ar" ? "English" : "العربية"}
          </Button>
        </div>

        <div className="mt-6 text-center text-[10px] leading-5 text-slate-600">
          <div>Powered by <span className="font-semibold text-slate-500">ALHIJRAH SERVICES</span></div>
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
