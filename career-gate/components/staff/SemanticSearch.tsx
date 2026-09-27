"use client";

import Link from "next/link";
import { useState } from "react";
import { STATUS_LABELS, type Status } from "@/lib/domain";

type Hit = { client_id: string; ref: string; full_name: string; current_status: Status; source_type: string; content_redacted: string; score: string };

/** Meaning-based search over notes/tasks/contacts. Status shown comes from the client record. */
export function SemanticSearch({ configured }: { configured: boolean }) {
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" data-testid="semantic-search">
      <h2 className="text-sm font-semibold">Semantic search</h2>
      {!configured ? (
        <p className="mt-2 text-sm text-slate-500">NOT_CONFIGURED — embeddings need OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL and EMBEDDING_DIMENSIONS=1536.</p>
      ) : (
        <form className="mt-2 flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const res = await fetch(`/api/staff/semantic-search?q=${encodeURIComponent(q)}`);
          const data = await res.json().catch(() => null);
          setPending(false);
          if (!data?.ok) return setError(data?.error?.message ?? "Search failed");
          setHits(data.results);
        }}>
          <input className="input" placeholder="e.g. clients mentioning agency status" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Semantic search query" />
          <button className="rounded-md bg-slate-800 px-4 text-sm text-white" disabled={pending}>{pending ? "…" : "Search"}</button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {hits && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {hits.map((h, i) => (
            <li key={i} className="py-2">
              <Link href={`/staff/client/${h.client_id}`} className="font-medium text-brand-700 hover:underline">{h.full_name} · {h.ref}</Link>
              <span className="ml-2 text-xs text-slate-500">{STATUS_LABELS[h.current_status]} · {h.source_type} · score {h.score}</span>
              <p className="text-slate-600">{h.content_redacted}</p>
            </li>
          ))}
          {!hits.length && <li className="py-2 text-slate-500">No matches.</li>}
        </ul>
      )}
    </section>
  );
}
