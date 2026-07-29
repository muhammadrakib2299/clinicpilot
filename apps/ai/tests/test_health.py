"""Health-check contract for the AI service.

Phase 0 has no model calls to assert on yet, so this pins the shape the
compose healthcheck and CI probe depend on.
"""

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    res = client.get("/health")

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "clinicpilot-ai"


def test_health_timestamp_is_parseable_and_utc() -> None:
    ts = client.get("/health").json()["ts"]

    parsed = datetime.fromisoformat(ts)
    assert parsed.tzinfo is not None, "timestamp must be timezone-aware"
    assert parsed.utcoffset() == UTC.utcoffset(None)


def test_openapi_schema_is_served() -> None:
    """FastAPI's generated docs are part of the service's value; keep them wired."""
    res = client.get("/openapi.json")

    assert res.status_code == 200
    schema = res.json()
    assert schema["info"]["title"] == "ClinicPilot AI Service"
    assert "/health" in schema["paths"]
