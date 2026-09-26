"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Recording } from "@/lib/types";

export default function TranscriptionsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Recording[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const load = () => api<{ recordings: Recording[] }>("/api/recordings").then((r) => setItems(r.recordings)).catch(() => setItems([]));
    void load();
    const h = setInterval(load, 8000);
    return () => clearInterval(h);
  }, []);
  const shown = useMemo(() => (items ?? []).filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase())), [items, q]);
  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-semibold">{t("transcriptions")}</h1>
      <Input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
      {items && shown.length === 0 && <p className="muted py-10 text-center text-sm">{t("no_recordings")}</p>}
      <div className="space-y-2.5">
        {shown.map((r) => (
          <Link key={r.id} href={`/transcriptions/${r.id}`} className="glass flex items-center gap-4 rounded-3xl p-4 transition hover:bg-white/70 dark:hover:bg-white/[0.06]" data-testid="recording-row">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" dir="auto">{r.title}</div>
              <div className="muted mt-0.5 text-xs">
                <span dir="ltr">{fmtTime(r.duration_ms)}</span> · {new Date(r.uploaded_at).toLocaleString()}
              </div>
            </div>
            {!!r.open_disputes && <Badge tone="warn">{r.open_disputes} {t("open_regions")}</Badge>}
            <StatusBadge status={r.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
