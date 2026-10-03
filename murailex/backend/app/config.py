from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server-side configuration. Secrets are SecretStr and never logged."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "production"
    database_url: str = "postgresql+psycopg://murailex:murailex@localhost:5432/murailex"
    app_base_url: str = "http://localhost:3000"
    secret_key: SecretStr = SecretStr("")
    session_ttl_hours: int = 12
    cookie_secure: bool = True
    signed_url_ttl_seconds: int = 300
    max_upload_bytes: int = 4 * 1024 * 1024 * 1024
    upload_chunk_bytes: int = 8 * 1024 * 1024

    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: SecretStr | None = None

    # Evidence storage. "s3" (production) or "filesystem" (single-machine local use only:
    # private directory, write-once objects, no network exposure).
    storage_backend: str = "s3"
    local_storage_dir: str = "./murailex-data/objects"

    # S3-compatible private storage
    s3_endpoint_url: str | None = None
    s3_region: str = "us-east-1"
    s3_access_key_id: SecretStr | None = None
    s3_secret_access_key: SecretStr | None = None
    s3_bucket: str = "murailex-evidence"
    s3_server_side_encryption: str | None = "AES256"  # empty string disables SSE header
    s3_object_lock_mode: str | None = None  # GOVERNANCE | COMPLIANCE
    s3_object_lock_days: int = 0

    # Providers — absent key means NOT CONFIGURED
    assemblyai_api_key: SecretStr | None = None
    assemblyai_base_url: str = "https://api.assemblyai.com"
    assemblyai_speech_model: str = "universal-3-5-pro"

    google_credentials_json: SecretStr | None = None  # service-account JSON
    google_project_id: str | None = None
    google_stt_location: str = "us"
    google_stt_model: str = "chirp_3"
    google_stt_language_codes: str = "ar-YE"
    google_stt_gcs_bucket: str | None = None
    google_translate_location: str = "global"
    # On-device translation (ENVIRONMENT=local): CTranslate2 conversions of OPUS-MT models,
    # one directory per direction (ar-en, en-ar) under this path. Empty = not configured.
    local_mt_dir: str = ""

    pyannote_api_key: SecretStr | None = None
    pyannote_base_url: str = "https://api.pyannote.ai/v1"
    pyannote_model: str = "precision-3"

    openai_api_key: SecretStr | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_transcribe_model: str = "gpt-transcribe"

    deepgram_api_key: SecretStr | None = None
    deepgram_base_url: str = "https://api.deepgram.com/v1"
    deepgram_model: str = "nova-3"
    deepgram_language: str = "ar"

    # Legal-audio privacy gates are fail-closed. Set true only after the actual account/project
    # controls and contractual data policy have been reviewed for the intended legal recordings.
    assemblyai_legal_audio_approved: bool = False
    google_legal_audio_approved: bool = False
    deepgram_legal_audio_approved: bool = False
    openai_legal_audio_approved: bool = False
    pyannote_legal_audio_approved: bool = False

    # Production routing is fail-closed until a real human-ground-truth benchmark has selected
    # the exact provider/model/locale matrix. Never set this merely to make processing start.
    benchmark_routing_approved: bool = False
    benchmark_dataset_version: str | None = None
    benchmark_held_out_run_id: str | None = None

    # On-device ASR (ENVIRONMENT=local only). large-v3 is the most accurate Whisper checkpoint;
    # the verifier is a different checkpoint so disputed regions get independent evidence.
    local_asr_model: str = "large-v3"
    local_verify_model: str = "medium"
    local_asr_compute_type: str = "int8"
    local_asr_threads: int = 0
    local_asr_beam_size: int = 5
    # Long-form decoding: ~10 min windows split at a pause near each target point when one
    # exists within ±90 s, decoded with 15 s of overlap on each side, checkpointed per window.
    local_asr_window_ms: int = 600_000
    local_asr_window_search_ms: int = 90_000
    local_asr_window_overlap_ms: int = 15_000

    # Ed25519 key used to sign evidence package manifests (generated once if missing).
    evidence_signing_key_path: str | None = None

    # Longest recording accepted for transcription (seconds). Enforced once, at ingestion.
    max_recording_duration_seconds: int = 7200

    provider_poll_seconds: float = 5.0
    provider_retry_base_seconds: float = 5.0
    provider_timeout_seconds: float = 6 * 3600
    context_padding_ms: int = 3000
    low_confidence_threshold: float = 0.6
    worker_lease_seconds: int = 120
    login_max_attempts: int = 8
    login_window_seconds: int = 900
    rate_limit_per_minute: int = 600

    test_fixture_providers: bool = Field(default=False, description="Automated tests only.")

    def language_codes(self) -> list[str]:
        return [c.strip() for c in self.google_stt_language_codes.split(",") if c.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
