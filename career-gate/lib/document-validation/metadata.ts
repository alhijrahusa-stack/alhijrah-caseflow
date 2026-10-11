import "server-only";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export type DocumentMetadata = {
  mime_type: string;
  byte_size: number;
  format: string | null;
  width: number | null;
  height: number | null;
  density: number | null;
  orientation: number | null;
  page_count: number | null;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  creation_date: string | null;
  modification_date: string | null;
  analysis_state: "COMPLETE" | "PARTIAL" | "UNSUPPORTED";
  errors: string[];
};

function iso(value: Date | undefined) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

/**
 * Extracts non-authoritative metadata for operator context and diagnostics.
 * Metadata is never converted into an authenticity/fraud verdict.
 */
export async function analyzeDocumentMetadata(bytes: Uint8Array, mimeType: string): Promise<DocumentMetadata> {
  const base: DocumentMetadata = {
    mime_type: mimeType,
    byte_size: bytes.byteLength,
    format: null,
    width: null,
    height: null,
    density: null,
    orientation: null,
    page_count: null,
    title: null,
    author: null,
    subject: null,
    creator: null,
    producer: null,
    creation_date: null,
    modification_date: null,
    analysis_state: "UNSUPPORTED",
    errors: [],
  };

  if (mimeType.startsWith("image/")) {
    try {
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const meta = await sharp(buffer, { failOn: "none" }).metadata();
      return {
        ...base,
        format: meta.format ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        density: meta.density ?? null,
        orientation: meta.orientation ?? null,
        page_count: meta.pages ?? 1,
        analysis_state: "COMPLETE",
      };
    } catch (error) {
      return {
        ...base,
        analysis_state: "PARTIAL",
        errors: [error instanceof Error ? error.message : "Image metadata unavailable"],
      };
    }
  }

  if (mimeType === "application/pdf") {
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      return {
        ...base,
        format: "pdf",
        page_count: pdf.getPageCount(),
        title: pdf.getTitle() ?? null,
        author: pdf.getAuthor() ?? null,
        subject: pdf.getSubject() ?? null,
        creator: pdf.getCreator() ?? null,
        producer: pdf.getProducer() ?? null,
        creation_date: iso(pdf.getCreationDate()),
        modification_date: iso(pdf.getModificationDate()),
        analysis_state: "COMPLETE",
      };
    } catch (error) {
      return {
        ...base,
        format: "pdf",
        analysis_state: "PARTIAL",
        errors: [error instanceof Error ? error.message : "PDF metadata unavailable"],
      };
    }
  }

  return base;
}
