"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StaffLanguageToggle, useStaffLanguage } from "@/components/staff/StaffLanguage";
import { SignOutButton } from "@/components/staff/SignOutButton";
import { useStaff } from "@/components/staff/StaffContext";
import type { ManagerKPIStats } from "@/components/staff/manager/types";
import styles from "@/components/staff/ManagerTaskCenter.module.css";

function MetricIcon({ kind }: { kind: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "smart" ? <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5L20 2Z" /></> : kind === "urgent" ? <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" /> : kind === "payments" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3M15 15h2" /></> : <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M19 21v-3a6 6 0 0 0-2-4.5" /></>}</svg>;
}

function AnimatedCount({ value }: { value: number | undefined }) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current; previous.current = value;
    if (from == null || value == null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    let frame = 0; const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 280);
      setShown(Math.round(from + (value - from) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span aria-label={value == null ? "—" : String(value)}><span aria-hidden="true">{value == null ? "—" : (shown ?? value).toLocaleString("en-US")}</span></span>;
}

export function FloatingHeader({ summary, query, onQueryChange, onPaymentClick, teamNow, live, liveLabel, disabled }: {
  summary: ManagerKPIStats;
  query: string;
  onQueryChange: (value: string) => void;
  onPaymentClick: () => void;
  teamNow: ReactNode;
  live: boolean;
  liveLabel: string;
  disabled: boolean;
}) {
  const { t } = useStaffLanguage();
  const { me } = useStaff();
  const account = useRef<HTMLDetailsElement>(null);
  const alertsHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = alertsHost.current;
    if (!host) return;
    // The layout hydrates before this workspace can. A portal may only add
    // children after this header has hydrated its server-rendered empty outlet.
    host.setAttribute("data-manager-alerts-ready", "true");
    window.dispatchEvent(new Event("career-gate:manager-alerts-host-ready"));
    return () => {
      host.removeAttribute("data-manager-alerts-ready");
      window.dispatchEvent(new Event("career-gate:manager-alerts-host-ready"));
    };
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (account.current && !account.current.contains(event.target as Node)) account.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && account.current?.open) { account.current.open = false; account.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <>
    <header className={styles.floatingHeader} data-testid="manager-floating-header">
      <Link href="/staff" className={styles.brand} prefetch={false} aria-label={t("Career Gate dashboard", "لوحة Career Gate الرئيسية")}><span className={styles.brandMark} aria-hidden="true"><Image src="/brand/career-gate.webp" alt="" width={40} height={40}/></span><span><strong>CAREER GATE</strong><small>{t("EXECUTIVE COMMAND", "القيادة التنفيذية")}</small></span></Link>
      <div className={styles.commandSearch}>
        <label className={styles.search}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" aria-label={t("Search reviews", "البحث في المراجعات")} placeholder={t("Name, file, phone or note…", "الاسم، الملف، الهاتف أو الملاحظة…")} value={query} onChange={event => onQueryChange(event.target.value)} disabled={disabled}/></label>
        <button type="button" className={styles.commandButton} aria-label={t("Quick commands", "الأوامر السريعة")} title={t("Quick commands · Cmd / Ctrl + K", "الأوامر السريعة · Cmd / Ctrl + K")} onClick={() => window.dispatchEvent(new Event("career-gate:open-command"))}><kbd>⌘ K</kbd></button>
      </div>
      <div className={styles.headerTools}>{teamNow}<Link href="/staff/new-client" prefetch={false} className={styles.newClient} aria-label={t("New Client", "إضافة عميل")} title={t("New Client", "إضافة عميل")}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></Link><div ref={alertsHost} id="manager-spatial-alerts" className={styles.alertsOutlet}/><StaffLanguageToggle/><details ref={account} className={styles.accountMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}><summary aria-label={t("Workspace menu", "قائمة مساحة العمل")} title={t("Workspace menu", "قائمة مساحة العمل")}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg></summary><div className={styles.accountDropdown}><strong dir="auto">{me.display_name}</strong><small>{t("Manager workspace", "مساحة عمل المدير")}</small><Link href="/staff" prefetch={false}>{t("Dashboard", "لوحة التحكم")}</Link><Link href="/staff/staff?tab=team" prefetch={false}>{t("Executive profile", "الملف التنفيذي")}</Link><Link href="/staff/new-client" prefetch={false}>{t("New Client", "إضافة عميل")}</Link><Link href="/staff/clients" prefetch={false}>{t("Clients", "العملاء")}</Link><Link href="/staff/import" prefetch={false}>{t("Smart Collect", "الاستقبال الذكي")}</Link><Link href="/staff/accounting" prefetch={false}>{t("Accounting", "دفتر المالية")}</Link><Link href="/staff/reports" prefetch={false}>{t("Reports", "التقارير")}</Link><Link href="/staff/archive" prefetch={false}>{t("Deleted files", "الملفات المحذوفة")}</Link><SignOutButton/></div></details></div>
    </header>
    <section className={styles.commandIntro}><div><p>CAREER GATE · SPATIAL COMMAND</p><h1>{t("Manager's Task Center", "مركز مهام المدير")}</h1><span>{t("Review, decide and route in one workspace", "مراجعة واعتماد وتوجيه من مساحة واحدة")}</span></div><span className={styles.live} data-live={live}><i aria-hidden="true"/>{liveLabel}</span></section>
    <div className={styles.metrics} aria-label={t("Current operational file counts", "أعداد الملفات التشغيلية الحالية")}>
      {[{ label: t("Smart Client files", "عملاء Smart Client"), value: summary.smart_client, href: "/staff/import", tone: "smart" }, { label: t("Clients files", "عملاء Clients"), value: summary.clients, href: "/staff/clients", tone: "clients" }, { label: t("Urgent files", "الملفات العاجلة"), value: summary.urgent, href: "/staff/clients?stage=urgent", tone: "urgent" }].map(metric => <Link key={metric.tone} href={metric.href} className={styles.metric} data-tone={metric.tone} prefetch={false}><span><span className={styles.metricLabel}>{metric.label}</span><strong><AnimatedCount value={metric.value}/></strong></span><span className={styles.metricIcon}><MetricIcon kind={metric.tone}/></span></Link>)}
      <button type="button" className={styles.metric} data-tone="payments" disabled={disabled} onClick={onPaymentClick} title={t("Unpaid files after a recorded pass or staff/management routing to Payment Required", "ملفات مستحقة بعد اجتياز موثّق أو تحويل الموظف أو الإدارة إلى الدفع المطلوب")}><span><span className={styles.metricLabel}>{t("Payment Required", "الدفع المطلوب")}</span><strong><AnimatedCount value={summary.payment_issues}/></strong></span><span className={styles.metricIcon}><MetricIcon kind="payments"/></span></button>
    </div>
  </>;
}
