from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
P = ROOT / "murailex/backend/tests/test_critical_path.py"
text = P.read_text()

repls = [
(
'''    assert statuses == {"assemblyai": "not_configured", "google_chirp3": "not_configured"}\n''',
'''    assert statuses == {\n        "assemblyai": "not_configured",\n        "google_chirp3": "not_configured",\n        "openai": "not_configured",\n        "deepgram": "not_configured",\n        "pyannoteai": "not_configured",\n    }\n'''
),
(
'''    assert "[صمت]" in texts  # acoustic silence between 8 s and 11 s\n    assert "والله" in texts and "okay" in texts  # agreed tokens incl. code-switch preserved verbatim\n    assert "سالم" in texts  # name region closed by unanimous engines incl. verifier\n''',
'''    assert "[صمت]" in texts  # acoustic silence between 8 s and 11 s\n    assert "والله" in texts\n    assert "okay" not in texts  # code-switch is a mandatory human-review risk\n    assert "سالم" not in texts  # names are mandatory human-review risks\n'''
),
(
'''    assert "engine_disagreement" in reasons and "risk:number" in reasons and "overlap" in reasons\n''',
'''    assert "engine_disagreement" in reasons and "risk:number" in reasons and "overlap" in reasons\n    assert "risk:code_switch" in reasons and "risk:name" in reasons\n'''
),
(
'''        # single surviving engine => single-engine mode, every escalation reviewed\n        t = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]\n        assert t["content"]["method"]["single_engine_mode"] is True\n        assert d["recording"]["status"] == "needs_review"\n        ev = {e["action"] for e in app_client.get(f"/api/recordings/{rec['id']}/audit").json()["events"]}\n        assert "provider_retry" in ev and "provider_failed" in ev\n''',
'''        # a mandatory primary failure blocks forensic consensus and transcript creation\n        assert d["recording"]["status"] == "failed"\n        assert app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"] is None\n        ev = {e["action"] for e in app_client.get(f"/api/recordings/{rec['id']}/audit").json()["events"]}\n        assert "provider_retry" in ev and "provider_failed" in ev and "processing_failed" in ev\n'''
),
]

for old, new in repls:
    if old not in text:
        raise RuntimeError(f"expected test block missing: {old[:80]!r}")
    text = text.replace(old, new, 1)
P.write_text(text)
print("updated critical-path tests for strict forensic policy")
