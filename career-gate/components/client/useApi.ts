"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Calls a JSON API route, then refreshes server data on success. */
export function useApi() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call<T = unknown>(url: string, method: string, body?: unknown): Promise<T | null> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      router.refresh();
      return data as T;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setPending(false);
    }
  }

  return { call, pending, error, setError };
}
