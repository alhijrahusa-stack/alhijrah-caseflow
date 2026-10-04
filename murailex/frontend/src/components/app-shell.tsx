"use client";

import { FileAudio, Home, ListChecks, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", key: "home", icon: Home },
  { href: "/transcriptions", key: "transcriptions", icon: FileAudio },
  { href: "/review", key: "review", icon: ListChecks },
  { href: "/settings", key: "settings", icon: Settings },
] as const;

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="brand-gradient grid size-8 place-items-center rounded-xl text-primary-fg shadow-glow" aria-hidden>
        <ShieldCheck className="size-[18px]" strokeWidth={2} />
      </span>
      <span className="text-[17px] font-bold tracking-[0.14em] text-fg" dir="ltr">MURAILEX</span>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t, dir } = useI18n();
  const { user, loading } = useSession();
  const [online, setOnline] = useState(true);
  const rtl = dir === "rtl";

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (pathname === "/login") return <>{children}</>;
  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <Wordmark />
      </div>
    );
  }

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="glass-strong hidden !border-y-0 !border-s-0 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:px-4 lg:py-5">
        <Link href="/" className="mb-8 block rounded-lg px-2 py-1">
          <Wordmark />
          <div className="mt-2 ps-[42px] text-xs text-fg-subtle">{rtl ? "الذكاء الجنائي للصوت" : "Forensic Audio Intelligence"}</div>
        </Link>

        <nav className="space-y-0.5" aria-label="Primary">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150",
                active(href) ? "bg-white/[0.08] font-semibold text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-fg-muted hover:bg-white/[0.05] hover:text-fg",
              )}
            >
              <Icon className={cn("size-[18px]", active(href) ? "text-primary-text" : "text-fg-subtle")} />
              {t(key)}
            </Link>
          ))}
        </nav>

        <div className="mt-auto space-y-3 border-t border-line px-2 pt-4 text-[11.5px] leading-5 text-fg-subtle">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-ok" />
            <span>{rtl ? "وضع السلامة الجنائية" : "Forensic integrity mode"}</span>
          </div>
          <div>
            <div>
              Powered by <span className="font-semibold text-fg-muted">ALHIJRAH SERVICES</span>
            </div>
            <div>عبدالله المريسي</div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        {!online && (
          <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-xs text-warn" role="status">
            {t("offline")}
          </div>
        )}

        <header className="glass-strong !bg-canvas/[0.97] sticky top-0 z-30 flex h-14 items-center !border-x-0 !border-t-0 px-4 lg:hidden">
          <Link href="/">
            <Wordmark />
          </Link>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      <nav className="glass-strong !bg-canvas/[0.97] safe-bottom fixed inset-x-0 bottom-0 z-40 !border-x-0 !border-b-0 lg:hidden" aria-label="Primary">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 flex-col items-center justify-center gap-1 pb-1 pt-2 text-[11px] font-medium transition-colors touch-manipulation",
                active(href) ? "text-primary-text" : "text-fg-subtle",
              )}
            >
              {active(href) && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary-text" />}
              <Icon className="size-[22px]" strokeWidth={active(href) ? 2.2 : 1.8} />
              {t(key)}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
