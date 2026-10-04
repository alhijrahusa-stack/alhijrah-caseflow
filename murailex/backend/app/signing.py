"""Ed25519 signing of evidence package manifests.

The private key is loaded from EVIDENCE_SIGNING_KEY_PATH (PEM, PKCS#8). If the file does not
exist it is generated once with mode 0600. The key never leaves the server; packages carry
the public key and its SHA-256 fingerprint so any recipient can verify offline:

    openssl pkeyutl -verify -pubin -inkey public-key.pem -rawin -in manifest.json -sigfile manifest.sig
"""
from __future__ import annotations

import hashlib
import os
import tempfile
import threading

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .config import get_settings

_LOCK = threading.Lock()
_KEY: Ed25519PrivateKey | None = None


def _key_path() -> str:
    path = get_settings().evidence_signing_key_path
    if path:
        return path
    root = os.environ.get("MURAILEX_WORK_DIR", os.path.join(tempfile.gettempdir(), "murailex-work"))
    return os.path.join(root, "signing", "ed25519-private.pem")


def private_key() -> Ed25519PrivateKey:
    global _KEY
    with _LOCK:
        if _KEY is None:
            secret = get_settings().evidence_signing_key_pem
            if secret is not None and secret.get_secret_value().strip():
                loaded = serialization.load_pem_private_key(secret.get_secret_value().strip().encode(), password=None)
                if not isinstance(loaded, Ed25519PrivateKey):
                    raise RuntimeError("Evidence signing key is not an Ed25519 key.")
                _KEY = loaded
                return _KEY
            path = _key_path()
            if not os.path.exists(path):
                os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
                key = Ed25519PrivateKey.generate()
                pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as fh:
                    fh.write(pem)
            with open(path, "rb") as fh:
                loaded = serialization.load_pem_private_key(fh.read(), password=None)
            if not isinstance(loaded, Ed25519PrivateKey):
                raise RuntimeError("Evidence signing key is not an Ed25519 key.")
            _KEY = loaded
        return _KEY


def public_key_pem() -> bytes:
    return private_key().public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)


def public_key_fingerprint() -> str:
    raw = private_key().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return hashlib.sha256(raw).hexdigest()


def sign(data: bytes) -> bytes:
    return private_key().sign(data)


def verify(public_pem: bytes, data: bytes, signature: bytes) -> bool:
    key = serialization.load_pem_public_key(public_pem)
    if not isinstance(key, Ed25519PublicKey):
        return False
    try:
        key.verify(signature, data)
        return True
    except Exception:  # noqa: BLE001 - InvalidSignature
        return False
