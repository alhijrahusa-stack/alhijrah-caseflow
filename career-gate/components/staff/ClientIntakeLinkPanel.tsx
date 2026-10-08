"use client";

import { useState } from "react";

/**
 * Issues a one-time client self-intake link.
 *
 * It sits above the existing Smart Client Import form and does not touch it:
 * the staff member can still capture a client's information themselves exactly
 * as before. The raw link is shown once, in this panel, and is never stored or
 * retrievable afterwards — only its digest reaches the database.
 */

type IssuedLink = { id: string; url: string; expires_at: string };

export function ClientIntakeLinkPanel() {
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [status, setStatus] = useState<"ACTIVE" | "REVOKED" | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE", body?: Record<string, unknown>) {
    const res = await fetch("/api/staff/client-intake-link", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
    return data;
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const data = await call("POST");
      setLink({ id: String(data.id), url: String(data.url), expires_at: String(data.expires_at) });
      setStatus("ACTIVE");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the client link");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      await call("DELETE", { link_id: link.id });
      setStatus("REVOKED");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the client link");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  }

  const expires = link ? new Date(link.expires_at) : null;

  return (
    <section
      className="rounded-2xl border border-[#e3c884]/20 bg-gradient-to-b from-[#e3c884]/[.055] to-transparent p-4 backdrop-blur-xl sm:p-5"
      data-testid="client-intake-link-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-tight text-white">CLIENT SELF-INTAKE</p>
          <p className="mt-0.5 text-[12px] text-slate-400" dir="rtl">رابط إدخال العميل</p>
        </div>
        {status && (
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.08em] ${
              status === "ACTIVE"
                ? "border-emerald-300/25 bg-emerald-300/[.08] text-emerald-200"
                : "border-red-400/25 bg-red-400/[.08] text-red-200"
            }`}
            data-testid="intake-link-status"
          >
            {status}
          </span>
        )}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          data-testid="generate-client-link"
          className="min-h-[40px] rounded-xl border border-[#e3c884]/35 bg-[#e3c884]/[.12] px-3.5 text-[12px] font-semibold text-[#f6e6b8] transition hover:bg-[#e3c884]/[.18] disabled:opacity-55"
        >
          {busy && !link ? "Generating…" : "GENERATE CLIENT LINK"}
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!link || status === "REVOKED"}
          data-testid="copy-client-link"
          className="min-h-[40px] rounded-xl border border-white/[.09] bg-white/[.03] px-3.5 text-[12px] font-semibold text-slate-200 transition hover:bg-white/[.06] disabled:opacity-40"
        >
          {copied ? "COPIED" : "COPY LINK"}
        </button>
        <button
          type="button"
          onClick={() => void revoke()}
          disabled={!link || busy || status === "REVOKED"}
          data-testid="revoke-client-link"
          className="min-h-[40px] rounded-xl border border-white/[.09] bg-white/[.03] px-3.5 text-[12px] font-semibold text-slate-300 transition hover:border-red-300/30 hover:text-red-200 disabled:opacity-40"
        >
          REVOKE
        </button>
      </div>

      {link && (
        <div className="mt-3.5 grid gap-1.5">
          <input
            readOnly
            value={status === "REVOKED" ? "" : link.url}
            aria-label="Client intake link"
            data-testid="client-link-url"
            className="w-full rounded-xl border border-white/[.09] bg-black/35 px-3 py-2.5 font-mono text-[11px] text-slate-200 focus:outline-none"
          />
          <p className="text-[11px] text-slate-500" data-testid="client-link-expiry">
            {status === "REVOKED"
              ? "Revoked. Generate a new link to send."
              : `Expires ${expires?.toLocaleString()} · single use · opening the link does not consume it`}
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-red-400/25 bg-red-400/[.07] px-3 py-2 text-[11px] text-red-200" role="alert" data-testid="intake-link-error">
          {error}
        </p>
      )}
    </section>
  );
}
