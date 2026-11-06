# MURAILEX — optional VibeVoice research integration

## Exact scope

This integration adds /voice-studio to the existing MURAILEX UI and /api/vibevoice/* on the authenticated FastAPI backend. It does not replace MURAILEX's existing forensic ASR, verification, diarization, storage, audit logs, immutable transcript revisions, or evidence pipeline.

The two remote engines are independent:
- ASR: microsoft/VibeVoice-ASR (the non-streaming, multilingual model), served using Microsoft's vLLM plugin with the OpenAI-compatible /v1/chat/completions endpoint. The optional preview accepts audio uploads and returns the unaltered model transcript with speaker/timestamp fields when present. No invented word-level confidence or timestamps.
- Speech synthesis: microsoft/VibeVoice-Realtime-0.5B, served with Microsoft's Realtime WebSocket demo (/stream and /config). Its output is one-speaker, primarily English, 24 kHz signed 16-bit PCM. MURAILEX plays the chunks progressively in Web Audio and can save the complete stream as WAV.

These engines are not interchangeable. The 90-minute four-speaker VibeVoice-TTS model is a different checkpoint, and Microsoft disabled its original generation code. Do not claim Realtime-0.5B has the 90-minute / four-speaker capabilities. The uploaded voice-preset .pt files are not trained base-model weights.

## Infra prerequisite

Railway hosts the CPU frontend, API, worker, PostgreSQL and object storage. Railway's official guidance (https://railway.com/guides/ai-agent-workers) says GPU instances are not available. Host inference separately on a GPU-equipped server. Keep the two inference servers behind HTTPS/WSS gateways that enforce Authorization: Bearer tokens, TLS certificates, resource limits, access logs without user content, and private deployment controls. The Microsoft reference demos are not authenticated public gateways; do not expose them directly.

Reference implementations:
- https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-vllm-asr.md
- https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-realtime-0.5b.md

On an NVIDIA GPU host install the official source (do not copy the uploaded Python files into the MURAILEX CPU backend):

    git clone https://github.com/microsoft/VibeVoice.git
    cd VibeVoice
    pip install -e '.[streamingtts]'

For Realtime TTS, obtain the Hugging Face checkpoint and run the official demo:

    python demo/vibevoice_realtime_demo.py --model_path microsoft/VibeVoice-Realtime-0.5B

For ASR use the official vLLM GPU image and the VibeVoice vLLM launcher, following the upstream instructions:

    docker run -d --gpus all --name vibevoice-asr --ipc=host \
      -p 8000:8000 -v "$(pwd):/app" -w /app --entrypoint bash \
      vllm/vllm-openai:v0.14.1 \
      -c "python3 /app/vllm_plugin/scripts/start_server.py"

Verify the ASR endpoint GET /v1/models advertises the exact model identifier to be used (default: vibevoice). Verify the TTS endpoint GET /config returns a nonempty voice list. Voice preset files belong in the GPU repository's voices/streaming_model directory; the original demo uses this directory and refuses startup when no .pt presets are present.

## MURAILEX backend environment variables

Set these on the Railway backend API service only; no browser or public NEXT_PUBLIC variables:

    VIBEVOICE_EXTERNAL_PROCESSING_APPROVED=false
    VIBEVOICE_ASR_BASE_URL=https://secured-asr-gpu.example
    VIBEVOICE_ASR_API_KEY=<server-side bearer token>
    VIBEVOICE_ASR_MODEL=vibevoice
    VIBEVOICE_TTS_WS_URL=wss://secured-tts-gpu.example/stream
    VIBEVOICE_TTS_API_KEY=<server-side bearer token>

The example hosts and tokens above are documentation only; they are not active endpoints or values. The separate GPU reverse proxies must actually implement bearer validation. Do not enable the approval variable before reviewing the host's retention, security, confidentiality and legal-audio policy. Every individual upload or synthesis request also requires an explicit consent checkbox. In production the backend rejects non-TLS endpoints, credentials in URLs, unapproved external processing, missing bearer tokens, unsupported audio containers, and oversized audio. No model weights are bundled with the MURAILEX frontend or backend.

## Access and operational boundaries

- GET /api/vibevoice/status: authentication required; returns readiness based on actual remote probes; does not expose credentials.
- POST /api/vibevoice/asr: upload permission and CSRF required; multipart form fields file, context_info (optional), consent=true. Up to 48 MiB of verified WAV, FLAC, MP3, OGG, WebM, or MP4 audio. Returns model text and original structured segments, if valid.
- POST /api/vibevoice/speech: upload permission and CSRF required; JSON text, voice, cfg_scale, inference_steps, consent=true. Streams raw PCM16 frames. The frontend plays them and optionally assembles a WAV.
- Preview data are not persisted as recordings, evidence, provider runs, transcript revisions, or forensic conclusions. The SHA-256 in an ASR response identifies the submitted preview bytes, not a verified immutable evidence original.
- The official Realtime demo passes TTS text in a WebSocket URL query; the external GPU reverse proxy must avoid logging request URLs or other text. Do not process sensitive or privileged material until this exposure has been addressed and external policies approved.
- None of these features should change production forensic routing until a benchmark with human ground truth and the existing privacy and provider self-test gates are satisfied.

## Validation and release

1. Run backend tests under the existing MURAILEX CI (including tests/test_vibevoice.py) and frontend lint/typecheck/build.
2. Start the GPU endpoints securely and check both report ready in /api/vibevoice/status.
3. Confirm ASR preview results against a reference audio and compare text, speaker IDs and timestamps with the original recording.
4. Confirm streaming playback, Stop, WAV export, UI authentication, CSRF, denial without consent, and disconnected-GPU handling.
5. Deploy to production only after the entire existing MURAILEX suite passes and an actual GPU service is configured. The four existing unrelated Railway staged changes must be reviewed separately; do not indiscriminately accept them.

Production readiness and feature parity are NOT established by compiling this integration alone.
