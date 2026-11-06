# MURAILEX Groq voice pipeline — release and validation

This is a separate, explicitly opt-in voice preview. It does not modify MURAILEX source recordings, immutable evidence revisions, speaker claims, or the forensic processing pipeline.

## Live API

The existing private Railway backend service owns \`GROQ_API_KEY\`. It MUST NOT be copied into \`NEXT_PUBLIC_*\`, JavaScript, localStorage, or any browser route. Railway frontend uses the existing authenticated \`/api/*\` rewrite.

- \`GET /api/voice-ai/status\`: authenticated capability \`view\`, reports configured key presence, supported models and voices; \`engine_verified=false\` means key presence is not a real inference check.
- \`POST /api/voice-ai/stt\`: authenticated capability \`upload\`, CSRF header, multipart file, language = ar/en/auto, consent=true; 25 MiB limit. Uses Groq \`whisper-large-v3\` with \`verbose_json\` and segment + word timestamps. Returns provider source text/timestamps unchanged, source SHA256 and inference time.
- \`POST /api/voice-ai/tts\`: authenticated capability \`upload\`, CSRF header, JSON \`{text,language,voice,consent:true}\`. Max 200 chars. Returns *actual provider WAV* rather than browser-synthesized speech. Arabic = \`canopylabs/orpheus-arabic-saudi\`, English = \`canopylabs/orpheus-v1-english\`. Voices are explicit allowlists read from the Groq Orpheus documentation.

## Evidence

1. GitHub actions on the exact merged commit must show SUCCESS for backend Ruff + Mypy + Pytest, frontend ESLint + TypeScript + Next build, and Playwright E2E. These **do not prove real provider inference**.
2. On API startup with \`GROQ_API_KEY\` configured, \`app.voice_ai_smoke.run_groq_smoke()\` executes in a daemon thread once per process. It requests real Arabic WAV audio from Orpheus then sends that actual WAV to Whisper large-v3. It logs results with prefix \`GROQ_REAL_SMOKE\`: HTTP status on failure, bytes + SHA256 and timings on success; no key and no transcription content.
3. The credential-bearing local-to-production smoke script \`node murailex/scripts/test-stt.js\` performs a normal login, reads the **existing sample.wav fixture**, uploads it through the production endpoint, verifies a real transcript and SHA256, and prints the actual transcript. Use a dedicated testing account. Do not share credentials or log session cookies. The script has no fallback or mocks.
4. A real user must also exercise the Arabic and English TTS buttons in the deployed /voice-studio page, listen to output, and download WAV. No UI build result proves that step.

## Terms, cost and limits

This uses Groq's **API free-tier limits**, not unlimited free AI. Exact quotas depend on the Groq organization, account and billing plan. Exceeding quota returns HTTP 429. The official docs list free tier STT upload maximum 25MB; Orpheus TTS has a 200-character input cap. The service's existing Railway CPU resources and storage still incur whatever Railway charges the account plan requires. Groq's earlier PlayAI TTS models were deprecated; Orpheus is the current documented replacement.

- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/text-to-speech/orpheus
- https://console.groq.com/docs/rate-limits

Do not claim model output is court-ready or infer a speaker's real identity based solely on a model's output.
