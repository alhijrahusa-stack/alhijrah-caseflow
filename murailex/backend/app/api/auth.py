from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import EmailStr, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .. import audit, mfa
from ..config import get_settings
from ..db import get_db
from ..models import AuthSession, LoginAttempt, User
from ..security import (
    CSRF_COOKIE,
    ROLES,
    SESSION_COOKIE,
    Principal,
    authenticate,
    create_session,
    current_principal,
    hash_password,
    login_allowed,
    require_admin,
    throttle_key,
    verify_password,
)
from .common import parse_uuid, user_out
from .strict import StrictIn

router = APIRouter(prefix="/api")


class LoginIn(StrictIn):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=512)
    otp: str | None = Field(default=None, max_length=12)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def _fail(db: Session, key: str, request: Request, email: str, reason: str) -> None:
    db.add(LoginAttempt(key=key))
    audit.record(db, "login_failed", actor_label=email.lower(), details={"ip": client_ip(request), "reason": reason})
    db.commit()


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    key = throttle_key(body.email, client_ip(request))
    if not login_allowed(db, key):
        db.commit()
        raise HTTPException(429, "Too many sign-in attempts. Try again later.")
    user = authenticate(db, body.email, body.password)
    if user is None:
        _fail(db, key, request, body.email, "password")
        raise HTTPException(401, "Invalid email or password.")
    mfa_verified = False
    if user.mfa_enabled_at is not None:
        if not body.otp:
            db.commit()
            return JSONResponse(
                status_code=401,
                content={"detail": {"code": "mfa_required", "message": "Enter the 6-digit code from your authenticator app."}},
            )
        secret = mfa.decrypt(user.totp_secret_enc or "")
        step = mfa.verify(secret, body.otp, user.totp_last_step) if secret else None
        if step is None:
            _fail(db, key, request, body.email, "otp")
            raise HTTPException(401, "Invalid or already used authentication code.")
        user.totp_last_step = step
        mfa_verified = True
    token, session = create_session(
        db, user, ip=client_ip(request), user_agent=request.headers.get("user-agent"), mfa_verified=mfa_verified
    )
    audit.record(db, "login", actor=user, details={"ip": client_ip(request), "mfa": mfa_verified})
    db.commit()
    s = get_settings()
    max_age = s.session_ttl_hours * 3600
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure, samesite="lax", path="/")
    response.set_cookie(CSRF_COOKIE, session.csrf_token, max_age=max_age, httponly=False, secure=s.cookie_secure, samesite="strict", path="/")
    return {"user": user_out(user), "csrf_token": session.csrf_token}


