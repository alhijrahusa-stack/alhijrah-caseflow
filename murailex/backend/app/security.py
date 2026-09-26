from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AuthSession, LoginAttempt, Recording, RecordingAccess, User

SESSION_COOKIE = "murailex_session"
CSRF_COOKIE = "murailex_csrf"
CSRF_HEADER = "x-csrf-token"
ROLES = ("admin", "transcriber", "reviewer", "viewer")

_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("murailex-timing-equaliser")


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters.")
    return _hasher.hash(password)


def verify_password(stored: str, password: str) -> bool:
    try:
        return _hasher.verify(stored, password)
    except (VerificationError, InvalidHashError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _secret() -> bytes:
    key = get_settings().secret_key.get_secret_value()
    if len(key) < 32:
        raise RuntimeError("SECRET_KEY must be set to at least 32 characters.")
    return key.encode()


def throttle_key(email: str, ip: str) -> str:
    return hashlib.sha256(f"{email.lower()}|{ip}".encode()).hexdigest()


def login_allowed(db: Session, key: str) -> bool:
    s = get_settings()
    since = datetime.now(timezone.utc) - timedelta(seconds=s.login_window_seconds)
    db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < since))
    count = db.execute(
        select(func.count()).select_from(LoginAttempt).where(LoginAttempt.key == key, LoginAttempt.created_at >= since)
    ).scalar_one()
    return count < s.login_max_attempts


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.execute(select(User).where(func.lower(User.email) == email.lower())).scalar_one_or_none()
    if user is None:
        verify_password(_DUMMY_HASH, password)
        return None
    if not verify_password(user.password_hash, password) or not user.is_active:
        return None
    return user


def create_session(db: Session, user: User) -> tuple[str, AuthSession]:
    token = secrets.token_urlsafe(32)
    session = AuthSession(
        token_hash=_token_hash(token),
        csrf_token=secrets.token_urlsafe(24),
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=get_settings().session_ttl_hours),
    )
    db.add(session)
    db.flush()
    return token, session


def _load_session(db: Session, token: str | None) -> tuple[AuthSession, User] | None:
    if not token:
        return None
    row = db.execute(
        select(AuthSession, User)
        .join(User, User.id == AuthSession.user_id)
        .where(AuthSession.token_hash == _token_hash(token))
    ).first()
    if row is None:
        return None
    session, user = row
    if session.revoked_at is not None or session.expires_at <= datetime.now(timezone.utc) or not user.is_active:
        return None
    return session, user


class Principal:
    def __init__(self, user: User, session: AuthSession):
        self.user = user
        self.session = session

    @property
    def is_admin(self) -> bool:
        return self.user.role == "admin"


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    loaded = _load_session(db, request.cookies.get(SESSION_COOKIE))
    if loaded is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required.")
    session, user = loaded
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        sent = request.headers.get(CSRF_HEADER, "")
        if not sent or not hmac.compare_digest(sent, session.csrf_token):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF validation failed.")
    return Principal(user, session)


def require_admin(p: Principal = Depends(current_principal)) -> Principal:
    if not p.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator role required.")
    return p


CAPABILITIES = {
    "admin": {"upload", "view", "review", "lock", "export", "translate", "manage"},
    "transcriber": {"upload", "view", "review", "lock", "export", "translate"},
    "reviewer": {"view", "review", "export"},
    "viewer": {"view", "export"},
}


def require_capability(p: Principal, capability: str) -> None:
    if capability not in CAPABILITIES.get(p.user.role, set()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Your role cannot {capability}.")


def load_recording(db: Session, p: Principal, recording_id: uuid.UUID, capability: str = "view") -> Recording:
    """Return the recording only if the principal may exercise `capability` on it.

    Unreachable recordings report 404 so a response never confirms an id exists.
    """
    require_capability(p, capability)
    rec = db.get(Recording, recording_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found.")
    if p.is_admin or rec.owner_id == p.user.id:
        return rec
    grant = db.execute(
        select(RecordingAccess).where(RecordingAccess.recording_id == rec.id, RecordingAccess.user_id == p.user.id)
    ).scalar_one_or_none()
    if grant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found.")
    if capability in ("view", "export") or (capability == "review" and grant.permission == "review"):
        return rec
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient access to this recording.")


# Short-lived signed media URLs -------------------------------------------------

def sign_media(recording_id: uuid.UUID, variant: str, user_id: uuid.UUID, ttl: int | None = None) -> str:
    exp = int(time.time()) + (ttl or get_settings().signed_url_ttl_seconds)
    msg = f"{recording_id}|{variant}|{user_id}|{exp}".encode()
    sig = base64.urlsafe_b64encode(hmac.new(_secret(), msg, hashlib.sha256).digest()).decode().rstrip("=")
    return f"exp={exp}&sig={sig}"


def verify_media(recording_id: uuid.UUID, variant: str, user_id: uuid.UUID, exp: int, sig: str) -> bool:
    if exp < int(time.time()):
        return False
    msg = f"{recording_id}|{variant}|{user_id}|{exp}".encode()
    expected = base64.urlsafe_b64encode(hmac.new(_secret(), msg, hashlib.sha256).digest()).decode().rstrip("=")
    return hmac.compare_digest(expected, sig)
