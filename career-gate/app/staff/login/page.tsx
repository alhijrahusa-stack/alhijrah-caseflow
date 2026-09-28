"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { FormEvent, ReactNode } from "react";

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 19 6v5c0 4.6-2.7 8.2-7 10-4.3-1.8-7-5.4-7-10V6l7-3Z" />
      <path d="m9.5 12 1.7 1.7 3.6-3.7" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M9.2 9.5c.7-1.2 1.7-1.8 3-1.8 1.8 0 3 1 3 2.4 0 1.5-1.3 2.3-3.2 2.3-1.8 0-3.2.8-3.2 2.3 0 1.5 1.3 2.5 3.2 2.5 1.5 0 2.6-.6 3.3-1.8" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m13.5 2-7 11h5l-1 9 7-12h-5l1-8Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M3.5 19v-1.2c0-3 2.3-5.3 5.5-5.3s5.5 2.3 5.5 5.3V19" />
      <path d="M14 14.2c.7-.4 1.6-.7 2.5-.7 2.7 0 4.5 1.9 4.5 4.4V19" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Feature({ icon, title, arabic }: { icon: ReactNode; title: string; arabic: string }) {
  return (
    <div className="cg-auth-feature">
      <div className="cg-auth-feature-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <span dir="rtl">{arabic}</span>
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
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => null);

      if (!data?.ok) {
        setError(data?.error?.message ?? `Request failed (${response.status})`);
        return null;
      }

      return data;
    } catch {
      setError("Unable to complete the request. Please try again.");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const data = await post("/api/staff/auth/login", { email: normalizedEmail });
    if (!data) return;
    setEmail(normalizedEmail);
    setInfo(data.message);
    setStep("code");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await post("/api/staff/auth/verify", { email, code });
    if (!data) return;

    const next = params.get("next");
    window.location.href = next && next.startsWith("/staff") && !next.startsWith("//") ? next : "/staff";
  }

  return (
    <main className="cg-auth">
      <div className="cg-auth-noise" aria-hidden="true" />
      <div className="cg-auth-grid" aria-hidden="true" />
      <div className="cg-auth-glow cg-auth-glow-one" aria-hidden="true" />
      <div className="cg-auth-glow cg-auth-glow-two" aria-hidden="true" />

      <div className="cg-auth-layout">
        <aside className="cg-auth-story">
          <div className="cg-auth-story-content">
            <span className="cg-auth-kicker">EMPLOYMENT INTAKE PLATFORM</span>

            <div className="cg-auth-message">
              <span>People</span>
              <span>Opportunities</span>
              <span>A Brighter Tomorrow</span>
            </div>

            <div className="cg-auth-small-line" />

            <p>
              Connecting talent
              <br />
              across borders.
            </p>

            <div className="cg-auth-features">
              <Feature icon={<ShieldIcon />} title="Secure access" arabic="دخول آمن وموثوق" />
              <Feature icon={<CodeIcon />} title="6-digit verification" arabic="رمز دخول مكوّن من 6 أرقام" />
              <Feature icon={<BoltIcon />} title="Fast staff workflow" arabic="سير عمل سريع وفعّال" />
            </div>
          </div>
        </aside>

        <section className="cg-auth-main">
          <header className="cg-auth-brand cg-auth-enter cg-auth-enter-1">
            <div className="cg-auth-logo" aria-hidden="true">CG</div>
            <div className="cg-auth-title">Career <span>Gate</span></div>
            <p dir="rtl" className="cg-auth-office">مكتب الهجرة — عبدالله المريسي</p>

            <div className="cg-auth-department" dir="rtl">
              <i />
              <strong>قسم إدارة بوابة التوظيف</strong>
              <i />
            </div>

            <p className="cg-auth-company">ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC</p>
          </header>

          <section className="cg-auth-card cg-auth-enter cg-auth-enter-2">
            <div className="cg-auth-card-highlight" />
            <div className="cg-auth-users-icon"><UsersIcon /></div>

            <h1 dir="rtl">تسجيل دخول الموظفين</h1>

            <div className="cg-auth-subtitle">
              <span />
              <p>Staff Sign In</p>
              <span />
            </div>

            {step === "email" ? (
              <>
                <p className="cg-auth-description" dir="rtl">
                  أدخل بريد العمل المعتمد لاستلام رمز دخول آمن مكوّن من 6 أرقام.
                </p>

                <form className="cg-auth-form" onSubmit={sendCode}>
                  <label htmlFor="email">Work Email</label>

                  <div className="cg-auth-input">
                    <MailIcon />
                    <input
                      id="email"
                      type="email"
                      autoComplete="username"
                      required
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>

                  {error && <p className="cg-auth-error" role="alert">{error}</p>}

                  <button aria-label="Send sign-in code" className="cg-auth-submit" type="submit" disabled={pending}>
                    <span>{pending ? "جارٍ الإرسال…" : "إرسال رمز الدخول"}</span>
                    <SendIcon />
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="cg-auth-description" dir="rtl">
                  أدخل رمز التحقق المكوّن من 6 أرقام المُرسل إلى بريد العمل المعتمد.
                </p>

                {info && <p className="cg-auth-info" role="status">{info}</p>}

                <form className="cg-auth-form" onSubmit={verifyCode}>
                  <label htmlFor="code">6-Digit Code</label>

                  <div className="cg-auth-input cg-auth-code">
                    <CodeIcon />
                    <input
                      id="code"
                      inputMode="numeric"
                      pattern="\d{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      required
                      placeholder="000000"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                  </div>

                  {error && <p className="cg-auth-error" role="alert">{error}</p>}

                  <button className="cg-auth-submit" type="submit" disabled={pending}>
                    <span>{pending ? "جارٍ التحقق…" : "تسجيل الدخول"}</span>
                    <ArrowIcon />
                  </button>

                  <button
                    className="cg-auth-change-email"
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setInfo(null);
                      setError(null);
                    }}
                  >
                    استخدام بريد مختلف
                  </button>
                </form>
              </>
            )}

            <div className="cg-auth-security">
              <div className="cg-auth-security-icon"><ShieldIcon /></div>
              <div>
                <p dir="rtl">يُستخدم هذا النظام حصريًا لموظفي Career Gate المصرح لهم.</p>
                <span>Authorized Career Gate staff access only.</span>
              </div>
            </div>
          </section>

          <footer className="cg-auth-footer cg-auth-enter cg-auth-enter-3">
            <strong>CAREER GATE</strong>
            <span>Operated by ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC</span>
            <span>Dearborn, Michigan</span>
            <span>313-339-3566 · WhatsApp: 313-919-4292</span>
          </footer>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="cg-auth"><div className="cg-auth-loading">Career Gate</div></main>}>
      <LoginForm />
    </Suspense>
  );
}
