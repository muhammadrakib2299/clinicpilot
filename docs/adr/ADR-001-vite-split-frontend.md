# ADR-001 — Vite SPA + separate API (not a Next.js monolith)

- **Status:** Accepted
- **Date:** 2026-07-03

## Context
ClinicPilot needs a dashboard-heavy SPA plus a clear backend for auth, tenancy,
orchestration, and a separate Python AI service. We must choose between a Next.js
full-stack monolith and a Vite SPA talking to standalone services.

## Decision
Use a **Vite + React SPA** (`apps/web`) that consumes a **standalone NestJS API**
(`apps/api`) and a **Python FastAPI AI service** (`apps/ai`).

## Rationale
- A clean **frontend/backend boundary** better demonstrates full-stack API design
  than a framework that blends them — a deliberate hiring signal.
- The AI work belongs in Python (`apps/ai`); a JS-only monolith would fight that.
- SPA + REST/WebSocket is the natural fit for streaming agent traces.

## Consequences
- We own auth/session wiring instead of getting it "for free" — acceptable and instructive.
- Next.js remains a valid alternative for a single-language team (noted, not chosen).
