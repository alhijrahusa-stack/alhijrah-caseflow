"""Google Cloud Translation v3 (NMT) — used only for the separate derived translation document."""
from __future__ import annotations

from ..config import get_settings
from .base import ProviderError
from .google_chirp import google_token
from .http import request

MODEL = "general/nmt"


def configured() -> bool:
    s = get_settings()
    return bool(s.google_credentials_json and s.google_credentials_json.get_secret_value())


def translate_batch(texts: list[str], source: str, target: str) -> tuple[list[str], dict]:
    if not texts:
        return [], {}
    token, project = google_token()
    loc = get_settings().google_translate_location
    body = {
        "contents": texts,
        "mimeType": "text/plain",
        "sourceLanguageCode": source,
        "targetLanguageCode": target,
        "model": f"projects/{project}/locations/{loc}/models/{MODEL}",
    }
    resp = request(
        "POST",
        f"https://translation.googleapis.com/v3/projects/{project}/locations/{loc}:translateText",
        "google_translate",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
    ).json()
    out = [t.get("translatedText", "") for t in resp.get("translations", [])]
    if len(out) != len(texts):
        raise ProviderError("Google Translation returned a mismatched number of segments", retryable=True)
    return out, resp
