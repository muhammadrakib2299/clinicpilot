"""Posts trace steps to the API gateway (ADR-004).

The AI service holds no database connection. It reports each step over HTTP and
the gateway persists it and broadcasts it to the Trace Viewer in one handler.
"""

from __future__ import annotations

import logging
import os

import httpx

from app.agents.trace import TraceStep

logger = logging.getLogger(__name__)

DEFAULT_API_URL = "http://localhost:8080"


class GatewayTraceSink:
    """A `TraceSink` that forwards to the gateway's internal task API.

    Delivery failures are logged, never raised. A trace step is an observability
    record: losing one should degrade the Trace Viewer, not abort an agent run
    that is otherwise doing real work on a patient's calendar.
    """

    def __init__(
        self,
        task_id: str,
        *,
        base_url: str | None = None,
        client: httpx.Client | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.task_id = task_id
        self.base_url = (base_url or os.environ.get("API_URL") or DEFAULT_API_URL).rstrip("/")
        self._client = client or httpx.Client(timeout=timeout)
        self.failures = 0

    def __call__(self, step: TraceStep) -> None:
        url = f"{self.base_url}/api/internal/tasks/{self.task_id}/traces"
        try:
            response = self._client.post(url, json=step.to_payload())
            if response.status_code == 409:
                # The gateway already has this step number — a retry landed
                # twice. Idempotent by design; nothing to do.
                logger.info("trace step %s already recorded", step.step_no)
                return
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001 — see class docstring
            self.failures += 1
            logger.warning("failed to post trace step %s: %s", step.step_no, exc)

    def mark_running(self) -> None:
        self._post(f"/api/internal/tasks/{self.task_id}/running", {})

    def complete(self, status: str, outcome: str | None) -> None:
        self._post(
            f"/api/internal/tasks/{self.task_id}/complete",
            {"status": status, "outcome": outcome},
        )

    def _post(self, path: str, payload: dict[str, object]) -> None:
        try:
            self._client.post(f"{self.base_url}{path}", json=payload).raise_for_status()
        except Exception as exc:  # noqa: BLE001
            self.failures += 1
            logger.warning("failed to POST %s: %s", path, exc)

    def close(self) -> None:
        self._client.close()
