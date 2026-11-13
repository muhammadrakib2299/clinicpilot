"""Load the repo-root `.env` when running on the host.

The Node half of the monorepo already does this — `drizzle.config.ts` and the
seed script both call `process.loadEnvFile("../../.env")`, because a process
started from `apps/api` has nothing loaded for it. The Python half did not, so
`uvicorn app.main:app` (the dev command in the README) started without an
`ANTHROPIC_API_KEY` and every run answered 503.

Found by walking up for the workspace marker rather than by counting parent
directories. Counting worked on the host and raised `IndexError` in the
container, where the Dockerfile copies `app/` to `/srv/app` and there simply
are not that many parents — the repo layout is not the only layout this code
runs in.

`override=False` matters: in Docker Compose the values arrive as real
environment variables and there is no `.env` in the image. A stale committed
file must never win over what the orchestrator injected.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

#: Present at the repo root and nowhere else, so it identifies the root without
#: depending on how deep this file happens to sit beneath it.
WORKSPACE_MARKER = "pnpm-workspace.yaml"


def find_repo_root(start: Path | None = None) -> Path | None:
    """The directory holding the workspace marker, or None outside the repo."""
    here = (start or Path(__file__)).resolve()

    for directory in here.parents:
        if (directory / WORKSPACE_MARKER).is_file():
            return directory

    return None


def find_root_env(start: Path | None = None) -> Path | None:
    """The repo root's `.env`, or None when there is no repo above us."""
    root = find_repo_root(start)
    if root is None:
        return None

    candidate = root / ".env"
    return candidate if candidate.is_file() else None


def load_root_env() -> bool:
    """Returns whether a file was found, so callers can say so if it matters."""
    root_env = find_root_env()
    if root_env is None:
        return False

    load_dotenv(root_env, override=False)
    return True
