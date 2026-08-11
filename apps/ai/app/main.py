"""
ClinicPilot AI service (FastAPI).

Responsibilities (built out in Phases 1–3, see ../../08-PLAN.md):
  - Claude tool-use loop (reason -> tool -> observe -> act)   [Phase 1]
  - RAG over pgvector for the Document Q&A agent
  - PHI redaction / de-identification before any LLM call
  - Provider interface (Claude primary, OpenAI fallback)
  - Eval harness
"""

import logging
import os
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from app.agents.runner import (
    AGENTS,
    ProviderUnavailableError,
    UnknownAgentError,
    run_task,
)
from app.env import load_root_env

# Before anything reads os.environ. No-op in a container, where Compose injects
# the real thing and there is no .env in the image.
load_root_env()

logger = logging.getLogger(__name__)

app = FastAPI(title="ClinicPilot AI Service", version="0.1.0")

DEFAULT_WEB_ORIGIN = "http://localhost:5173"


def parse_allowed_origins(raw: str | None) -> list[str]:
    """Parse the `WEB_ORIGIN` allowlist.

    A wildcard is wrong for a service that proxies patient context to a model,
    and `allow_credentials` is silently ignored alongside `*` — so the
    allowlist is explicit and comma-separated, one deploy serving both the Vite
    dev server and the containerised nginx build.

    Mirrors `parseAllowedOrigins` in apps/api/src/common/cors.ts deliberately:
    both backends read the same variable, so they must read it the same way. A
    pure function rather than an inline comprehension so it can be tested
    without depending on what happens to be in the environment.
    """
    value = raw if raw and raw.strip() else DEFAULT_WEB_ORIGIN

    return [origin.strip() for origin in value.split(",") if origin.strip()]


ALLOWED_ORIGINS = parse_allowed_origins(os.environ.get("WEB_ORIGIN"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "clinicpilot-ai",
        "ts": datetime.now(UTC).isoformat(),
        "agents": sorted(AGENTS),
    }


class RunTaskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(alias="taskId", min_length=1)
    input: str = Field(min_length=1, max_length=4000)
    agent_kind: str = Field(default="scheduling", alias="agentKind")


class RunTaskResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(serialization_alias="taskId")
    outcome: str
    summary: str
    steps: int
    iterations: int
    cost_usd: float = Field(serialization_alias="costUsd")
    tokens_in: int = Field(serialization_alias="tokensIn")
    tokens_out: int = Field(serialization_alias="tokensOut")


@app.post("/run", response_model=RunTaskResponse)
def run(request: RunTaskRequest) -> RunTaskResponse:
    """Run one task to completion and report what happened.

    Deliberately synchronous. A fire-and-forget 202 would be a shorter request,
    but it would also mean the caller — the queue worker, from Phase 3 — could
    never learn whether the run worked, which is most of what a queue is for.
    Retries, backoff and the dead-letter path all need this to answer honestly,
    and the loop already spends seconds per model call, so the open connection
    is not the expensive part.

    Declared `def` rather than `async def` on purpose: the loop and its HTTP
    calls are blocking, so FastAPI runs this in a worker thread instead of
    stalling the event loop for every other request.
    """
    try:
        result = run_task(
            task_id=request.task_id,
            task_input=request.input,
            agent_kind=request.agent_kind,
        )
    except UnknownAgentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        # 503, not 500: nothing is broken, something is unconfigured, and a
        # queue should back off and retry rather than dead-letter the job.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("task %s failed", request.task_id)
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc

    return RunTaskResponse(
        task_id=request.task_id,
        outcome=result.outcome,
        summary=result.summary,
        steps=result.steps,
        iterations=result.iterations,
        cost_usd=result.cost_usd,
        tokens_in=result.usage.input_tokens,
        tokens_out=result.usage.output_tokens,
    )
