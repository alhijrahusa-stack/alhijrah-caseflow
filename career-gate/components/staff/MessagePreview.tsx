"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import { OFFICE } from "@/lib/office";

export function buildMessage(c: Record<string, any>) {
  const first = String(c.full_name).split(" ")[0];
  return [
    `Hello ${first},`,
    ``,
    `This is ${OFFICE.company} — ${OFFICE.product}, about your employment request ${c.ref}.`,
    `Current status: ${STATUS_LABELS[c.current_status as Status] ?? c.current_status}.`,
    `Next step: ${c.next_step}`,
    ``,
    `Questions? Call ${OFFICE.phone}, WhatsApp ${OFFICE.whatsapp}, or email ${OFFICE.email}.`,
  ].join("\n");
}

/** Preview and copy only. Nothing is sent from the server. */
export function MessagePreview({ client }: { client: Record<string, any> }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const text = buildMessage(client);
  const wa = `https://wa.me/1${client.phone}?text=${encodeURIComponent(text)}`;
  return (
    <section className="rounded-lg border border-slate-200 bg-white" data-testid="section-message">
      <header className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">Message Preview</header>
      <div className="space-y-2 p-4 text-sm">
        <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-sm" data-testid="message-text">{text}</pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied("ok");
              } catch {
                setCopied("fail");
              }
            }}>
            Copy Message
          </button>
          <a className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50" href={wa} target="_blank" rel="noopener">Open in WhatsApp</a>
          {client.email && (
            <a className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
              href={`mailto:${client.email}?subject=${encodeURIComponent(`${OFFICE.product} ${client.ref}`)}&body=${encodeURIComponent(text)}`}>
              Open in Email
            </a>
          )}
        </div>
        {copied === "ok" && <p className="text-xs text-green-700">Copied.</p>}
        {copied === "fail" && <p className="text-xs text-red-600">Copy failed — select the text and copy it manually.</p>}
        <p className="text-xs text-slate-500">Nothing is sent automatically. After you send it, use Mark Contacted to record it.</p>
      </div>
    </section>
  );
}
