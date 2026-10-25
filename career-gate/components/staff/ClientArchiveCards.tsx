"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Client360Drawer } from "@/components/staff/Client360Drawer";
import type { OperationalClientRow } from "@/lib/operational-clients";

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Detroit" }).format(date)
    : "—";
}

export function ClientArchiveCards({ clients }: { clients: OperationalClientRow[] }) {
  const [client, setClient] = useState<OperationalClientRow | null>(null);
  const close = useCallback(() => setClient(null), []);

  return <>
    <div className="grid min-w-0 gap-2.5 md:grid-cols-2" data-testid="client-master-registry-cards">
      {clients.map(record => (
        <article className="cg-registry-card" key={record.id}>
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-200/20 bg-amber-200/10 text-sm font-bold text-amber-100">
              {record.full_name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => setClient(record)} className="block max-w-full break-words text-left text-base font-semibold leading-snug text-white hover:text-amber-200">
                {record.full_name}
              </button>
              <Link href={`/staff/client/${record.id}`} className="mt-1 block font-mono text-xs text-cyan-200 hover:underline">{record.ref}</Link>
              <p className="mt-1 truncate text-xs text-slate-400">{record.phone}{record.city ? ` · ${record.city}` : ""}</p>
            </div>
            <span className="max-w-28 shrink-0 break-words rounded-lg border border-amber-200/20 bg-amber-200/[.07] px-2 py-1 text-center text-[11px] font-medium capitalize text-amber-100">
              {record.current_status.replaceAll("_", " ")}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
            <div><span className="text-slate-400">Received · الاستلام</span><time className="mt-1 block font-medium text-slate-100" dateTime={record.created_at}>{dateLabel(record.created_at)}</time></div>
            <div className="min-w-0"><span className="text-slate-400">Assigned to</span><p className="mt-1 truncate text-slate-100">{record.assigned_name ?? "Unassigned"}</p></div>
            <div><span className="text-slate-400">Completion / Start</span><p className="mt-1 text-slate-100">{record.start_date ? dateLabel(record.start_date) : "Not confirmed"}</p></div>
            <div className="min-w-0"><span className="text-slate-400">Location</span><p className="mt-1 truncate text-slate-100">{record.site_name ?? "—"}</p></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => setClient(record)} className="cg-command-button flex-1">Client 360</button>
            <Link href={`/staff/client/${record.id}`} className="cg-command-button flex-1 text-center">Full record</Link>
          </div>
        </article>
      ))}
    </div>
    {client && <Client360Drawer client={{ id: client.id, ref: client.ref, full_name: client.full_name }} onClose={close} />}
  </>;
}
