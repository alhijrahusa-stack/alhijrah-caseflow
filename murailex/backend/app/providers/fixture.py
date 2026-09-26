"""Deterministic fixture adapters — AUTOMATED TESTS ONLY.

They are reachable only when ENVIRONMENT=test and TEST_FIXTURE_PROVIDERS=true. The
registry refuses them in every other environment, and every run they produce is
labelled provider="fixture:*" so it can never be mistaken for a real engine.
"""
from __future__ import annotations

import json
import os
from typing import Any

from .base import AsrAdapter, DiarizationAdapter, Pending, ProviderInfo

FIXTURE_DIR = os.environ.get("MURAILEX_FIXTURE_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures"))


def _load(name: str) -> Any:
    with open(os.path.join(FIXTURE_DIR, name), encoding="utf-8") as fh:
        return json.load(fh)


class FixtureAsr(AsrAdapter):
    asynchronous = True

    def __init__(self, name: str, fixture: str, role: str = "primary_asr"):
        self.name = f"fixture:{name}"
        self.fixture = fixture
        self.role = role
        self.polls: dict[str, int] = {}

    def info(self) -> ProviderInfo:
        return ProviderInfo(self.name, "fixture", self.role, True, {"fixture": self.fixture})

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        return f"{self.fixture}|{context.get('window_start_ms', 0)}|{context.get('window_end_ms', 0)}"

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        n = self.polls.get(remote_id, 0)
        self.polls[remote_id] = n + 1
        if n == 0:
            return Pending("queued")
        fixture, ws, we = remote_id.split("|")
        data = _load(fixture)
        ws_i, we_i = int(ws), int(we)
        if we_i > 0:  # windowed verification call: return words inside the window, re-based to 0
            data = {
                "words": [
                    {**w, "start": w["start"] - ws_i, "end": w["end"] - ws_i}
                    for w in data["words"]
                    if w["end"] > ws_i and w["start"] < we_i
                ]
            }
        return data

    def normalize(self, raw: Any) -> dict[str, Any]:
        return {
            "tokens": [
                {"text": w["text"], "start_ms": w["start"], "end_ms": w["end"], "confidence": w.get("confidence"), "speaker": w.get("speaker")}
                for w in raw.get("words", [])
            ]
        }


class FixtureDiarization(DiarizationAdapter):
    asynchronous = True

    def __init__(self, fixture: str):
        self.name = "fixture:diarization"
        self.fixture = fixture

    def info(self) -> ProviderInfo:
        return ProviderInfo(self.name, "fixture", "diarization", True, {"fixture": self.fixture})

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        return self.fixture

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        return _load(remote_id)

    def normalize(self, raw: Any) -> dict[str, Any]:
        return {"turns": [{"speaker": t["speaker"], "start_ms": t["start"], "end_ms": t["end"], "confidence": None} for t in raw["turns"]]}
