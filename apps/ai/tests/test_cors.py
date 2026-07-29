"""CORS allowlist behaviour for the AI service."""

from fastapi.testclient import TestClient

from app.main import ALLOWED_ORIGINS, app

client = TestClient(app)


def test_defaults_to_the_local_web_origin() -> None:
    assert ALLOWED_ORIGINS == ["http://localhost:5173"]


def test_echoes_an_allowed_origin() -> None:
    res = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_does_not_echo_an_unknown_origin() -> None:
    res = client.get("/health", headers={"Origin": "https://evil.example.com"})

    # Starlette omits the header entirely rather than denying the request;
    # the browser is what enforces it. Absence is the assertion that matters.
    assert "access-control-allow-origin" not in res.headers


def test_preflight_from_an_allowed_origin_succeeds() -> None:
    res = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
