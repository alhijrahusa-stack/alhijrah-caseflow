"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

const MENU = [
  { href: "/staff/accounting", en: "Accounting", ar: "دفتر المالية", icon: "＄" },
  { href: "/staff/archive", en: "Archive", ar: "الأرشيف المؤقت", icon: "▣" },
] as const;

/**
 * Management shortcuts in the header: New Client and Smart Career Collect stay
 * one click away on every staff page, the rest sit in one menu. Labels collapse
 * to icons on narrow screens (their accessible names stay); the menu closes on
 * navigation, Escape and an outside click.
 */
export function HeaderTools() {
  const { t } = useStaffLanguage();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Close the menu when the route changes (render-time sync, no effect needed).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = (href: string) => (pathname === href ? "page" : undefined);
  const menuActive = MENU.some(item => pathname === item.href);

  return (
    <nav className="royal-header-tools" aria-label={t("Management shortcuts", "اختصارات الإدارة")} data-testid="header-tools">
      <Link href="/staff/new-client" prefetch={false} className="royal-tool royal-tool-primary" aria-current={current("/staff/new-client")} aria-label={t("New Client", "إضافة عميل")} title={t("New Client", "إضافة عميل")}>
        <span aria-hidden="true">＋</span><span className="royal-tool-label">{t("New Client", "إضافة عميل")}</span>
      </Link>
      <Link href="/staff/import" prefetch={false} className="royal-tool" aria-current={current("/staff/import")} aria-label={t("Smart Career Collect Client", "الاستقبال الذكي")} title={t("Smart Career Collect Client", "الاستقبال الذكي")}>
        <span aria-hidden="true">✧</span><span className="royal-tool-label">{t("Smart Collect", "الاستقبال الذكي")}</span>
      </Link>
      <div className="royal-tool-menu" ref={menu}>
        <button ref={trigger} type="button" className="royal-tool" aria-haspopup="true" aria-expanded={open} aria-controls="royal-tool-menu-list"
          data-active={menuActive || undefined} aria-label={t("Management tools", "أدوات الإدارة")} title={t("Management tools", "أدوات الإدارة")} onClick={() => setOpen(value => !value)}>
          <span aria-hidden="true">⌘</span><span className="royal-tool-label">{t("Management tools", "أدوات الإدارة")}</span><span aria-hidden="true" className="royal-tool-caret">▾</span>
        </button>
        {open && (
          <div id="royal-tool-menu-list" className="royal-tool-popover">
            {MENU.map(item => (
              <Link key={item.href} href={item.href} prefetch={false} aria-current={current(item.href)} onClick={() => setOpen(false)}>
                <span aria-hidden="true">{item.icon}</span>{t(item.en, item.ar)}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
