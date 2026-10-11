import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { preflightImageQuality, qualityFailureMessage } from "@/lib/document-validation/quality";

describe("document capture quality preflight", () => {
  it("passes usable image dimensions and records deterministic quality signals", async () => {
    const image = await sharp({
      create: { width: 1200, height: 760, channels: 3, background: { r: 120, g: 130, b: 140 } },
    }).jpeg().toBuffer();
    const result = await preflightImageQuality(new Uint8Array(image), "image/jpeg");
    expect(result.checks.find((item) => item.type === "RESOLUTION")?.result).toBe("PASSED");
    expect(result.checks.find((item) => item.type === "BRIGHTNESS")?.result).toBe("PASSED");
    expect(["PASSED", "REVIEW"]).toContain(result.overall);
  });

  it("fails a reliably unusable low-resolution capture with a concrete retry message", async () => {
    const image = await sharp({
      create: { width: 160, height: 100, channels: 3, background: { r: 120, g: 120, b: 120 } },
    }).jpeg().toBuffer();
    const result = await preflightImageQuality(new Uint8Array(image), "image/jpeg");
    expect(result.overall).toBe("FAILED");
    expect(result.checks.find((item) => item.type === "RESOLUTION")?.result).toBe("FAILED");
    expect(qualityFailureMessage(result)).toMatch(/higher-resolution/i);
  });

  it("does not invent image-quality results for PDFs", async () => {
    expect(await preflightImageQuality(new Uint8Array([1, 2, 3]), "application/pdf")).toEqual({
      overall: "NOT_PERFORMED",
      checks: [],
    });
  });
});
