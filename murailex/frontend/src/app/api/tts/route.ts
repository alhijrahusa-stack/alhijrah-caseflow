import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { NextRequest, NextResponse } from "next/server";

import { authorizeVoiceRequest } from "@/lib/server-voice-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE = "ar-EG-ShakirNeural";
const MAX_TEXT = 1000;
const MAX_MP3_BYTES = 8 * 1024 * 1024;

function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&apos;";
    }
  });
}

function isMp3(buffer: Buffer): boolean {
  return (
    buffer.subarray(0, 3).toString("ascii") === "ID3" ||
    (buffer.length > 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denial = await authorizeVoiceRequest(request);
  if (denial) return denial;

  let text: unknown;
  try {
    const body: unknown = await request.json();
    text = body && typeof body === "object" && "text" in body ? body.text : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) {
    return NextResponse.json({ error: "Text must contain between 1 and 1000 characters." }, { status: 422 });
  }

  const tts = new MsEdgeTTS({
    connectionTimeoutMs: 10000,
    synthesisTimeoutMs: 60000,
  });
  try {
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text.trim()));
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of audioStream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_MP3_BYTES) {
        audioStream.destroy();
        throw new Error("Audio output exceeds the configured safety limit.");
      }
      chunks.push(buffer);
    }
    if (!totalBytes) {
      throw new Error("The speech provider returned no audio.");
    }
    const mp3 = Buffer.concat(chunks, totalBytes);
    if (!isMp3(mp3)) {
      throw new Error("The speech provider returned invalid MP3 audio.");
    }

    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": 'attachment; filename="audio.mp3"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Voice-Engine": "edge-read-aloud",
      },
    });
  } catch (error) {
    console.error("MURAILEX_TTS_FAILURE", { errorType: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ error: "Speech synthesis is temporarily unavailable." }, { status: 502 });
  } finally {
    tts.close();
  }
}
