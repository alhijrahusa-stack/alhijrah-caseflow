import { createHash } from "node:crypto";

import Groq, { toFile } from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

import { authorizeVoiceRequest } from "@/lib/server-voice-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 25_000_000;

function detectAudio(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE") {
    return { mime: "audio/wav", ext: "wav" };
  }
  if (bytes.subarray(0, 4).toString("ascii") === "fLaC") {
    return { mime: "audio/flac", ext: "flac" };
  }
  if (bytes.subarray(0, 4).toString("ascii") === "OggS") {
    return { mime: "audio/ogg", ext: "ogg" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mime: "audio/webm", ext: "webm" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    return { mime: "audio/mp4", ext: "m4a" };
  }
  if (
    bytes.subarray(0, 3).toString("ascii") === "ID3" ||
    (bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denial = await authorizeVoiceRequest(request);
  if (denial) return denial;

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Groq API key is not configured on this service." }, { status: 503 });
  }

  let file: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    file = form.get("file");
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An audio file is required." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio must be between 1 byte and 25 MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const format = detectAudio(bytes);
  if (!format) {
    return NextResponse.json({ error: "Unsupported audio format or invalid audio header." }, { status: 415 });
  }

  try {
    const client = new Groq({ apiKey, maxRetries: 0, timeout: 90000 });
    const upload = await toFile(bytes, "recording." + format.ext, { type: format.mime });
    const transcription = await client.audio.transcriptions.create({
      file: upload,
      model: "whisper-large-v3",
      language: "ar",
      response_format: "json",
      temperature: 0,
    });
    if (typeof transcription.text !== "string" || !transcription.text.trim()) {
      return NextResponse.json({ error: "The STT provider returned an empty transcript." }, { status: 502 });
    }
    return NextResponse.json(
      {
        text: transcription.text,
        model: "whisper-large-v3",
        source_sha256: createHash("sha256").update(bytes).digest("hex"),
        scope: "non-forensic-preview",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 502;
    console.error("MURAILEX_STT_FAILURE", { providerStatus: status, errorType: error instanceof Error ? error.name : "Unknown" });
    const exposedStatus = status === 429 ? 429 : status === 401 || status === 403 ? 503 : 502;
    const message = status === 429 ? "Groq rate limit exceeded." : "Groq transcription request failed.";
    return NextResponse.json({ error: message }, { status: exposedStatus });
  }
}
