from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import LoginAttempt, User
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


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    key = throttle_key(body.email, client_ip(request))
    if not login_allowed(db, key):
        db.commit()
        raise HTTPException(429, "Too many sign-in attempts. Try again later.")
    user = authenticate(db, body.email, body.password)
    if user is None:
        db.add(LoginAttempt(key=key))
        audit.record(db, "login_failed", actor_label=body.email.lower(), details={"ip": client_ip(request)})
        db.commit()
        raise HTTPException(401, "Invalid email or password.")
    token, session = create_session(db, user)
    audit.record(db, "login", actor=user, details={"ip": client_ip(request)})
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
    audit.record(db, "password_changed", actor=user)
    db.commit()
    return {"ok": True}


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
