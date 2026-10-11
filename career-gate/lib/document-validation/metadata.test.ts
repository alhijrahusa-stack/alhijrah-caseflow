import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { analyzeDocumentMetadata } from "@/lib/document-validation/metadata";

describe("document metadata analysis", () => {
  it("extracts image dimensions without making an authenticity claim", async () => {
    const image = await sharp({
      create: { width: 24, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).jpeg().toBuffer();
    const result = await analyzeDocumentMetadata(new Uint8Array(image), "image/jpeg");
    expect(result).toMatchObject({
      format: "jpeg",
      width: 24,
      height: 16,
      page_count: 1,
      analysis_state: "COMPLETE",
    });
    expect(result).not.toHaveProperty("authenticity");
  });

  it("extracts PDF page count and producer metadata", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    pdf.addPage([300, 400]);
    pdf.setTitle("TEST DOCUMENT");
    pdf.setProducer("Career Gate Test");
    const bytes = await pdf.save();
    const result = await analyzeDocumentMetadata(bytes, "application/pdf");
    expect(result.page_count).toBe(2);
    expect(result.title).toBe("TEST DOCUMENT");
    expect(result.producer).toBe("Career Gate Test");
    expect(result.analysis_state).toBe("COMPLETE");
  });
});
