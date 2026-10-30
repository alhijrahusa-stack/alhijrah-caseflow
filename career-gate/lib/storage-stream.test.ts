import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadObject, downloadObjectStream } from "@/lib/storage";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function storageFetch(response: Response) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Private document storage streaming", () => {
  it("retains authenticated upstream streaming, no-store and byte range headers", async () => {
    const upstream = new Response("partial-pdf", { status: 206, headers: { "Content-Range": "bytes 0-10/100" } });
    const fetchMock = storageFetch(upstream);
    const result = await downloadObjectStream("smart-import/case/identity file.pdf", "bytes=0-10");
    expect(result).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledWith("https://storage-test.supabase.co/storage/v1/object/documents/smart-import/case/identity%20file.pdf", expect.objectContaining({
      cache: "no-store",
      headers: { Authorization: "Bearer server-only-test-key", apikey: "server-only-test-key", Range: "bytes=0-10" },
    }));
    expect(result.bodyUsed).toBe(false);
  });

  it("keeps existing downloadObject byte consumers compatible", async () => {
    const fetchMock = storageFetch(new Response(new Uint8Array([1, 2, 3])));
    expect(await downloadObject("smart-import/case/id.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: "Bearer server-only-test-key", apikey: "server-only-test-key" }, cache: "no-store",
    }));
  });

  it("allows the viewer to preserve upstream unsatisfiable range status", async () => {
    const upstream = new Response(null, { status: 416, headers: { "Content-Range": "bytes */100" } });
    storageFetch(upstream);
    expect(await downloadObjectStream("smart-import/case/id.pdf", "bytes=200-")).toBe(upstream);
  });

  it("rejects invalid storage paths before issuing a request", async () => {
    const fetchMock = storageFetch(new Response("unused"));
    await expect(downloadObjectStream("smart-import/../id.pdf")).rejects.toThrow("Invalid storage path");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
