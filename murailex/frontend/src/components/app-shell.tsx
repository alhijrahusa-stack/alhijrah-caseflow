"use client";

import { FileAudio, Home, ListChecks, Settings } from "lucide-react";
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
  const { t } = useI18n();
  const { user, loading } = useSession();
  const [online, setOnline] = useState(true);
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
    return <div className="grid min-h-dvh place-items-center muted text-sm">MURAILEX</div>;
  }
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden lg:flex lg:flex-col lg:gap-1 lg:p-5 lg:sticky lg:top-0 lg:h-dvh">
        <Link href="/" className="mb-8 px-3 pt-2">
          <div className="text-lg font-semibold tracking-[0.18em]">MURAILEX</div>
          <div className="muted text-xs">{t("tagline")}</div>
        </Link>
        {NAV.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition",
              active(href) ? "glass font-medium text-accent-700 dark:text-accent-200" : "muted hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
            )}
          >
            <Icon className="size-[18px]" />
            {t(key)}
          </Link>
        ))}
      </aside>
      <div className="flex min-h-dvh flex-col">
        {!online && <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-100">{t("offline")}</div>}
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-12 lg:pt-10">{children}</main>
      </div>
      <nav className="glass-strong safe-bottom fixed inset-x-0 bottom-0 z-40 border-t hairline lg:hidden" aria-label="Primary">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn("flex flex-col items-center gap-1 pt-2.5 pb-1 text-[11px]", active(href) ? "text-accent-600 dark:text-accent-300" : "muted")}
            >
              <Icon className="size-[22px]" strokeWidth={active(href) ? 2.2 : 1.7} />
              {t(key)}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
