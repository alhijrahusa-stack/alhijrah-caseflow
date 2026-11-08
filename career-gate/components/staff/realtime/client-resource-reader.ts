type Payloads = Record<string, unknown>;
type Waiter = { payloads: readonly string[]; resolve: (payloads: Payloads) => void; reject: (error: unknown) => void };
type Batch = { payloads: Set<string>; waiters: Waiter[] };

/**
 * One reader belongs to one mounted staff session. Panels invalidated by the
 * same update share a read, while a later update always starts a fresh one.
 * Nothing is cached after dispatch: sharing an already-running request could
 * otherwise return a snapshot taken before a newer mutation.
 */
export function createClientResourceReader(fetcher: typeof fetch = (...args) => fetch(...args)) {
  const pending = new Map<string, Batch>();
  return (clientId: string, payloads: readonly string[]): Promise<Payloads> => new Promise((resolve, reject) => {
    const waiter = { payloads, resolve, reject };
    const queued = pending.get(clientId);
    if (queued) {
      payloads.forEach(payload => queued.payloads.add(payload));
      queued.waiters.push(waiter);
      return;
    }
    const batch: Batch = { payloads: new Set(payloads), waiters: [waiter] };
    pending.set(clientId, batch);
    // All resource subscribers flush in the same burst. This small window also
    // covers adjacent timer callbacks without holding up visible updates.
    setTimeout(() => {
      pending.delete(clientId);
      const params = new URLSearchParams({ client_id: clientId, payloads: [...batch.payloads].sort().join(",") });
      void (async () => {
        try {
          const response = await fetcher(`/api/staff/client-resource?${params}`, { cache: "no-store" });
          const body = await response.json() as { ok?: boolean; payloads?: Payloads };
          if (!response.ok || !body?.ok || !body.payloads || typeof body.payloads !== "object" || Array.isArray(body.payloads)) throw new Error("targeted_fetch_failed");
          for (const current of batch.waiters) {
            const owned = new Set(current.payloads);
            if (owned.has("requirements")) owned.add("readiness");
            current.resolve(Object.fromEntries(Object.entries(body.payloads).filter(([key]) => owned.has(key))));
          }
        } catch (error) {
          for (const current of batch.waiters) current.reject(error);
        }
      })();
    }, 10);
  });
}