@router.post("/auth/logout")
def logout(response: Response, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sess = db.merge(p.session)
    sess.revoked_at = datetime.now(timezone.utc)
    audit.record(db, "logout", actor=p.user)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(p: Principal = Depends(current_principal)):
    return {"user": user_out(p.user), "csrf_token": p.session.csrf_token}


class PasswordIn(StrictIn):
    current_password: str
    new_password: str = Field(min_length=12, max_length=512)


@router.post("/auth/password")
def change_password(body: PasswordIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, p.user.id)
    assert user is not None
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(400, "Current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    revoked = _revoke_other_sessions(db, user.id, p.session.id)
    audit.record(db, "password_changed", actor=user, details={"other_sessions_revoked": revoked})
    db.commit()
    return {"ok": True, "other_sessions_revoked": revoked}


# ---- sessions --------------------------------------------------------------------------


def _revoke_other_sessions(db: Session, user_id, keep_id) -> int:
    result = db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.id != keep_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    return int(result.rowcount or 0)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@router.get("/auth/sessions")
def list_sessions(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(AuthSession)
        .where(AuthSession.user_id == p.user.id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > now)
        .order_by(AuthSession.created_at.desc())
    ).scalars()
    return {
        "sessions": [
            {
                "id": str(r.id),
                "current": r.id == p.session.id,
                "created_at": _iso(r.created_at),
                "last_seen_at": _iso(r.last_seen_at),
                "expires_at": _iso(r.expires_at),
                "ip": r.ip,
                "user_agent": r.user_agent,
                "mfa_verified": r.mfa_verified,
            }
            for r in rows
        ]
    }


@router.post("/auth/sessions/{session_id}/revoke")
def revoke_session(session_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    row = db.get(AuthSession, parse_uuid(session_id))
    if row is None or row.user_id != p.user.id:
        raise HTTPException(404, "Not found.")
    if row.id == p.session.id:
        raise HTTPException(409, "Use sign out to end the current session.")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        audit.record(db, "session_revoked", actor=p.user, details={"session_id": str(row.id)})
    db.commit()
    return {"ok": True}


@router.post("/auth/sessions/revoke-others")
def revoke_others(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    revoked = _revoke_other_sessions(db, p.user.id, p.session.id)
    audit.record(db, "sessions_revoked", actor=p.user, details={"count": revoked})
    db.commit()
    return {"revoked": revoked}


# ---- multi-factor authentication (TOTP) ------------------------------------------------


class MfaCodeIn(StrictIn):
    code: str = Field(min_length=6, max_length=12)


class MfaDisableIn(StrictIn):
    password: str = Field(min_length=1, max_length=512)
    code: str = Field(min_length=6, max_length=12)


@router.get("/auth/mfa")
def mfa_status(p: Principal = Depends(current_principal)):
    return {"enabled": p.user.mfa_enabled_at is not None, "enabled_at": _iso(p.user.mfa_enabled_at)}


@router.post("/auth/mfa/setup")
def mfa_setup(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, p.user.id)
    assert user is not None
    if user.mfa_enabled_at is not None:
        raise HTTPException(409, "Two-factor authentication is already enabled.")
    secret = mfa.new_secret()
    user.totp_pending_enc = mfa.encrypt(secret)
    audit.record(db, "mfa_setup_started", actor=user)
    db.commit()
    # The secret is returned once, to the signed-in user only, for enrolment in an authenticator app.
    return {"secret": secret, "otpauth_uri": mfa.provisioning_uri(secret, user.email), "period": mfa.STEP_SECONDS, "digits": mfa.DIGITS}


@router.post("/auth/mfa/enable")
def mfa_enable(body: MfaCodeIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, p.user.id)
    assert user is not None
    secret = mfa.decrypt(user.totp_pending_enc or "")
    if secret is None:
        raise HTTPException(409, "Start two-factor setup first.")
    step = mfa.verify(secret, body.code, None)
    if step is None:
        raise HTTPException(400, "The code does not match. Check the device clock and try again.")
    user.totp_secret_enc, user.totp_pending_enc = user.totp_pending_enc, None
    user.totp_last_step = step
    user.mfa_enabled_at = datetime.now(timezone.utc)
    db.execute(update(AuthSession).where(AuthSession.id == p.session.id).values(mfa_verified=True))
    revoked = _revoke_other_sessions(db, user.id, p.session.id)
    audit.record(db, "mfa_enabled", actor=user, details={"other_sessions_revoked": revoked})
    db.commit()
    return {"enabled": True, "other_sessions_revoked": revoked}


@router.post("/auth/mfa/disable")
def mfa_disable(body: MfaDisableIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, p.user.id)
    assert user is not None
    if user.mfa_enabled_at is None:
        raise HTTPException(409, "Two-factor authentication is not enabled.")
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(400, "Current password is incorrect.")
    secret = mfa.decrypt(user.totp_secret_enc or "")
    step = mfa.verify(secret, body.code, user.totp_last_step) if secret else None
    if step is None:
        raise HTTPException(400, "Invalid or already used authentication code.")
    user.totp_secret_enc = None
    user.totp_last_step = None
    user.mfa_enabled_at = None
    audit.record(db, "mfa_disabled", actor=user)
    db.commit()
    return {"enabled": False}


class UserIn(StrictIn):
    email: EmailStr
    display_name: str = ""
    password: str = Field(min_length=12, max_length=512)
    role: str = "transcriber"


@router.get("/admin/users")
def list_users(p: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    return {"users": [user_out(u) for u in db.execute(select(User).order_by(User.created_at)).scalars()]}


@router.post("/admin/users")
def create_user(body: UserIn, p: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(422, "Unknown role.")
    if db.execute(select(User).where(func.lower(User.email) == body.email.lower())).first():
        raise HTTPException(409, "A user with this email exists.")
    u = User(email=body.email.lower(), display_name=body.display_name, password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    db.flush()
    audit.record(db, "user_created", actor=p.user, details={"user_id": str(u.id), "email": u.email, "role": u.role})
    db.commit()
    return {"user": user_out(u)}


class UserPatch(StrictIn):
    role: str | None = None
    is_active: bool | None = None


@router.patch("/admin/users/{user_id}")
def update_user(user_id: str, body: UserPatch, p: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, parse_uuid(user_id))
    if u is None:
        raise HTTPException(404, "Not found.")
    if u.id == p.user.id and (body.is_active is False or (body.role and body.role != "admin")):
        raise HTTPException(409, "You cannot remove your own administrator access.")
    changes: dict[str, list] = {}
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, "Unknown role.")
        changes["role"] = [u.role, body.role]
        u.role = body.role
    if body.is_active is not None:
        changes["is_active"] = [u.is_active, body.is_active]
        u.is_active = body.is_active
    audit.record(db, "user_updated", actor=p.user, details={"user_id": str(u.id), "changes": changes})
    db.commit()
    return {"user": user_out(u)}
