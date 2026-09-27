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
      <div className="grid min-h-dvh place-items-center">
        <div className="text-center">
          <div className="brand-gradient text-xl font-extrabold tracking-[0.2em]">MURAILEX</div>
          <div className="mt-2 text-[11px] text-slate-600">ALHIJRAH SERVICES</div>
        </div>
      </div>
    );
  }

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-e border-white/[0.055] bg-black/10 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:p-5 lg:backdrop-blur-xl">
        <Link href="/" className="mb-8 rounded-2xl px-3 pt-2">
          <div className="brand-gradient text-xl font-extrabold tracking-[0.19em]">MURAILEX</div>
          <div className="mt-1 text-[11px] font-medium text-slate-500">{rtl ? "الذكاء الجنائي للصوت" : "Forensic Audio Intelligence"}</div>
        </Link>

        <div className="space-y-1">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition-all duration-200",
                active(href)
                  ? "border-indigo-400/15 bg-indigo-400/10 font-semibold text-indigo-100 shadow-[0_10px_30px_-20px_rgba(99,102,241,.75)]"
                  : "border-transparent text-slate-500 hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-slate-200",
              )}
            >
              <Icon className={cn("size-[18px]", active(href) ? "text-indigo-300" : "text-slate-600 group-hover:text-slate-400")} />
              {t(key)}
            </Link>
          ))}
        </div>

        <div className="mt-auto space-y-3 px-3 pb-2">
          <div className="flex items-center gap-2 text-[10px] text-slate-600">
            <ShieldCheck className="size-3.5 text-cyan-400/70" />
            <span>FORENSIC INTEGRITY MODE</span>
          </div>
          <div className="border-t border-white/[0.055] pt-3 text-[10px] leading-5 text-slate-600">
            <div>Powered by <span className="font-semibold text-slate-500">ALHIJRAH SERVICES</span></div>
            <div className="text-slate-500">عبدالله المريسي</div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {!online && (
          <div className="border-b border-amber-300/10 bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-200">
            {t("offline")}
          </div>
        )}

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-9">{children}</main>

        <footer className="mx-auto hidden w-full max-w-5xl px-6 pb-6 text-center text-[10px] text-slate-700 lg:block">
          Powered by ALHIJRAH SERVICES · عبدالله المريسي
        </footer>
      </div>

      <nav className="glass-strong safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] lg:hidden" aria-label="Primary">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center gap-1 pb-1 pt-2.5 text-[11px] transition",
                active(href) ? "text-indigo-300" : "text-slate-500",
              )}
            >
              {active(href) && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-gradient-to-r from-indigo-400 to-cyan-300 shadow-[0_0_12px_rgba(129,140,248,.75)]" />}
              <Icon className="size-[22px]" strokeWidth={active(href) ? 2.2 : 1.7} />
              {t(key)}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
