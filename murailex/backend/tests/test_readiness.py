from app.api.system import _provider_readiness
from app.providers import registry


def test_provider_readiness_never_treats_missing_credentials_as_ready():
    rows = _provider_readiness()
    assert rows
    assert all(row["status"] == "NOT_CONFIGURED" for row in rows.values())
    assert all(row["status"] in registry.ENGINE_STATUSES for row in rows.values())
    assert all(row["last_real_self_test"] is None for row in rows.values())


def test_ready_endpoint_in_test_reports_fixture_scope_only(app_client):
    response = app_client.get("/api/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["infrastructure_ready"] is True
    assert body["forensic_provider_readiness_proven"] is False
    assert body["ready"] is True
