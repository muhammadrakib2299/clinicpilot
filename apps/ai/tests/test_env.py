"""Loading the repo-root `.env` on the host without fighting the orchestrator."""

from __future__ import annotations

import os
from pathlib import Path

from app import env


def make_repo(tmp_path: Path, *, env_body: str | None = "X=1", depth: int = 3) -> Path:
    """A fake repo root with the workspace marker, and a file `depth` levels in."""
    (tmp_path / env.WORKSPACE_MARKER).write_text("packages:\n", encoding="utf-8")
    if env_body is not None:
        (tmp_path / ".env").write_text(env_body, encoding="utf-8")

    nested = tmp_path.joinpath(*[f"level{i}" for i in range(depth)])
    nested.mkdir(parents=True)
    module = nested / "env.py"
    module.write_text("", encoding="utf-8")
    return module


class TestFindRootEnv:
    def test_finds_the_env_beside_the_workspace_marker(self, tmp_path) -> None:
        module = make_repo(tmp_path)

        assert env.find_root_env(module) == tmp_path / ".env"

    def test_depth_between_the_file_and_the_root_does_not_matter(self, tmp_path) -> None:
        # The bug this replaced counted parents. It was right for apps/ai/app
        # and wrong for /srv/app in the container, which crashed the service on
        # import with an IndexError.
        module = make_repo(tmp_path, depth=1)

        assert env.find_root_env(module) == tmp_path / ".env"

    def test_returns_none_when_there_is_no_repo_above(self, tmp_path) -> None:
        # The container case: `app/` is copied to /srv/app and there is no repo,
        # no marker and no .env. That is a normal state, not an error.
        orphan = tmp_path / "srv" / "app" / "env.py"
        orphan.parent.mkdir(parents=True)
        orphan.write_text("", encoding="utf-8")

        assert env.find_root_env(orphan) is None

    def test_returns_none_when_the_repo_has_no_env_file(self, tmp_path) -> None:
        module = make_repo(tmp_path, env_body=None)

        assert env.find_root_env(module) is None

    def test_resolves_against_the_real_repo_when_given_no_argument(self) -> None:
        found = env.find_root_env()

        # This test run *is* inside the repo, so the marker is findable.
        assert found is not None
        assert (found.parent / env.WORKSPACE_MARKER).is_file()


class TestLoadRootEnv:
    def test_loads_values_from_the_file(self, tmp_path, monkeypatch) -> None:
        module = make_repo(tmp_path, env_body="CLINICPILOT_TEST_A=from-file\n")
        monkeypatch.setattr(env, "find_root_env", lambda: module.parents[3] / ".env")
        monkeypatch.delenv("CLINICPILOT_TEST_A", raising=False)

        assert env.load_root_env() is True
        assert os.environ["CLINICPILOT_TEST_A"] == "from-file"

    def test_a_real_environment_variable_wins(self, tmp_path, monkeypatch) -> None:
        # Compose injects the real values and ships no `.env` in the image. If a
        # stale committed file could override them, a container would silently
        # run with development settings.
        module = make_repo(tmp_path, env_body="CLINICPILOT_TEST_B=from-file\n")
        monkeypatch.setattr(env, "find_root_env", lambda: module.parents[3] / ".env")
        monkeypatch.setenv("CLINICPILOT_TEST_B", "from-orchestrator")

        env.load_root_env()

        assert os.environ["CLINICPILOT_TEST_B"] == "from-orchestrator"

    def test_says_so_when_there_is_nothing_to_load(self, monkeypatch) -> None:
        monkeypatch.setattr(env, "find_root_env", lambda: None)

        assert env.load_root_env() is False

    def test_importing_the_service_does_not_raise_outside_a_repo(self, monkeypatch) -> None:
        # The container failure was at import time, which is the worst place
        # for it: the health check never got a chance to report anything useful.
        monkeypatch.setattr(env, "find_root_env", lambda: None)

        env.load_root_env()  # must not raise
