"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="cg-login-icon-svg">
      <path d="M12 3 19 6v5c0 4.6-2.7 8.2-7 10-4.3-1.8-7-5.4-7-10V6l7-3Z" />
      <path d="m9.5 12 1.7 1.7 3.6-3.7" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="cg-login-icon-svg">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v9M8.6 10.1c.6-1.6 1.8-2.4 3.4-2.4 1.9 0 3.2 1 3.2 2.5 0 1.6-1.3 2.4-3.2 2.4-1.8 0-3.2.8-3.2 2.4 0 1.5 1.3 2.5 3.2 2.5 1.7 0 2.9-.8 3.5-2.4" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="cg-login-icon-svg">
      <path d="m13.5 2-7 11h5l-1 9 7-12h-5l1-8Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="cg-login-field-icon">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="cg-login-users-icon">
      <circle cx="9" cy="8" r="3" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M3.5 19v-1.2c0-3 2.3-5.3 5.5-5.3s5.5 2.3 5.5 5.3V19M14 14.2c.7-.4 1.6-.7 2.5-.7 2.7 0 4.5 1.9 4.5 4.4V19" />
    </svg>
  );
}

function Feature({ icon, title, arabic }: { icon: React.ReactNode; title: string; arabic: string }) {
  return (
    <div className="cg-login-feature">
      <div className="cg-login-feature-icon">{icon}</div>
      <div>
        <div className="cg-login-feature-title">{title}</div>
        <div dir="rtl" className="cg-login-feature-ar">{arabic}</div>
      </div>
    </div>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        setError(data?.error?.message ?? `Request failed (${res.status})`);
        return null;
      }
      return data;
    } finally {
      setPending(false);
    }
  }

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    const data = await post("/api/staff/auth/login", { email: normalized });
    if (!data) return;
    setEmail(normalized);
    setInfo(data.message);
    setStep("code");
  }

  async function verifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = await post("/api/staff/auth/verify", { email, code });
    if (!data) return;
    const next = params.get("next");
    window.location.href = next && next.startsWith("/staff") && !next.startsWith("//") ? next : "/staff";
  }

  return (
    <main className="cg-login-page">
      <div className="cg-login-orb cg-login-orb-a" aria-hidden="true" />
      <div className="cg-login-orb cg-login-orb-b" aria-hidden="true" />
      <div className="cg-login-grid" aria-hidden="true" />

      <section className="cg-login-shell" aria-label="Career Gate staff access">
        <aside className="cg-login-story">
          <div className="cg-login-story-inner">
            <div className="cg-login-eyebrow">EMPLOYMENT INTAKE PLATFORM</div>
            <div className="cg-login-story-copy">
              <div>People</div>
              <div>Opportunities</div>
              <div>A Brighter Tomorrow</div>
            </div>
            <div className="cg-login-accent-line" />
            <p className="cg-login-story-caption">Connecting talent across borders.</p>

            <div className="cg-login-features">
              <Feature icon={<ShieldIcon />} title="Secure access" arabic="دخول آمن وموثوق" />
              <Feature icon={<CodeIcon />} title="6-digit verification" arabic="رمز دخول مكوّن من 6 أرقام" />
              <Feature icon={<BoltIcon />} title="Fast staff workflow" arabic="سير عمل سريع وفعّال" />
            </div>
          </div>
        </aside>

        <section className="cg-login-main">
          <header className="cg-login-brand cg-reveal cg-reveal-1">
            <div className="cg-login-monogram" aria-hidden="true">CG</div>
            <div className="cg-login-wordmark">Career Gate</div>
            <div dir="rtl" className="cg-login-brand-ar">مكتب الهجرة — عبدالله المريسي</div>
            <div className="cg-login-dept-row" dir="rtl">
              <span />
              <strong>قسم إدارة بوابة التوظيف</strong>
              <span />
            </div>
            <div className="cg-login-company">ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC</div>
          </header>

          <div className="cg-login-card cg-reveal cg-reveal-2">
            <div className="cg-login-card-glow" aria-hidden="true" />
            <div className="cg-login-card-content">
              <div className="cg-login-users"><UsersIcon /></div>
              <h1 dir="rtl">تسجيل دخول الموظفين</h1>
              <div className="cg-login-subtitle-row">
                <span />
                <p>Staff Sign In</p>
                <span />
              </div>

              {step === "email" ? (
                <>
                  <p dir="rtl" className="cg-login-lead">
                    أدخل بريد العمل المعتمد لاستلام رمز دخول آمن مكوّن من 6 أرقام.
                  </p>

                  <form className="cg-login-form" onSubmit={sendCode}>
                    <label htmlFor="email">Work Email</label>
                    <div className="cg-login-field-wrap">
                      <MailIcon />
                      <input
                        id="email"
                        type="email"
                        required
                        autoComplete="username"
                        placeholder="name@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>

                    {error && <p role="alert" className="cg-login-alert">{error}</p>}

                    <button className="cg-login-primary" type="submit" disabled={pending}>
                      <span>{pending ? "جارٍ الإرسال…" : "إرسال رمز الدخول"}</span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M22 2 11 13" />
                        <path d="m22 2-7 20-4-9-9-4 20-7Z" />
                      </svg>
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p dir="rtl" className="cg-login-lead">
                    أدخل رمز التحقق المكوّن من 6 أرقام المُرسل إلى بريد العمل المعتمد.
                  </p>

                  {info && <p className="cg-login-info">{info}</p>}

                  <form className="cg-login-form" onSubmit={verifyCode}>
                    <label htmlFor="code">6-Digit Code</label>
                    <div className="cg-login-field-wrap cg-login-code-wrap">
                      <CodeIcon />
                      <input
                        id="code"
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        required
                        autoComplete="one-time-code"
                        placeholder="000000"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      />
                    </div>

                    {error && <p role="alert" className="cg-login-alert">{error}</p>}

                    <button className="cg-login-primary" type="submit" disabled={pending}>
                      <span>{pending ? "جارٍ التحقق…" : "تسجيل الدخول"}</span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="cg-login-secondary"
                      onClick={() => {
                        setStep("email");
                        setCode("");
                        setError(null);
                        setInfo(null);
                      }}
                    >
                      استخدام بريد مختلف
                    </button>
                  </form>
                </>
              )}

              <div className="cg-login-card-footer">
                <div className="cg-login-footer-shield"><ShieldIcon /></div>
                <div>
                  <p dir="rtl">يُستخدم هذا النظام حصريًا لموظفي Career Gate المصرح لهم.</p>
                  <span>Authorized Career Gate staff access only.</span>
                </div>
              </div>
            </div>
          </div>

          <footer className="cg-login-footer cg-reveal cg-reveal-3">
            <strong>CAREER GATE</strong>
            <span>Operated by ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC</span>
            <span>Dearborn, Michigan · 313-339-3566 · WhatsApp: 313-919-4292</span>
          </footer>
        </section>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="cg-login-page" />}>
      <LoginForm />
    </Suspense>
  );
}
