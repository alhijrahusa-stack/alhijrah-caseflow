import { describe, expect, it } from "vitest";

import { fmtBytes, fmtTime, shortHash, textDir } from "@/lib/format";
import { dictionaries } from "@/lib/i18n";

describe("format", () => {
  it("formats times", () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(61_500)).toBe("1:01");
    expect(fmtTime(3_723_004, true)).toBe("1:02:03.004");
    expect(fmtTime(null)).toBe("--:--");
  });
  it("formats sizes and hashes", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(shortHash("a".repeat(64))).toMatch(/^a{12}…a{6}$/);
  });
  it("detects direction without altering text", () => {
    expect(textDir("والله ما شفته")).toBe("rtl");
    expect(textDir("okay then")).toBe("ltr");
    expect(textDir("قال okay")).toBe("rtl");
  });
});

describe("i18n", () => {
  it("has identical keys in Arabic and English", () => {
    expect(Object.keys(dictionaries.ar).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });
  it("never labels anything as certified", () => {
    for (const d of Object.values(dictionaries)) for (const v of Object.values(d)) expect(v.toLowerCase()).not.toContain("certified");
  });
});
