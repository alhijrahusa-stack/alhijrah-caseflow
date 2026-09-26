"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Recording } from "@/lib/types";

export default function ReviewQueue() {
  const { t } = useI18n();
  const [items, setItems] = useState<Recording[] | null>(null);
  useEffect(() => {
    api<{ items: Recording[] }>("/api/review/queue").then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  return (
    <div className="space-y-5 fade-in">
      <h1 className="text-2xl font-semibold">{t("review")}</h1>
      {items && items.length === 0 && <p className="muted py-10 text-center text-sm">{t("no_open_regions")}</p>}
      <div className="space-y-2.5">
        {items?.map((r) => (
          <Link key={r.id} href={`/review/${r.id}`} className="glass flex items-center gap-4 rounded-3xl p-4">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" dir="auto">{r.title}</div>
              <div className="muted text-xs" dir="ltr">{fmtTime(r.duration_ms)}</div>
            </div>
            <Badge tone="warn">{r.open_disputes} {t("open_regions")}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
