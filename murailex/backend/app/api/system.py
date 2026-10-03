from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import audit, storage
from ..config import get_settings
from ..db import get_db
from ..providers import capabilities, privacy, registry
from ..security import Principal, current_principal, require_admin

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    """Process liveness only. This endpoint never implies forensic readiness."""
    return {"status": "ok", "service": "murailex-api", "scope": "liveness_only"}


def _provider_readiness(db: Session | None = None) -> dict[str, dict]:
    return {row["internal_id"]: row for row in registry.registry_states(db)}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    checks: dict = {}
    infrastructure_ok = True
    try:
        db.execute(text("select 1"))
        rev = db.execute(text("select version_num from alembic_version")).scalar()
        checks["database"] = {"ok": True, "schema_revision": rev}
    except Exception as exc:  # noqa: BLE001
        infrastructure_ok = False
        checks["database"] = {"ok": False, "error": type(exc).__name__}
    try:
        checks["storage"] = {"ok": True, **storage.check()}
    except Exception as exc:  # noqa: BLE001
        infrastructure_ok = False
        checks["storage"] = {"ok": False, "error": type(exc).__name__}

    providers = _provider_readiness(db)
    checks["providers"] = providers
    settings = get_settings()
    provider_ready = bool(providers) and all(row["status"] == "READY" for row in providers.values())
    if settings.environment == "test":
        ready_now = infrastructure_ok
        provider_proven = False
    else:
        ready_now = infrastructure_ok and provider_ready
        provider_proven = provider_ready

    if registry.local_mode():
        from ..providers.local_whisper import hardware_profile

        checks["resources"] = hardware_profile()
    return JSONResponse(
        {
            "ready": ready_now,
            "infrastructure_ready": infrastructure_ok,
            "forensic_provider_readiness_proven": provider_proven,
            "checks": checks,
        },
        status_code=200 if ready_now else 503,
    )


@router.get("/providers")
def providers(
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rows = []
    for state in _provider_readiness(db).values():
        row = dict(state)
        row["name"] = f"{state['provider']} · {state['locale']}"
        rows.append(row)
    return {
        "providers": rows,
        "candidate_capabilities": capabilities.all_capabilities(),
        "allowed_statuses": sorted(registry.ENGINE_STATUSES),
        "note": (
            "READY requires a persisted successful real self-test for the exact provider/model/locale/role route. "
            "Credential presence or deployment success alone never implies readiness."
        ),
    }


@router.get("/privacy")
def provider_privacy(p: Principal = Depends(require_admin)):
    return {"providers": privacy.all_privacy()}


@router.get("/audit/verify")
def verify(p: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    return audit.verify_chain(db)
