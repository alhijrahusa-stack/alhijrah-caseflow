import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientResourceReader } from "./client-resource-reader";

const CLIENT = "cfdb70b7-7000-4cf1-b8f5-c028c5789be2";
const OTHER = "0ae38bd4-fd62-4e11-973f-1137b2d589c0";

function response(payloads: Record<string, unknown>) {
  return Response.json({ ok: true, payloads });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function requestParams(fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) {
  return new URL(String(fetcher.mock.calls[index][0]), "https://career-gate.example").searchParams;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("client resource request batches", () => {
  it("unites three panel reads once and projects each panel's owned data, including derived readiness", async () => {
    const client = { id: CLIENT, ref: "CG-TEST" };
    const requirements = [{ id: "requirement", verified: true }];
    const readiness = { ready: true };
    const postHire = [{ id: "post-hire" }];
    const notes = [{ id: "note" }];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      client, requirements, readiness, postHire, notes,
      account: { mustNotReachUnrelatedPanels: true },
    }));
    const read = createClientResourceReader(fetcher);

    const identityPanel = read(CLIENT, ["client"]);
    const readinessPanel = read(CLIENT, ["requirements", "postHire"]);
    const notesPanel = read(CLIENT, ["notes", "client"]);

    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestParams(fetcher).get("client_id")).toBe(CLIENT);
    expect(requestParams(fetcher).get("payloads")).toBe("client,notes,postHire,requirements");
    expect(fetcher.mock.calls[0][1]).toEqual({ cache: "no-store" });
    await expect(identityPanel).resolves.toEqual({ client });
    await expect(readinessPanel).resolves.toEqual({ requirements, postHire, readiness });
    await expect(notesPanel).resolves.toEqual({ notes, client });
  });

  it("includes an adjacent subscriber timer in the same small batching window", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ client: {}, notes: [] }));
    const read = createClientResourceReader(fetcher);
    const first = read(CLIENT, ["client"]);
    let adjacent: Promise<Record<string, unknown>> | undefined;
    setTimeout(() => { adjacent = read(CLIENT, ["notes"]); }, 5);

    await vi.advanceTimersByTimeAsync(10);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestParams(fetcher).get("payloads")).toBe("client,notes");
    await expect(first).resolves.toEqual({ client: {} });
    await expect(adjacent).resolves.toEqual({ notes: [] });
  });

  it("starts a fresh read for a later invalidation while the previous snapshot is still in flight", async () => {
    const earlierResponse = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>()
      .mockReturnValueOnce(earlierResponse.promise)
      .mockResolvedValueOnce(response({ notes: [{ version: 2 }] }));
    const read = createClientResourceReader(fetcher);

    const earlier = read(CLIENT, ["notes"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const later = read(CLIENT, ["notes"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(later).resolves.toEqual({ notes: [{ version: 2 }] });

    earlierResponse.resolve(response({ notes: [{ version: 1 }] }));
    await expect(earlier).resolves.toEqual({ notes: [{ version: 1 }] });
    // The caller's existing sequence guard owns application order; the reader
    // must supply a new snapshot rather than reuse the earlier request.
  });

  it("does not cache a completed read across later invalidations", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ notes: [{ version: 1 }] }))
      .mockResolvedValueOnce(response({ notes: [{ version: 2 }] }));
    const read = createClientResourceReader(fetcher);

    const first = read(CLIENT, ["notes"]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toEqual({ notes: [{ version: 1 }] });

    const later = read(CLIENT, ["notes"]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(later).resolves.toEqual({ notes: [{ version: 2 }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps two clients' pending reads and returned data separate", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const id = new URL(String(input), "https://career-gate.example").searchParams.get("client_id");
      return response({ client: { id } });
    });
    const read = createClientResourceReader(fetcher);
    const firstClient = read(CLIENT, ["client"]);
    const otherClient = read(OTHER, ["client"]);

    await vi.advanceTimersByTimeAsync(10);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Set([requestParams(fetcher, 0).get("client_id"), requestParams(fetcher, 1).get("client_id")]))
      .toEqual(new Set([CLIENT, OTHER]));
    await expect(firstClient).resolves.toEqual({ client: { id: CLIENT } });
    await expect(otherClient).resolves.toEqual({ client: { id: OTHER } });
  });

  it("keeps reader instances belonging to different staff providers isolated", async () => {
    const firstFetch = vi.fn<typeof fetch>().mockResolvedValue(response({ client: { access: "first-session" } }));
    const otherFetch = vi.fn<typeof fetch>().mockResolvedValue(response({ client: { access: "other-session" } }));
    const firstRead = createClientResourceReader(firstFetch);
    const otherRead = createClientResourceReader(otherFetch);
    const first = firstRead(CLIENT, ["client"]);
    const other = otherRead(CLIENT, ["client"]);

    await vi.advanceTimersByTimeAsync(10);

    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(otherFetch).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toEqual({ client: { access: "first-session" } });
    await expect(other).resolves.toEqual({ client: { access: "other-session" } });
  });

  it.each<[string, () => Promise<Response>]>([
    ["network failure", async () => { throw new TypeError("network unavailable"); }],
    ["HTTP rejection", async () => Response.json({ ok: true, payloads: { notes: [] } }, { status: 403 })],
    ["invalid JSON", async () => new Response("invalid-json", { status: 200 })],
    ["unsuccessful API body", async () => Response.json({ ok: false, payloads: { notes: [] } })],
    ["missing payload object", async () => Response.json({ ok: true })],
    ["array payload", async () => Response.json({ ok: true, payloads: [] })],
  ])("rejects every waiter after %s and allows a successful next read", async (_label, fail) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(fail)
      .mockResolvedValueOnce(response({ notes: [{ id: "recovered" }] }));
    const read = createClientResourceReader(fetcher);
    // Attach rejection handlers before the timer dispatches the failing batch.
    const failed = Promise.allSettled([read(CLIENT, ["notes"]), read(CLIENT, ["notes"])]);
    await vi.advanceTimersByTimeAsync(10);

    const settled = await failed;
    expect(settled.map(result => result.status)).toEqual(["rejected", "rejected"]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const retry = read(CLIENT, ["notes"]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(retry).resolves.toEqual({ notes: [{ id: "recovered" }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
