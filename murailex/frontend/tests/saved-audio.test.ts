// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));
import { loadSavedAudio } from "@/lib/saved-audio";

const id = "12345678-1234-1234-1234-123456789abc";
const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const metadata = { id, original_filename: "saved.m4a", mime_type: "audio/mp4", byte_size: bytes.length, sha256 };
const mediaPath = `/api/media/${id}/original?exp=123&sig=test`;
let transport: ReturnType<typeof vi.fn>;
beforeEach(() => {
  apiMock.mockReset().mockResolvedValueOnce({ recording: metadata }).mockResolvedValueOnce({ url: mediaPath });
  transport = vi.fn(async () => new Response(bytes));
  vi.stubGlobal("fetch", transport);
  vi.stubGlobal("location", { origin: "https://app.example" });
});
afterEach(() => vi.unstubAllGlobals());

describe("authorized saved original for direct transcription", () => {
  it("loads unchanged bytes, verifies SHA-256, and never starts forensic processing", async () => {
    const result = await loadSavedAudio(id);
    expect(result.file.name).toBe("saved.m4a");
    expect(result.sha256).toBe(sha256);
    expect(Buffer.from(await result.file.arrayBuffer())).toEqual(bytes);
    expect(transport).toHaveBeenCalledWith(new URL(mediaPath, "https://app.example"), expect.objectContaining({ credentials: "same-origin", cache: "no-store", redirect: "error" }));
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual([`/api/recordings/${id}`, `/api/recordings/${id}/media-url?variant=original`]);
    expect(apiMock.mock.calls.every(([, options]) => !options.method || options.method === "GET")).toBe(true);
  });

  it("rejects an unauthorized recording before downloading audio", async () => {
    apiMock.mockReset().mockRejectedValue(new Error("Access denied"));
    await expect(loadSavedAudio(id)).rejects.toThrow("Access denied");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects an oversized recording before requesting a media link", async () => {
    apiMock.mockReset().mockResolvedValue({ recording: { ...metadata, byte_size: 25_000_001 } });
    await expect(loadSavedAudio(id)).rejects.toThrow("25 MB");
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["https://other.example/original", `/api/media/other/original`])("rejects an unrelated media URL: %s", async url => {
    apiMock.mockReset().mockResolvedValueOnce({ recording: metadata }).mockResolvedValueOnce({ url });
    await expect(loadSavedAudio(id)).rejects.toThrow("does not match this recording");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects changed source bytes", async () => {
    transport.mockResolvedValue(new Response(Buffer.alloc(bytes.length, 1)));
    await expect(loadSavedAudio(id)).rejects.toThrow("SHA-256 verification failed");
  });

  it.each([Buffer.alloc(bytes.length - 1), Buffer.alloc(bytes.length + 1)])("rejects a wrong stored byte count", async stored => {
    transport.mockResolvedValue(new Response(stored));
    await expect(loadSavedAudio(id)).rejects.toThrow("size does not match");
  });

  it("rejects an invalid identifier without API access", async () => {
    await expect(loadSavedAudio("../other")).rejects.toThrow("Invalid recording identifier");
    expect(apiMock).not.toHaveBeenCalled();
  });
});
