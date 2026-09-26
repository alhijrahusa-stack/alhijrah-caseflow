"use client";

import { useEffect, type ReactNode } from "react";

import { I18nProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";

import { AppShell } from "./app-shell";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return (
    <I18nProvider>
      <SessionProvider>
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </I18nProvider>
  );
}
