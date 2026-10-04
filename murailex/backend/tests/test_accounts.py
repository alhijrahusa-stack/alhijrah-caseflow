"""MFA (TOTP), session management, and cases."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import mfa
from app.main import create_app

from .conftest import FIXTURES, login, make_user, upload_file

PASSWORD = "correct horse battery staple"


def client() -> TestClient:
    return TestClient(create_app(), base_url="http://testserver")


@pytest.fixture(scope="module")
def accounts():
    make_user("mfa@example.com")
    make_user("cases@example.com")
    make_user("other-cases@example.com")


def test_rfc6238_vector():
    import base64

    secret = base64.b32encode(b"12345678901234567890").decode()
    assert mfa.code_at(secret, 59 // 30) == "287082"  # RFC 6238 Appendix B, last 6 digits of 94287082


def test_mfa_enrolment_login_replay_and_disable(accounts):
    with client() as a, client() as b:
        csrf_a = login(a, "mfa@example.com")
        csrf_b = login(b, "mfa@example.com")
        setup = a.post("/api/auth/mfa/setup", headers={"x-csrf-token": csrf_a}).json()
        secret = setup["secret"]
        assert setup["otpauth_uri"].startswith("otpauth://totp/MURAILEX:")
        assert a.post("/api/auth/mfa/enable", headers={"x-csrf-token": csrf_a}, json={"code": "abcdef"}).status_code == 400
        code = mfa.code_at(secret, int(time.time() // 30))
        enabled = a.post("/api/auth/mfa/enable", headers={"x-csrf-token": csrf_a}, json={"code": code})
        assert enabled.status_code == 200, enabled.text
        assert enabled.json()["enabled"] is True
        # the enrolling session survives; the other session (no second factor) is revoked
        assert a.get("/api/auth/me").status_code == 200
        assert b.get("/api/auth/me").status_code == 401
        assert csrf_b

    with client() as c:
        no_code = c.post("/api/auth/login", json={"email": "mfa@example.com", "password": PASSWORD})
        assert no_code.status_code == 401 and no_code.json()["detail"]["code"] == "mfa_required"
        wrong = c.post("/api/auth/login", json={"email": "mfa@example.com", "password": PASSWORD, "otp": "12345x"})
        assert wrong.status_code == 401
        # the enrolment step is spent: the same code cannot be replayed; wait for the next step
        step = int(time.time() // 30)
        while int(time.time() // 30) == step:
            time.sleep(0.25)
        fresh = mfa.code_at(secret, int(time.time() // 30))
        ok = c.post("/api/auth/login", json={"email": "mfa@example.com", "password": PASSWORD, "otp": fresh})
        assert ok.status_code == 200, ok.text
        assert ok.json()["user"]["mfa_enabled"] is True
        with client() as d:
            replay = d.post("/api/auth/login", json={"email": "mfa@example.com", "password": PASSWORD, "otp": fresh})
            assert replay.status_code == 401
        csrf = ok.json()["csrf_token"]
        sessions = c.get("/api/auth/sessions").json()["sessions"]
        assert any(s["current"] and s["mfa_verified"] for s in sessions)
        step = int(time.time() // 30)
        while int(time.time() // 30) == step:
            time.sleep(0.25)
        off = c.post(
            "/api/auth/mfa/disable",
            headers={"x-csrf-token": csrf},
            json={"password": PASSWORD, "code": mfa.code_at(secret, int(time.time() // 30))},
        )
        assert off.status_code == 200, off.text
    with client() as e:
        login(e, "mfa@example.com")


def test_sessions_list_and_revoke(accounts):
    with client() as a, client() as b:
        csrf_a = login(a, "cases@example.com")
        login(b, "cases@example.com")
        rows = a.get("/api/auth/sessions").json()["sessions"]
        assert len(rows) >= 2 and sum(r["current"] for r in rows) == 1
        other = next(r for r in rows if not r["current"])
        assert a.post(f"/api/auth/sessions/{other['id']}/revoke", headers={"x-csrf-token": csrf_a}).status_code == 200
        current = next(r for r in rows if r["current"])
        assert a.post(f"/api/auth/sessions/{current['id']}/revoke", headers={"x-csrf-token": csrf_a}).status_code == 409
        login(b, "cases@example.com")
        assert a.post("/api/auth/sessions/revoke-others", headers={"x-csrf-token": csrf_a}).json()["revoked"] >= 1
        assert b.get("/api/auth/me").status_code == 401
        assert a.get("/api/auth/me").status_code == 200


def test_cases_group_recordings_with_owner_isolation(accounts, fixture_providers):
    import os

    with client() as a, client() as o:
        csrf = login(a, "cases@example.com")
        csrf_o = login(o, "other-cases@example.com")
        made = a.post("/api/cases", headers={"x-csrf-token": csrf}, json={"reference": "COA 381909", "title": "Appeal"})
        assert made.status_code == 200, made.text
        case_id = made.json()["case"]["id"]
        assert a.post("/api/cases", headers={"x-csrf-token": csrf}, json={"reference": "COA 381909"}).status_code == 409
        rec = upload_file(a, csrf, os.path.join(FIXTURES, "sample.wav"), title="case member")
        assigned = a.post(f"/api/recordings/{rec['id']}/case", headers={"x-csrf-token": csrf}, json={"case_id": case_id})
        assert assigned.status_code == 200 and assigned.json()["recording"]["case_id"] == case_id
        detail = a.get(f"/api/cases/{case_id}").json()
        assert detail["case"]["recordings"] == 1 and detail["recordings"][0]["sha256"] == rec["sha256"]
        assert [r["id"] for r in a.get(f"/api/recordings?case_id={case_id}").json()["recordings"]] == [rec["id"]]
        # another user can neither see the case nor file into it
        assert o.get(f"/api/cases/{case_id}").status_code == 404
        assert o.get("/api/cases").json()["cases"] == []
        assert o.post(f"/api/recordings/{rec['id']}/case", headers={"x-csrf-token": csrf_o}, json={"case_id": None}).status_code in (403, 404)
        cleared = a.post(f"/api/recordings/{rec['id']}/case", headers={"x-csrf-token": csrf}, json={"case_id": None})
        assert cleared.json()["recording"]["case_id"] is None
