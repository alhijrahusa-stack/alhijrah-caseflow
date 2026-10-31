"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { useToast } from "@/components/ui/Toast";

export function RecoverSearchIndexButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  return <button type="button" disabled={pending} className="ops-secondary-button disabled:opacity-50" onClick={async () => {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/staff/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recover_embeddings" }), signal: AbortSignal.timeout(55_000) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "Search index recovery failed");
      setRemaining(body.remaining);
      toast(body.remaining === 0 ? "success" : "info", `${body.indexed} search items indexed. ${body.remaining} jobs remaining.`);
      startTransition(() => router.refresh());
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Search index recovery failed");
    } finally { setPending(false); }
  }}>{pending ? "Repairing search index…" : remaining && remaining > 0 ? `Continue search repair · ${remaining} remaining` : "Repair search index"}</button>;
}
