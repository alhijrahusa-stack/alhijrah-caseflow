"""TOTP second factor (RFC 6238: HMAC-SHA1, 30 s step, 6 digits).

Secrets are encrypted at rest with a key derived from SECRET_KEY. A code is accepted for the
current step or one step either side (clock skew), and each step can be used only once per
user (replay protection via users.totp_last_step).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

STEP_SECONDS = 30
DIGITS = 6
ISSUER = "MURAILEX"


def _fernet() -> Fernet:
    key = get_settings().secret_key.get_secret_value()
    if len(key) < 32:
        raise RuntimeError("SECRET_KEY must be set to at least 32 characters.")
    derived = hashlib.sha256(b"murailex-totp-at-rest/1|" + key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def code_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def verify(secret: str, code: str, last_step: int | None, now: float | None = None) -> int | None:
    """Return the matched step if `code` is valid and unused, else None."""
    code = (code or "").strip().replace(" ", "")
    if len(code) != DIGITS or not code.isdigit():
        return None
    current = int((time.time() if now is None else now) // STEP_SECONDS)
    for step in (current - 1, current, current + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, account: str) -> str:
    return (
        f"otpauth://totp/{quote(ISSUER)}:{quote(account)}?secret={secret}&issuer={quote(ISSUER)}"
        f"&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )
