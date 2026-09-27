from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from . import audit
from .api import auth, exports, forensic_controls, recordings, summaries, system, uploads
from .config import get_settings
from .db import session_factory
from .models import User
from .security import hash_password

log = logging.getLogger("murailex")


class RateLimiter:
    """Per-IP sliding window (per process). Login has its own DB-backed throttle."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        return True


def bootstrap_admin() -> None:
    s = get_settings()
    if not s.bootstrap_admin_email or not s.bootstrap_admin_password:
        return
    with session_factory()() as db:
        if db.execute(select(func.count()).select_from(User)).scalar_one() > 0:
            return
        u = User(email=s.bootstrap_admin_email.lower(), display_name="Administrator",
                 password_hash=hash_password(s.bootstrap_admin_password.get_secret_value()), role="admin")
        db.add(u)
        db.flush()
        audit.record(db, "user_created", actor_label="bootstrap", details={"user_id": str(u.id), "email": u.email, "role": "admin"})
        db.commit()


def create_app() -> FastAPI:
    s = get_settings()
    if s.environment == "production" and len(s.secret_key.get_secret_value()) < 32:
        raise RuntimeError("SECRET_KEY must be at least 32 characters in production.")
    app = FastAPI(title="MURAILEX API", version="1.0.0", docs_url=None if s.environment == "production" else "/api/docs",
                  redoc_url=None, openapi_url=None if s.environment == "production" else "/api/openapi.json")
    limiter = RateLimiter(s.rate_limit_per_minute)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()) or (request.client.host if request.client else "?")
        if not request.url.path.startswith("/api/health") and not limiter.allow(ip):
            return JSONResponse({"detail": "Rate limit exceeded."}, status_code=429)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.error("unhandled %s on %s", type(exc).__name__, request.url.path)
        return JSONResponse({"detail": "Internal error."}, status_code=500)

    for r in (
        system.router,
        auth.router,
        uploads.router,
        recordings.router,
        forensic_controls.router,
        exports.router,
        summaries.router,
    ):
        app.include_router(r)

    @app.on_event("startup")
    def _startup() -> None:
        bootstrap_admin()

    return app


app = create_app()
