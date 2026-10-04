import { describe, expect, it } from "vitest";

import { ExportEnvelope, RecordingEnvelope } from "@/lib/schemas";

const sha = "a".repeat(64);

describe("API response contracts", () => {
  it("accepts a valid export and tolerates extra fields", () => {
    const ok = ExportEnvelope.safeParse({
      export: { id: "e", format: "pdf", filename: "x.pdf", sha256: sha, bytes: 10, download_url: "/api/exports/e/download", extra: 1 },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a malformed hash or missing size", () => {
    expect(ExportEnvelope.safeParse({ export: { id: "e", format: "pdf", filename: "x.pdf", sha256: "zz", bytes: 10, download_url: "/d" } }).success).toBe(false);
    expect(
      RecordingEnvelope.safeParse({
        recording: { id: "r", title: "t", status: "ready", status_detail: null, sha256: sha, duration_ms: 1, uploaded_at: "", language_locale: "ar" },
      }).success,
    ).toBe(false);
  });
});
