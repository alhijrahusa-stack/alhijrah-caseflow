"use client";

import { Badge } from "@/components/ui/badge";
import { type Key, useI18n } from "@/lib/i18n";

const TONES: Record<string, "neutral" | "accent" | "warn" | "danger" | "ok"> = {
  queued: "neutral",
  analyzing: "accent",
  transcribing: "accent",
  aligning: "accent",
  verifying: "accent",
  building: "accent",
  needs_review: "warn",
  ready: "ok",
  locked: "ok",
  failed: "danger",
  provider_not_configured: "danger",
};

export const PROCESSING = new Set(["queued", "analyzing", "transcribing", "aligning", "verifying", "building"]);

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const key = `st_${status}` as Key;
  return (
    <Badge tone={TONES[status] ?? "neutral"} data-status={status}>
      {PROCESSING.has(status) && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {t(key) || status}
    </Badge>
  );
}
