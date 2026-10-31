"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

type Result = {
  id: string;
  ref: string;
  full_name: string;
  phone: string;
  email: string | null;
  current_status: string;
  pipeline_stage: string;
  next_step: string;
  assigned_name: string | null;
  staff_code: string | null;
  site_code: string | null;
  shift_code: string | null;
  payment_status: string | null;
  fee_amount: number | null;
};

function pretty(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "—";
}

export function QuickClientSearch() {
  const { t } = useStaffLanguage();
  const router = useRouter();
  const listId = useId();
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      const timer = window.setTimeout(() => {
        setResults([]);
        setOpen(false);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/staff/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = await res.json().catch(() => null);
        if (!controller.signal.aborted) {
          setResults(data?.ok ? data.results : []);
          setActive(0);
          setOpen(true);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults([]);
          setOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  return (
    <div ref={root} className="staff-quick-search">
      <div className="staff-quick-search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        <input
          value={q}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          placeholder={t("Name, phone, email or file", "اسم العميل، الهاتف، البريد أو الملف")}
          aria-label={t("Search client by phone, email or file", "البحث عن عميل بالاسم أو الهاتف أو البريد أو الملف")}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          onKeyDown={event => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setOpen(true); setActive(value => Math.min(value + 1, results.length - 1)); }
            if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActive(value => Math.max(value - 1, 0)); }
            if (event.key === "Enter" && open && results[active]) { event.preventDefault(); setOpen(false); router.push(`/staff/client/${results[active].id}`); }
          }}
        />
        {loading && <span className="staff-search-pulse" />}
      </div>

      {open && (
        <div id={listId} className="staff-search-results" role="listbox" aria-label={t("Client search results", "نتائج البحث عن العملاء")}>
          {results.map((result, index) => (
            <Link key={result.id} href={`/staff/client/${result.id}`} className="staff-search-result" role="option" id={`${listId}-${index}`} aria-selected={active === index} onMouseEnter={() => setActive(index)} onClick={() => setOpen(false)}>
              <div className="staff-search-result-head">
                <div><strong dir="auto">{result.full_name}</strong><code dir="ltr">{result.ref}</code></div>
                <span>{pretty(result.pipeline_stage)}</span>
              </div>
              <div className="staff-search-report">
                <p><span>{t("Phone", "الهاتف")}</span><bdi dir="ltr">{result.phone}</bdi></p>
                <p><span>{t("Owner", "الموظف")}</span><bdi>{result.staff_code ?? "—"} · {result.assigned_name ?? t("Unassigned", "غير معيّن")}</bdi></p>
                <p><span>{t("Location", "الموقع")}</span><bdi dir="ltr">{result.site_code ?? "—"} · {result.shift_code ?? "—"}</bdi></p>
                <p><span>{t("Payment", "السداد")}</span><bdi dir="ltr">{result.payment_status === "paid" ? `${t("Paid", "مدفوع")} $${Number(result.fee_amount ?? 0).toFixed(0)}` : pretty(result.payment_status)}</bdi></p>
              </div>
              <div className="staff-search-next"><span>{t("Next", "التالي")}</span>{result.next_step}</div>
            </Link>
          ))}
          {!results.length && !loading && <div className="staff-search-empty">{t("No matching client.", "لا يوجد عميل مطابق.")}</div>}
        </div>
      )}
    </div>
  );
}
