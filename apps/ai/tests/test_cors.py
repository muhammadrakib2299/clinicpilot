"""CORS allowlist behaviour for the AI service."""

from fastapi.testclient import TestClient

from app.main import DEFAULT_WEB_ORIGIN, app, parse_allowed_origins

client = TestClient(app)


class TestParseAllowedOrigins:
    """Tests the parser, not the module constant.

    Asserting on `ALLOWED_ORIGINS` looked equivalent and was not: it passes or
    fails on whatever `WEB_ORIGIN` happens to be in the environment at import.
    That was invisible until the service started loading the repo `.env`, at
    which point a test that had always passed began failing locally while
    still passing in CI, where no `.env` exists.
    """

    def test_defaults_when_unset(self) -> None:
        assert parse_allowed_origins(None) == [DEFAULT_WEB_ORIGIN]

    def test_defaults_when_blank(self) -> None:
        assert parse_allowed_origins("   ") == [DEFAULT_WEB_ORIGIN]

    def test_splits_a_comma_separated_allowlist(self) -> None:
        # The real deployment shape: Vite dev server and containerised nginx.
        assert parse_allowed_origins("http://localhost:5173,http://localhost:8081") == [
            "http://localhost:5173",
            "http://localhost:8081",
        ]

    def test_trims_whitespace_and_drops_empty_entries(self) -> None:
        assert parse_allowed_origins(" a , , b ,") == ["a", "b"]

    def test_never_yields_a_wildcard_from_an_empty_value(self) -> None:
        assert "*" not in parse_allowed_origins("")


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
