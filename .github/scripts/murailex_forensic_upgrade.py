from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "murailex/backend/app/pipeline/process.py"
text = PATH.read_text()

needle = '''def _set_status(db: Session, rec: Recording, status: str, detail: str | None = None) -> None:\n    rec.status = status\n    rec.status_detail = detail\n    db.commit()\n'''
replacement = '''def _set_status(db: Session, rec: Recording, status: str, detail: str | None = None) -> None:\n    rec.status = status\n    rec.status_detail = detail\n    db.commit()\n\n\ndef _run_status(run: ProviderRun | None) -> str:\n    return run.status if run is not None else "missing"\n'''
if needle not in text:
    raise RuntimeError("_set_status block not found")
text = text.replace(needle, replacement, 1)

old = '''"primary_status": {a.name: (runs.get(a.name).status if runs.get(a.name) else "missing") for a in primaries}'''
new = '''"primary_status": {a.name: _run_status(runs.get(a.name)) for a in primaries}'''
if old not in text:
    raise RuntimeError("primary_status block not found")
text = text.replace(old, new, 1)
PATH.write_text(text)
print("fixed ProviderRun optional status typing")
