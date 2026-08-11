"""Loading the repo-root `.env` on the host without fighting the orchestrator."""

from __future__ import annotations

from pathlib import Path

from app import env


def write_env(tmp_path: Path, body: str) -> Path:
    path = tmp_path / ".env"
    path.write_text(body, encoding="utf-8")
    return path


def test_loads_values_from_the_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(env, "ROOT_ENV", write_env(tmp_path, "CLINICPILOT_TEST_A=from-file\n"))
    monkeypatch.delenv("CLINICPILOT_TEST_A", raising=False)

    assert env.load_root_env() is True
    assert env.ROOT_ENV.is_file()

    import os

    assert os.environ["CLINICPILOT_TEST_A"] == "from-file"


def test_a_real_environment_variable_wins(tmp_path, monkeypatch) -> None:
    # Compose injects the real values and ships no `.env` in the image. If a
    # stale committed file could override them, a container would silently run
    # with development settings.
    monkeypatch.setattr(env, "ROOT_ENV", write_env(tmp_path, "CLINICPILOT_TEST_B=from-file\n"))
    monkeypatch.setenv("CLINICPILOT_TEST_B", "from-orchestrator")

    env.load_root_env()

    import os

    assert os.environ["CLINICPILOT_TEST_B"] == "from-orchestrator"


def test_says_so_when_there_is_no_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(env, "ROOT_ENV", tmp_path / "nope.env")

    assert env.load_root_env() is False


def test_the_default_path_points_at_the_repo_root() -> None:
    # apps/ai/app/env.py -> repo root. An off-by-one in `parents[3]` would make
    # this silently load nothing on every host run.
    assert env.ROOT_ENV.name == ".env"
    assert (env.ROOT_ENV.parent / "pnpm-workspace.yaml").is_file()
