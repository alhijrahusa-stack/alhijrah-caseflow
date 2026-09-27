"""Google Cloud Speech-to-Text V2, Chirp 3, via BatchRecognize with a GCS working copy.

REST: POST https://{location}-speech.googleapis.com/v2/projects/{p}/locations/{l}/recognizers/_:batchRecognize
"""
from __future__ import annotations

import json
import os
import urllib.parse
from typing import Any

from ..config import get_settings
from . import privacy
from .base import AsrAdapter, DataPolicyBlocked, NotConfigured, Pending, ProviderError, ProviderInfo
from .http import request

SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


def google_token() -> tuple[str, str]:
    s = get_settings()
    if not s.google_credentials_json or not s.google_credentials_json.get_secret_value():
        raise NotConfigured("google")
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    info = json.loads(s.google_credentials_json.get_secret_value())
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    try:
        creds.refresh(Request())
    except Exception as exc:
        raise ProviderError(f"Google authentication failed: {type(exc).__name__}", retryable=False) from exc
    project = s.google_project_id or info.get("project_id")
    if not project:
        raise ProviderError("Google project id is not configured", retryable=False)
    return creds.token, project


def _endpoint(location: str) -> str:
    return "https://speech.googleapis.com" if location == "global" else f"https://{location}-speech.googleapis.com"


def _seconds(value: str | None) -> int:
    if not value:
        return 0
    return int(round(float(value.rstrip("s")) * 1000))


class GoogleChirp3(AsrAdapter):
    name = "google_chirp3"
    asynchronous = True

    def __init__(self, language_code: str):
        self.language_code = language_code

    def parameters(self) -> dict[str, Any]:
        s = get_settings()
        return {
            "model": s.google_stt_model,
            "languageCodes": [self.language_code],
            "location": s.google_stt_location,
            "features": {"enableWordTimeOffsets": True},
        }

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        s = get_settings()
        has_config = bool(s.google_credentials_json and s.google_credentials_json.get_secret_value() and s.google_stt_gcs_bucket)
        return ProviderInfo(
            self.name,
            s.google_stt_model,
            "primary_asr",
            has_config and privacy.approved(self.name),
            {**self.parameters(), "privacy_gate": privacy.status(self.name)},
        )

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        s = get_settings()
        if not s.google_stt_gcs_bucket:
            raise NotConfigured(self.name)
        if not privacy.approved(self.name):
            raise DataPolicyBlocked(self.name)
        token, project = google_token()
        auth = {"Authorization": f"Bearer {token}"}
        obj = f"murailex-working/{context['recording_id']}/{os.path.basename(audio_path)}"
        with open(audio_path, "rb") as fh:
            request(
                "POST",
                f"https://storage.googleapis.com/upload/storage/v1/b/{s.google_stt_gcs_bucket}/o?uploadType=media&name={urllib.parse.quote(obj, safe='')}",
                self.name,
                timeout=900,
                headers={**auth, "Content-Type": "audio/flac"},
                content=fh.read(),
            )
        uri = f"gs://{s.google_stt_gcs_bucket}/{obj}"
        p = self.parameters()
        body = {
            "config": {
                "autoDecodingConfig": {},
                "model": p["model"],
                "languageCodes": p["languageCodes"],
                "features": p["features"],
            },
            "files": [{"uri": uri}],
            "recognitionOutputConfig": {"inlineResponseConfig": {}},
        }
        loc = s.google_stt_location
        resp = request(
            "POST",
            f"{_endpoint(loc)}/v2/projects/{project}/locations/{loc}/recognizers/_:batchRecognize",
            self.name,
            headers=auth,
            json=body,
        )
        name = resp.json().get("name")
        if not name:
            raise ProviderError("Google batchRecognize returned no operation name", retryable=True)
        return json.dumps({"operation": name, "gcs_object": obj})

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        s = get_settings()
        ref = json.loads(remote_id)
        token, _ = google_token()
        auth = {"Authorization": f"Bearer {token}"}
        op = request("GET", f"{_endpoint(s.google_stt_location)}/v2/{ref['operation']}", self.name, headers=auth).json()
        if not op.get("done"):
            return Pending("processing")
        if op.get("error"):
            raise ProviderError(f"Google operation error: {op['error'].get('message')}", retryable=False)
        try:
            request(
                "DELETE",
                f"https://storage.googleapis.com/storage/v1/b/{s.google_stt_gcs_bucket}/o/{urllib.parse.quote(ref['gcs_object'], safe='')}",
                self.name,
                headers=auth,
            )
        except ProviderError:
            pass
        return op

    def normalize(self, raw: Any) -> dict[str, Any]:
        tokens = []
        errors = []
        results = (raw.get("response") or {}).get("results") or {}
        for file_result in results.values():
            if file_result.get("error"):
                errors.append(file_result["error"].get("message"))
            transcript = ((file_result.get("inlineResult") or {}).get("transcript")) or file_result.get("transcript") or {}
            for res in transcript.get("results") or []:
                alts = res.get("alternatives") or []
                if not alts:
                    continue
                for w in alts[0].get("words") or []:
                    tokens.append(
                        {
                            "text": w.get("word", ""),
                            "start_ms": _seconds(w.get("startOffset")),
                            "end_ms": _seconds(w.get("endOffset")),
                            "confidence": None,
                            "provider_confidence_raw": w.get("confidence"),
                            "confidence_semantics": "not_reliable_for_chirp3",
                            "speaker": None,
                        }
                    )
        if errors and not tokens:
            raise ProviderError(f"Google file error: {errors[0]}", retryable=False)
        tokens.sort(key=lambda t: (t["start_ms"], t["end_ms"]))
        return {"tokens": tokens}
