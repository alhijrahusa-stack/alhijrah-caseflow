// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ api: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), api: fake.api }));
vi.mock("@/lib/idb", () => ({ recordingsStore: { remove: fake.remove } }));
import { ApiError } from "@/lib/api";
import { pendingUploads, reconcilePendingUploads, resumableUpload } from "@/lib/upload";

const memory = new Map<string, string>();
const session = { id: "session", status: "open", chunk_size: 100, received_parts: [], total_parts: 1, received_bytes: 0, recording_id: null };
const opts = { name: "audio.m4a", title: "Audio", source: "upload" as const };
const stale = { fingerprint: "stale", name: "old.m4a", title: "Old", size: 4, uploadId: "old" };
beforeEach(() => {
  memory.clear(); fake.api.mockReset(); fake.remove.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
});

describe("resumable upload recovery and cleanup", () => {
  it("defaults to Arabic and clears only the successful upload", async () => {
    memory.set("murailex.pendingUploads", JSON.stringify([stale]));
    fake.api.mockResolvedValueOnce(session).mockResolvedValueOnce({}).mockResolvedValueOnce({ recording: { id: "r" } });
    const recording = await resumableUpload(new Blob(["audio"]), opts);
    expect(recording.id).toBe("r");
    expect(fake.api.mock.calls[0][1].json).toMatchObject({ language_locale: "ar", recording_type: "other" });
    expect(pendingUploads()).toEqual([stale]);
  });

  it("restarts exactly once when the server expires a multipart session", async () => {
    fake.api.mockResolvedValueOnce(session).mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError(409, "expired", { code: "UPLOAD_SESSION_EXPIRED" }))
      .mockResolvedValueOnce({ ...session, id: "replacement" }).mockResolvedValueOnce({})
      .mockResolvedValueOnce({ recording: { id: "r" } });
    expect((await resumableUpload(new Blob(["audio"]), opts)).id).toBe("r");
    expect(fake.api.mock.calls.filter(([path]) => path === "/api/uploads")).toHaveLength(2);
    expect(pendingUploads()).toEqual([]);
  });

  it("preserves an incomplete upload on a checksum error without restarting", async () => {
    fake.api.mockResolvedValueOnce(session).mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError(409, "mismatch", { code: "UPLOAD_INTEGRITY_ERROR" }));
    await expect(resumableUpload(new Blob(["audio"]), opts)).rejects.toMatchObject({ status: 409 });
    expect(pendingUploads()).toHaveLength(1);
    expect(fake.api.mock.calls.filter(([path]) => path === "/api/uploads")).toHaveLength(1);
  });

  it("reconciles a confirmed completed recording but preserves another pending upload", async () => {
    memory.set("murailex.pendingUploads", JSON.stringify([{ ...stale, storedRecordingId: "local-recording" }, { ...stale, fingerprint: "keep", uploadId: "unfinished" }]));
    fake.api.mockImplementation(async (path: string) => path.endsWith("/old") ? { status: "complete", recording_id: "r" } : { status: "open", recording_id: null });
    await reconcilePendingUploads();
    expect(fake.remove).toHaveBeenCalledWith("local-recording");
    expect(pendingUploads().map(p => p.fingerprint)).toEqual(["keep"]);
  });

  it("does not repeat a successful server upload when local cleanup fails", async () => {
    fake.remove.mockRejectedValue(new Error("local storage unavailable"));
    fake.api.mockResolvedValueOnce(session).mockResolvedValueOnce({}).mockResolvedValueOnce({ recording: { id: "r" } });
    expect((await resumableUpload(new Blob(["audio"]), { ...opts, storedRecordingId: "local" })).id).toBe("r");
    expect(pendingUploads()).toHaveLength(1);
  });
});
