"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { rowClass } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { RowSkeletons } from "@/components/ui/skeleton";
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
      <PageHeader title={t("transcriptions")} />
      <Input type="search" aria-label={t("search")} placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
      {items === null && <RowSkeletons count={4} />}
      {items && shown.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">{t("no_recordings")}</p>}
      <div className="space-y-2.5">
        {shown.map((r) => (
          <Link key={r.id} href={`/transcriptions/${r.id}`} className={rowClass} data-testid="recording-row">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-fg" dir="auto">{r.title}</div>
              <div className="mt-1 text-xs text-fg-subtle">
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
