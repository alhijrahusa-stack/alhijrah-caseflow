"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  source: "vault" | "account";
  recordId: string;
  field: "password" | "pin";
  mask?: string;
};

async function fetchSecret(source: Props["source"], recordId: string, field: Props["field"], intent: "reveal" | "copy") {
  const endpoint = source === "vault"
    ? "/api/staff/gate-job-account/emails/reveal"
    : "/api/staff/gate-job-account/accounts/reveal";
  const body = source === "vault"
    ? { id: recordId, field, intent }
    : { account_id: recordId, field, intent };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok || typeof data.value !== "string") throw new Error(data?.error?.message ?? "Credential request failed");
  return data.value as string;
}

export function CredentialField({ source, recordId, field, mask = field === "password" ? "••••••••••" : "••••••" }: Props) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, setPending] = useState<"reveal" | "copy" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function reveal() {
    setPending("reveal"); setMessage(null);
    try {
      const secret = await fetchSecret(source, recordId, field, "reveal");
      setValue(secret);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(null), 30_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reveal credential");
    } finally {
      setPending(null);
    }
  }

  async function copy() {
    setPending("copy"); setMessage(null);
    try {
      const secret = await fetchSecret(source, recordId, field, "copy");
      await navigator.clipboard.writeText(secret);
      setMessage("Copied");
      setTimeout(() => setMessage(null), 1800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to copy credential");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex min-h-9 min-w-0 items-center gap-2" data-secret-state={value ? "revealed" : pending ? "loading" : message ? "feedback" : "masked"}>
      <code className="min-w-[7rem] max-w-[15rem] truncate rounded-lg border border-white/[.06] bg-black/20 px-2 py-1.5 text-xs text-slate-200" aria-live="polite">
        {pending === "reveal" ? "Loading…" : value ?? mask}
      </code>
      <button type="button" onClick={value ? () => setValue(null) : reveal} disabled={pending !== null}
        className="rounded-lg border border-amber-300/20 bg-amber-200/[.04] px-2 py-1.5 text-[10px] font-semibold text-amber-100 transition active:translate-y-px disabled:opacity-50">
        {value ? "Hide" : pending === "reveal" ? "…" : "Reveal"}
      </button>
      <button type="button" onClick={copy} disabled={pending !== null}
        className="rounded-lg border border-cyan-300/15 bg-cyan-300/[.04] px-2 py-1.5 text-[10px] font-semibold text-cyan-100 transition active:translate-y-px disabled:opacity-50">
        {pending === "copy" ? "…" : "Copy"}
      </button>
      {message && <span className="max-w-[12rem] truncate text-[10px] text-cyan-300" role="status">{message}</span>}
    </div>
  );
}
