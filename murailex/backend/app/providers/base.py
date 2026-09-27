from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class ProviderError(Exception):
    """Provider failure. `retryable` distinguishes transient faults from permanent ones."""

    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class NotConfigured(ProviderError):
    def __init__(self, provider: str):
        super().__init__(f"{provider} is NOT CONFIGURED", retryable=False)


class DataPolicyBlocked(ProviderError):
    """Fail-closed block before legal audio can leave MURAILEX."""

    def __init__(self, provider: str):
        super().__init__(f"{provider}: BLOCKED BY DATA POLICY", retryable=False)


@dataclass
class Pending:
    """Returned by fetch() while a remote job is still running."""

    status: str = "processing"


@dataclass
class ProviderInfo:
    name: str
    model: str
    role: str
    configured: bool
    parameters: dict[str, Any] = field(default_factory=dict)


class AsrAdapter:
    """Replaceable ASR adapter.

    Asynchronous providers implement submit()/fetch(); synchronous providers implement
    transcribe(). The orchestrator persists remote job ids so a restart resumes polling
    instead of resubmitting.
    """

    name = "base"
    asynchronous = False

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        raise NotImplementedError

    def configured(self) -> bool:
        return self.info().configured

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        raise NotImplementedError

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        raise NotImplementedError

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        raise NotImplementedError

    def normalize(self, raw: Any) -> dict[str, Any]:
        """Map the raw provider response to {"tokens": [...]} without altering any text."""
        raise NotImplementedError


class DiarizationAdapter(AsrAdapter):
    def normalize(self, raw: Any) -> dict[str, Any]:
        """Return {"turns": [{"speaker", "start_ms", "end_ms", "confidence"}]}."""
        raise NotImplementedError


def classify_http(status: int, body: str, provider: str) -> ProviderError:
    snippet = body[:300]
    if status in (401, 403):
        return ProviderError(f"{provider} rejected credentials (HTTP {status}).", retryable=False)
    if status in (400, 404, 413, 415, 422):
        return ProviderError(f"{provider} rejected the request (HTTP {status}): {snippet}", retryable=False)
    return ProviderError(f"{provider} temporary failure (HTTP {status}): {snippet}", retryable=True)
