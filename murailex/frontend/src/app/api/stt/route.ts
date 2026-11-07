import { createHash } from "node:crypto";

import Groq, { toFile } from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

import { providerErrorCode } from "@/lib/server-provider-error";
import { authorizeVoiceRequest } from "@/lib/server-voice-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "whisper-large-v3";
const MAX_AUDIO_BYTES = 25_000_000;
// Whisper prompt is byte-bounded below 224 tokens (each BPE token covers at least one UTF-8 byte).
const MAX_PROMPT_UTF8_BYTES = 200;
const DEFAULT_DIALECT_CONTEXT = "لهجات عربية. كتابة الأسماء والمبالغ كما سُمعت، دون استنتاج.";

type AudioFormat = { mime: string; extension: string };

function detectAudio(bytes: Buffer): AudioFormat | null {
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") {
    return { mime: "audio/wav", extension: "wav" };
  }
  if (bytes.subarray(0, 4).toString("ascii") === "fLaC") {
    return { mime: "audio/flac", extension: "flac" };
  }
  if (bytes.subarray(0, 4).toString("ascii") === "OggS") {
    return { mime: "audio/ogg", extension: "ogg" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mime: "audio/webm", extension: "webm" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    return { mime: "audio/mp4", extension: "m4a" };
  }
  if (bytes.subarray(0, 3).toString("ascii") === "ID3" ||
      (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { mime: "audio/mpeg", extension: "mp3" };
  }
  return null;
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await authorizeVoiceRequest(request);
  if (denied) return denied;

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return jsonError("Groq transcription is not configured.", 503);

  // The entire inference path is in memory: no /tmp file and no writable volume.
  let file: FormDataEntryValue | null;
  let dialectPrompt: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    file = form.get("file");
    dialectPrompt = form.get("prompt");
  } catch {
    return jsonError("Invalid multipart upload.", 400);
  }
  if (!(file instanceof File)) return jsonError("An audio file is required.", 400);
  if (file.size === 0) return jsonError("Audio file is empty.", 422);
  if (file.size > MAX_AUDIO_BYTES) return jsonError("Maximum audio size is 25 MB.", 413);

  if (dialectPrompt !== null && typeof dialectPrompt !== "string") {
    return jsonError("Whisper context must be text.", 422);
  }
  const prompt = typeof dialectPrompt === "string" && dialectPrompt.trim()
    ? dialectPrompt.trim()
    : DEFAULT_DIALECT_CONTEXT;
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_UTF8_BYTES) {
    return jsonError("Whisper context exceeds 200 UTF-8 bytes (conservative 224-token limit).", 422);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return jsonError("Unable to read uploaded audio.", 400);
  }
  const detected = detectAudio(bytes);
  if (!detected) return jsonError("Unsupported audio container.", 415);

  try {
    const client = new Groq({ apiKey, timeout: 90_000, maxRetries: 0 });
    const inMemoryFile = await toFile(bytes, "recording." + detected.extension, { type: detected.mime });
    const result = await client.audio.transcriptions.create({
      model: MODEL,
      file: inMemoryFile,
      language: "ar",
      prompt,
      response_format: "json",
      temperature: 0,
    });
    if (typeof result.text !== "string" || !result.text.trim()) {
      return jsonError("The provider returned no transcription.", 502);
    }
    return NextResponse.json(
      {
        text: result.text,
        model: MODEL,
        source_sha256: createHash("sha256").update(bytes).digest("hex"),
        scope: "non-forensic-preview",
      },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    const providerStatus =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 502;
    console.error("MURAILEX_STT_FAILED", {
      providerStatus,
      model: MODEL,
      providerCode: providerErrorCode(error),
      category: error instanceof Error ? error.name : "Unknown",
    });
    if (providerStatus === 400 || providerStatus === 422) {
      return jsonError("The provider could not decode this audio. Re-export it as M4A, MP3 or WAV and retry.", 422);
    }
    if (providerStatus === 413) return jsonError("The audio exceeds the provider upload limit.", 413);
    if (providerStatus === 404) return jsonError("The configured transcription model is unavailable for this Groq account.", 503);
    if (providerStatus === 429) return jsonError("Groq rate limit reached. Retry after the quota resets.", 429);
    if (providerStatus === 401 || providerStatus === 403) return jsonError("Groq credentials were rejected.", 503);
    return jsonError("Transcription service unavailable.", 502);
  }
}
