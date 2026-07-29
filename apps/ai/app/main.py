"""
ClinicPilot AI service (FastAPI).

Responsibilities (built out in Phases 1–3, see ../../08-PLAN.md):
  - Claude tool-use loop (reason -> tool -> observe -> act)
  - RAG over pgvector for the Document Q&A agent
  - PHI redaction / de-identification before any LLM call
  - Provider interface (Claude primary, OpenAI fallback)
  - Eval harness

For Phase 0 this exposes only a health check.
"""

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="ClinicPilot AI Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "clinicpilot-ai",
        "ts": datetime.now(UTC).isoformat(),
    }
