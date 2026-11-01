import { describe, expect, it } from "vitest";
import { decodeRegistryCursor, encodeRegistryCursor } from "@/lib/registry-cursor";

describe("registry keyset cursor", () => {
  it("preserves microsecond precision, UUID and direction", () => {
    const cursor = { time: "2025-01-01T12:34:56.123456Z", id: "2c9a34e4-8548-4ae3-bcb1-3feb358a3201", direction: "before" as const };
    expect(decodeRegistryCursor(encodeRegistryCursor(cursor))).toEqual(cursor);
  });
  it("rejects malformed timestamps, UUIDs, and directions", () => {
    for (const value of [
      { time: "2025-02-30T12:34:56.123456Z", id: "2c9a34e4-8548-4ae3-bcb1-3feb358a3201", direction: "after" },
      { time: "2025-01-01T12:34:56.123456Z", id: "bad", direction: "after" },
      { time: "2025-01-01T12:34:56.123456Z", id: "2c9a34e4-8548-4ae3-bcb1-3feb358a3201", direction: "sideways" },
    ]) expect(decodeRegistryCursor(Buffer.from(JSON.stringify(value)).toString("base64url"))).toBeNull();
    expect(decodeRegistryCursor("a".repeat(513))).toBeNull();
  });
});
