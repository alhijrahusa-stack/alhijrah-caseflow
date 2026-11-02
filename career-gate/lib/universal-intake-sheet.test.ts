import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGoogleSheet } from "@/lib/universal-intake";

const SHEET = "https://docs.google.com/spreadsheets/d/test-sheet/edit";
const LIMIT = 10 * 1024 * 1024;

afterEach(() => vi.unstubAllGlobals());

describe("Google Sheets response size limit", () => {
  it("decodes a valid multilingual CSV even when a UTF-8 character spans chunks", async () => {
    const encoded = new TextEncoder().encode("name\nعبدالله\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 6));
        controller.enqueue(encoded.slice(6));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(fetchGoogleSheet(SHEET)).resolves.toBe("name\nعبدالله\n");
  });

  it("stops an oversized stream without trusting a missing or incorrect Content-Length", async () => {
    const cancelled = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(pulls === 1 ? LIMIT : 1));
      },
      cancel: cancelled,
    }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Length": "1" } })));
    await expect(fetchGoogleSheet(SHEET)).rejects.toMatchObject({ code: "sheet_too_large", status: 413 });
    expect(pulls).toBe(2);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("rejects a declared oversized response without reading its body", async () => {
    const cancelled = vi.fn();
    const pull = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull, cancel: cancelled }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { headers: { "Content-Length": String(LIMIT + 1) } })));
    await expect(fetchGoogleSheet(SHEET)).rejects.toMatchObject({ code: "sheet_too_large", status: 413 });
    expect(pull).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
