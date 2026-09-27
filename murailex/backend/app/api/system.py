from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import audit, storage
from ..config import get_settings
from ..db import get_db
from ..providers import capabilities, privacy, registry
from ..providers import translate as gt
from ..security import Principal, current_principal, require_admin

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    """Process liveness only. This endpoint must never be interpreted as forensic readiness."""
    return {"status": "ok", "service": "murailex-api", "scope": "liveness_only"}


def _credentials_present(provider: str) -> bool:
    settings = get_settings()
    if provider == "assemblyai":
        return bool(settings.assemblyai_api_key and settings.assemblyai_api_key.get_secret_value())
    if provider == "google_chirp3":
        return bool(
            settings.google_credentials_json
            and settings.google_credentials_json.get_secret_value()
            and settings.google_stt_gcs_bucket
        )
    if provider == "deepgram":
        return bool(settings.deepgram_api_key and settings.deepgram_api_key.get_secret_value())
    if provider == "openai":
        return bool(settings.openai_api_key and settings.openai_api_key.get_secret_value())
    if provider == "pyannoteai":
        return bool(settings.pyannote_api_key and settings.pyannote_api_key.get_secret_value())
    return False


def _provider_readiness() -> dict[str, dict]:
    """Fail-closed provider state without sending audio or fabricating a self-test.

    READY is intentionally impossible here until a persisted real canary/self-test exists.
    Credential presence alone is never reported as operational readiness.
    """
    rows: dict[str, dict] = {}
    for adapter in registry.all_adapters():
        info = adapter.info()
        credentials = _credentials_present(adapter.name)
        gate = privacy.status(adapter.name)
        if not credentials:
            status = "NOT CONFIGURED"
        elif gate != "APPROVED":
            status = "BLOCKED"
        else:
            status = "UNVERIFIED"
        rows[adapter.name] = {
            "model": info.model,
            "role": info.role,
            "configured": credentials,
            "privacy_gate": gate,
            "last_real_self_test": None,
            "status": status,
        }
    return rows


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

    providers = _provider_readiness()
    checks["providers"] = providers
    settings = get_settings()
    if settings.environment == "test":
        # Automated fixture tests validate application mechanics only; they never prove cloud readiness.
        ready_now = infrastructure_ok
    else:
        provider_ready = bool(providers) and all(row["status"] == "READY" for row in providers.values())
        ready_now = infrastructure_ok and provider_ready

    return JSONResponse(
        {
            "ready": ready_now,
            "infrastructure_ready": infrastructure_ok,
            "forensic_provider_readiness_proven": all(
                row["status"] == "READY" for row in providers.values()
            ) if providers else False,
            "checks": checks,
        },
        status_code=200 if ready_now else 503,
    )


@router.get("/providers")
def providers(p: Principal = Depends(current_principal)):
    rows = []
    readiness = _provider_readiness()
    for adapter in registry.all_adapters():
        info = adapter.info()
        state = readiness[adapter.name]
        rows.append(
            {
                "name": info.name,
                "model": info.model,
                "role": info.role,
                "configured": state["configured"],
                "privacy_gate": state["privacy_gate"],
                "last_real_self_test": state["last_real_self_test"],
                "status": state["status"],
                "parameters": info.parameters,
                "capability": capabilities.get(adapter.name),
            }
        )
    rows.append(
        {
            "name": "google_translate",
            "model": gt.MODEL,
            "role": "translation",
            "configured": bool(gt.configured()),
            "privacy_gate": "NOT EVALUATED FOR FORENSIC ASR",
            "last_real_self_test": None,
            "status": "UNVERIFIED" if gt.configured() else "NOT CONFIGURED",
            "parameters": {},
        }
    )
    return {
        "providers": rows,
        "candidate_capabilities": capabilities.all_capabilities(),
        "note": "READY requires a persisted successful real self-test. Credentials or deployment success alone never imply readiness.",
    }


@router.get("/privacy")
def provider_privacy(p: Principal = Depends(require_admin)):
    return {"providers": privacy.all_privacy()}


@router.get("/audit/verify")
def verify(p: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    return audit.verify_chain(db)
