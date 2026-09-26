from __future__ import annotations

import httpx

from .base import ProviderError, classify_http


def request(method: str, url: str, provider: str, *, timeout: float = 120.0, **kwargs) -> httpx.Response:
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout, connect=20.0)) as c:
            resp = c.request(method, url, **kwargs)
    except httpx.TimeoutException as exc:
        raise ProviderError(f"{provider} timed out: {type(exc).__name__}", retryable=True) from exc
    except httpx.HTTPError as exc:
        raise ProviderError(f"{provider} network error: {type(exc).__name__}", retryable=True) from exc
    if resp.status_code >= 400:
        raise classify_http(resp.status_code, resp.text, provider)
    return resp
