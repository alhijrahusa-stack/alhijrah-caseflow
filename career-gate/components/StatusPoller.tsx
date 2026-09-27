"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Session-gated polling (no direct database subscription from the public page). */
export function StatusPoller({ refCode }: { refCode: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/status/${encodeURIComponent(refCode)}`, { cache: "no-store" }).catch(() => null);
      if (!res || res.status === 401) {
        clearInterval(t);
        router.refresh();
        return;
      }
      router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [refCode, router]);
  return null;
}
