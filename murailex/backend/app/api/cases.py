"""Cases: a named matter that groups recordings. Grouping never alters any recording,
transcript or hash; assignment changes are audited."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..models import Case, Recording, RecordingAccess
from ..security import Principal, current_principal, load_recording
from .common import iso, parse_uuid, recording_out
from .strict import StrictIn

router = APIRouter(prefix="/api")


class CaseIn(StrictIn):
    reference: str = Field(min_length=1, max_length=120, pattern=r"^\S(.*\S)?$")
    title: str = Field(default="", max_length=300)


class CaseAssignIn(StrictIn):
    case_id: str | None = None


def case_out(c: Case, count: int = 0) -> dict:
    return {"id": str(c.id), "reference": c.reference, "title": c.title, "owner_id": str(c.owner_id), "created_at": iso(c.created_at), "recordings": count}


def _load_case(db: Session, p: Principal, case_id: str) -> Case:
    c = db.get(Case, parse_uuid(case_id))
    if c is None or not (p.is_admin or c.owner_id == p.user.id):
        raise HTTPException(404, "Not found.")
    return c


def _visible_recordings(p: Principal):
    stmt = select(Recording).where(or_(Recording.recording_type.is_(None), Recording.recording_type != "system_canary"))
    if not p.is_admin:
        shared = select(RecordingAccess.recording_id).where(RecordingAccess.user_id == p.user.id)
        stmt = stmt.where(or_(Recording.owner_id == p.user.id, Recording.id.in_(shared)))
    return stmt


@router.get("/cases")
def list_cases(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    stmt = select(Case).order_by(Case.created_at.desc())
    if not p.is_admin:
        stmt = stmt.where(Case.owner_id == p.user.id)
    cases = list(db.execute(stmt).scalars())
    counts = dict(
        db.execute(
            select(Recording.case_id, func.count()).where(Recording.case_id.in_([c.id for c in cases])).group_by(Recording.case_id)
        ).all()
    ) if cases else {}
    return {"cases": [case_out(c, counts.get(c.id, 0)) for c in cases]}


@router.post("/cases")
def create_case(body: CaseIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = Case(owner_id=p.user.id, reference=body.reference, title=body.title)
    db.add(c)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A case with this reference already exists.") from None
    audit.record(db, "case_created", actor=p.user, details={"case_id": str(c.id), "reference": c.reference})
    db.commit()
    return {"case": case_out(c)}


@router.get("/cases/{case_id}")
def get_case(case_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = _load_case(db, p, case_id)
    recs = list(db.execute(_visible_recordings(p).where(Recording.case_id == c.id).order_by(Recording.created_at.desc())).scalars())
    return {"case": case_out(c, len(recs)), "recordings": [recording_out(r) for r in recs]}


@router.post("/recordings/{recording_id}/case")
def assign_case(recording_id: str, body: CaseAssignIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "upload")
    if not (p.is_admin or rec.owner_id == p.user.id):
        raise HTTPException(403, "Only the recording owner can file it in a case.")
    target = _load_case(db, p, body.case_id) if body.case_id else None
    if target is not None and target.owner_id != rec.owner_id and not p.is_admin:
        raise HTTPException(403, "The case belongs to another user.")
    before = str(rec.case_id) if rec.case_id else None
    rec.case_id = target.id if target else None
    audit.record(db, "recording_case_changed", actor=p.user, recording_id=rec.id, details={"from": before, "to": body.case_id})
    db.commit()
    return {"recording": recording_out(rec)}
