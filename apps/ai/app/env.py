"""Load the repo-root `.env` when running on the host.

The Node half of the monorepo already does this — `drizzle.config.ts` and the
seed script both call `process.loadEnvFile("../../.env")`, because a process
started from `apps/api` has nothing loaded for it. The Python half did not, so
`uvicorn app.main:app` (the dev command in the README) started without an
`ANTHROPIC_API_KEY` and every run answered 503.

`override=False` matters: in Docker Compose the values arrive as real
environment variables and there is no `.env` in the image. A stale committed
file must never win over what the orchestrator injected.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

# apps/ai/app/env.py -> apps/ai/app -> apps/ai -> apps -> repo root
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


def load_root_env() -> bool:
    """Returns whether a file was found, so callers can say so if it matters."""
    if not ROOT_ENV.is_file():
        return False

    load_dotenv(ROOT_ENV, override=False)
    return True
