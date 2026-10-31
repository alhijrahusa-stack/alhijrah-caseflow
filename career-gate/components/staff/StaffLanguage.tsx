"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type StaffLanguage = "en" | "ar";
export const STAFF_LANGUAGE_COOKIE = "cg-staff-language";
const STORAGE_KEY = "cg:staff-language:v1";

type LanguageContext = {
  language: StaffLanguage;
  dir: "ltr" | "rtl";
  t: (english: string, arabic: string) => string;
  setLanguage: (language: StaffLanguage) => void;
  toggleLanguage: () => void;
};

const Context = createContext<LanguageContext>({
  language: "en",
  dir: "ltr",
  t: english => english,
  setLanguage: () => undefined,
  toggleLanguage: () => undefined,
});

export function StaffLanguageProvider({ initialLanguage = "en", children }: { initialLanguage?: StaffLanguage; children: ReactNode }) {
  // The server reads the same preference cookie. No browser-only initial render,
  // client-side text replacement, or hydration suppression is needed.
  const [language, updateLanguage] = useState<StaffLanguage>(initialLanguage);
  const setLanguage = useCallback((next: StaffLanguage) => {
    updateLanguage(next);
    document.cookie = `${STAFF_LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* The preference cookie still works when browser storage is unavailable. */ }
  }, []);
  const toggleLanguage = useCallback(() => setLanguage(language === "en" ? "ar" : "en"), [language, setLanguage]);
  const t = useCallback((english: string, arabic: string) => language === "ar" ? arabic : english, [language]);

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    const previousDirection = document.documentElement.getAttribute("dir");
    return () => {
      document.documentElement.lang = previousLanguage;
      if (previousDirection) document.documentElement.setAttribute("dir", previousDirection);
      else document.documentElement.removeAttribute("dir");
    };
  }, []);

  useEffect(() => {
    // Portalled dropdowns and document drawers inherit the same direction.
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && (event.newValue === "en" || event.newValue === "ar")) updateLanguage(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<LanguageContext>(() => ({ language, dir: language === "ar" ? "rtl" : "ltr", t, setLanguage, toggleLanguage }), [language, t, setLanguage, toggleLanguage]);
  return <Context value={value}>{children}</Context>;
}

export const useStaffLanguage = () => useContext(Context);

/** A localized label that can also be composed from a server-rendered page. */
export function StaffText({ en, ar }: { en: string; ar: string }) {
  return useStaffLanguage().t(en, ar);
}

export function StaffLanguageToggle() {
  const { language, toggleLanguage, t } = useStaffLanguage();
  return <button type="button" className="royal-language-toggle" data-testid="staff-language-toggle" onClick={toggleLanguage}
    aria-label={t("Switch interface to Arabic", "تغيير لغة الواجهة إلى الإنجليزية")} title={t("العربية · Arabic", "English · الإنجليزية")}>
    <span aria-hidden="true">◎</span><span lang={language === "en" ? "ar" : "en"} dir="ltr">{language === "en" ? "AR" : "EN"}</span>
  </button>;
}
