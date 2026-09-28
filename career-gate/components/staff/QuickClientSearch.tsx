"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
        setResults(data?.ok ? data.results : []);
        setOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults([]);
          setOpen(true);
        }
      } finally {
        setLoading(false);
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
          onChange={(e) => setQ(e.target.value)}
          placeholder="Phone, email or file"
          aria-label="Search client by phone, email or file"
        />
        {loading && <span className="staff-search-pulse" />}
      </div>

      {open && (
        <div className="staff-search-results" role="listbox">
          {results.map((result) => (
            <Link key={result.id} href={`/staff/client/${result.id}`} className="staff-search-result" onClick={() => setOpen(false)}>
              <div className="staff-search-result-head">
                <div><strong>{result.full_name}</strong><code>{result.ref}</code></div>
                <span>{pretty(result.pipeline_stage)}</span>
              </div>
              <div className="staff-search-report">
                <p><span>Phone</span>{result.phone}</p>
                <p><span>Owner</span>{result.staff_code ?? "—"} · {result.assigned_name ?? "Unassigned"}</p>
                <p><span>Location</span>{result.site_code ?? "—"} · {result.shift_code ?? "—"}</p>
                <p><span>Payment</span>{result.payment_status === "paid" ? `Paid $${Number(result.fee_amount ?? 0).toFixed(0)}` : pretty(result.payment_status)}</p>
              </div>
              <div className="staff-search-next"><span>Next</span>{result.next_step}</div>
            </Link>
          ))}
          {!results.length && !loading && <div className="staff-search-empty">No matching client.</div>}
        </div>
      )}
    </div>
  );
}
