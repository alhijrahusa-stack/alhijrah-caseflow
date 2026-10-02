"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { rowClass } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowSkeletons } from "@/components/ui/skeleton";
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
      <PageHeader title={t("review")} />
      {items === null && <RowSkeletons count={3} />}
      {items && items.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">{t("no_open_regions")}</p>}
      <div className="space-y-2.5">
        {items?.map((r) => (
          <Link key={r.id} href={`/review/${r.id}`} className={rowClass}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-fg" dir="auto">{r.title}</div>
              <div className="mt-1 font-mono text-xs text-fg-subtle" dir="ltr">{fmtTime(r.duration_ms)}</div>
            </div>
            <Badge tone="warn">{r.open_disputes} {t("open_regions")}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
