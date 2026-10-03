from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import audit, storage
from ..db import get_db
from ..providers import registry
from ..providers import translate as gt
from ..security import Principal, current_principal, require_admin

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    return {"status": "ok", "service": "murailex-api"}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    checks: dict = {}
    ok = True
    try:
        db.execute(text("select 1"))
        rev = db.execute(text("select version_num from alembic_version")).scalar()
        checks["database"] = {"ok": True, "schema_revision": rev}
    except Exception as exc:  # noqa: BLE001
        ok = False
        checks["database"] = {"ok": False, "error": type(exc).__name__}
    try:
        checks["storage"] = {"ok": True, **storage.check()}
    except Exception as exc:  # noqa: BLE001
        ok = False
        checks["storage"] = {"ok": False, "error": type(exc).__name__}
    checks["providers"] = {a.name: ("CONFIGURED" if a.info().configured else "NOT CONFIGURED") for a in registry.all_adapters()}
    return JSONResponse({"ready": ok, "checks": checks}, status_code=200 if ok else 503)


@router.get("/providers")
def providers(p: Principal = Depends(current_principal)):
    out = []
    for a in registry.all_adapters():
        info = a.info()
        out.append({"name": info.name, "model": info.model, "role": info.role,
                    "status": "CONFIGURED" if info.configured else "NOT CONFIGURED", "parameters": info.parameters})
    out.append({"name": "google_translate", "model": gt.MODEL, "role": "translation",
                "status": "CONFIGURED" if gt.configured() else "NOT CONFIGURED", "parameters": {}})
    return {"providers": out, "note": "CONFIGURED means credentials are present; it is not proof of a successful call."}


@router.get("/audit/verify")
def verify(p: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    return audit.verify_chain(db)
