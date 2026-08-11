"""FHIR, reached through the API gateway (ADR-008).

This service holds no FHIR credentials and speaks no FHIR. It asks the gateway
for appointments and slots and gets flat records back — `id`, `start`, `end` —
with the R4 shapes, the optimistic-concurrency handling and the id
normalisation all living on the other side of this call.

That boundary is not bureaucracy. The Python adapter this replaced wrote a
malformed `Slot/Slot/137240396` reference onto a live appointment, which HAPI
accepted, because it was a second implementation of rules that already existed
in TypeScript.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_API_URL = "http://localhost:8080"


class GatewayError(Exception):
    """The gateway refused or could not serve a FHIR request.

    Raised into the agent loop, which turns it into an error `tool_result` the
    model reads and recovers from — so the message is load-bearing, not just
    something for a log. It carries the gateway's own explanation, which in
    turn carries the FHIR server's `OperationOutcome` diagnostics.
    """


class GatewayFhir:
    def __init__(
        self,
        *,
        tenant_id: str | None = None,
        base_url: str | None = None,
        client: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.tenant_id = tenant_id
        self.base_url = (base_url or os.environ.get("API_URL") or DEFAULT_API_URL).rstrip("/")
        self._client = client or httpx.Client(timeout=timeout)
        self._owns_client = client is None

    def _headers(self) -> dict[str, str]:
        headers = {"x-service-token": os.environ.get("SERVICE_TOKEN", "")}
        if self.tenant_id:
            headers["x-tenant-id"] = self.tenant_id
        return headers

    def find_appointments(
        self,
        *,
        patient_id: str,
        status: str | None = None,
        count: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {"patientId": patient_id}
        if status:
            params["status"] = status
        if count is not None:
            params["count"] = str(count)

        return self._request("GET", "/api/internal/fhir/appointments", params=params)

    def find_free_slots(
        self,
        *,
        schedule_id: str,
        from_instant: str,
        count: int | None = None,
    ) -> list[dict[str, Any]]:
        params = {"scheduleId": schedule_id, "from": from_instant}
        if count is not None:
            params["count"] = str(count)

        return self._request("GET", "/api/internal/fhir/slots", params=params)

    def reschedule(
        self,
        *,
        appointment_id: str,
        slot_id: str,
        start: str,
        end: str,
        comment: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "appointmentId": appointment_id,
            "slotId": slot_id,
            "start": start,
            "end": end,
        }
        if comment:
            payload["comment"] = comment

        return self._request("POST", "/api/internal/fhir/appointments/reschedule", json=payload)

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(
                method, f"{self.base_url}{path}", headers=self._headers(), **kwargs
            )
        except httpx.HTTPError as exc:
            raise GatewayError(f"could not reach the API gateway: {exc}") from exc

        if response.status_code >= 400:
            raise GatewayError(explain(response))

        return response.json()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


def explain(response: httpx.Response) -> str:
    """Turn a gateway error response into a sentence a model can act on.

    Field-level validation issues are flattened into the message rather than
    left in a nested array: the model sees this as one string, and "which
    field" is the part that tells it what to change.
    """
    try:
        body = response.json()
    except ValueError:
        return f"{response.status_code} {response.text[:200]}".strip()

    if not isinstance(body, dict):
        return f"{response.status_code} {body}"

    message = body.get("message") or body.get("error") or f"HTTP {response.status_code}"

    issues = body.get("issues")
    if isinstance(issues, list) and issues:
        detail = "; ".join(
            f"{issue.get('path', '?')}: {issue.get('message', '')}".strip()
            for issue in issues
            if isinstance(issue, dict)
        )
        return f"{message} — {detail}"

    return str(message)
