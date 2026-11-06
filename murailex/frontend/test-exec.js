/* Real provider smoke: Microsoft Edge neural MP3 -> Groq Whisper Large V3.
 * No mocked calls, synthesized placeholder audio, or user recordings.
 * Run with GROQ_API_KEY present. Writes test-audio.mp3 in the temp directory.
 */
const { createHash } = require("node:crypto");
const { writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { performance } = require("node:perf_hooks");

async function main() {
  if (!process.env.GROQ_API_KEY?.trim()) {
    throw new Error("[BLOCKER: GROQ_API_KEY unavailable to the test runtime]");
  }
  const [{ MsEdgeTTS, OUTPUT_FORMAT }, { default: Groq, toFile }] = await Promise.all([
    import("msedge-tts"),
    import("groq-sdk"),
  ]);
  const text = "مرحباً بكم في تطبيق مورايلكس.";
  const started = performance.now();
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10000, synthesisTimeoutMs: 60000 });
  let mp3;
  try {
    await tts.setMetadata("ar-EG-ShakirNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.from(chunk));
    }
    mp3 = Buffer.concat(chunks);
  } finally {
    tts.close();
  }
  if (mp3.length <= 100 || !(mp3.subarray(0, 3).toString("ascii") === "ID3" ||
      (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0))) {
    throw new Error("[BLOCKER: Edge produced no valid MP3]");
  }
  const location = join(tmpdir(), "test-audio.mp3");
  await writeFile(location, mp3);
  console.log("TTS_PROVIDER=Microsoft Edge Neural");
  console.log("TTS_VOICE=ar-EG-ShakirNeural");
  console.log("TTS_MP3_PATH=" + location);
  console.log("TTS_BYTES=" + mp3.length);
  console.log("TTS_SHA256=" + createHash("sha256").update(mp3).digest("hex"));
  console.log("TTS_ELAPSED_MS=" + Math.round(performance.now() - started));
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 90000 });
  const transcription = await groq.audio.transcriptions.create({
    file: await toFile(mp3, "test-audio.mp3", { type: "audio/mpeg" }),
    model: "whisper-large-v3",
    language: "ar",
    response_format: "json",
    temperature: 0,
  });
  if (!transcription.text?.trim()) {
    throw new Error("[BLOCKER: Groq returned an empty transcript]");
  }
  console.log("STT_MODEL=whisper-large-v3");
  console.log("STT_TRANSCRIPT=" + transcription.text);
  console.log("E2E_RESULT=SUCCESS");
  console.log("TOTAL_ELAPSED_MS=" + Math.round(performance.now() - started));
}

main().catch((error) => {
  console.error("E2E_RESULT=FAILED");
  console.error("ERROR_TYPE=" + (error instanceof Error ? error.name : "Unknown"));
  console.error("ERROR_MESSAGE=" + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
