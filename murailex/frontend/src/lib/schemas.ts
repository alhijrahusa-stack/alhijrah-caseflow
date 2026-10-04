import { z } from "zod";

/** Runtime contracts for the evidence-critical API responses. Unknown extra fields are
 * allowed (forward compatible); a missing or mistyped field fails loudly instead of rendering
 * a wrong hash, size or status. */

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const nullableSha = sha256.nullable();

export const RecordingSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  status: z.string().min(1),
  status_detail: z.string().nullable(),
  sha256,
  byte_size: z.number().int().nonnegative(),
  duration_ms: z.number().nullable(),
  uploaded_at: z.string(),
  language_locale: z.string().nullable(),
});

export const RecordingEnvelope = z.looseObject({ recording: RecordingSchema });

export const RevisionSchema = z.looseObject({
  id: z.string().min(1),
  number: z.number().int().positive(),
  status: z.enum(["draft", "locked"]),
  sha256: nullableSha,
  locked_at: z.string().nullable(),
  content: z
    .looseObject({
      segments: z.array(z.looseObject({ id: z.string(), start_ms: z.number(), end_ms: z.number(), items: z.array(z.looseObject({ text: z.string() })) })),
    })
    .optional(),
});

export const RevisionsEnvelope = z.looseObject({ revision: RevisionSchema.nullable(), revisions: z.array(RevisionSchema) });

export const UploadSessionSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  chunk_size: z.number().int().positive(),
  total_size: z.number().int().positive(),
  received_parts: z.array(z.number().int().positive()),
  total_parts: z.number().int().positive(),
  recording_id: z.string().nullable(),
});

export const ExportEnvelope = z.looseObject({
  export: z.looseObject({
    id: z.string(),
    format: z.string(),
    filename: z.string().min(1),
    sha256,
    bytes: z.number().int().positive(),
    download_url: z.string().startsWith("/"),
  }),
});
