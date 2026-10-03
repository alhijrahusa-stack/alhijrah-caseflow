"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ArchiveRestoreButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/staff/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "restore", client_id: clientId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? "Restore failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={() => void restore()} disabled={pending} className="archive-restore-button" data-executive-tactile="true">
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && <span className="text-xs text-red-300" role="alert">{error}</span>}
    </div>
  );
}
