"""FHIR, reached through the API gateway (ADR-008).

This service holds no FHIR credentials and speaks no FHIR. It asks the gateway
for appointments and slots and gets flat records back — `id`, `start`, `end` —
with the R4 shapes, the optimistic-concurrency handling and the id
normalisation all living on the other side of this call.

That boundary is not bureaucracy. The Python adapter this replaced wrote a
malformed `Slot/Slot/137240396` reference onto a live appointment, which HAPI
accepted, because it was a second implementation of rules that already existed
in TypeScript.

The HTTP plumbing — base URL, service token, tenant header, error translation —
lives in `app/gateway.py`, shared with the documents surface.
"""

from __future__ import annotations

from typing import Any

from app.gateway import DEFAULT_API_URL, GatewayClient, GatewayError, explain

__all__ = ["DEFAULT_API_URL", "GatewayError", "GatewayFhir", "explain"]


class GatewayFhir(GatewayClient):
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

    def record_message(
        self,
        *,
        patient_ref: str,
        template_id: str,
        body: str,
        appointment_ref: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        """Record an outbound follow-up.

        Not FHIR — a ClinicPilot record — but it stays on this class because it
        is about a patient and their appointment, which is what every other
        method here is about. Moving it to the documents surface would put it
        next to clinic policies, which it has nothing to do with.
        """
        payload: dict[str, Any] = {
            "patientRef": patient_ref,
            "templateId": template_id,
            "body": body,
        }
        if appointment_ref:
            payload["appointmentRef"] = appointment_ref
        if task_id:
            payload["taskId"] = task_id

        return self._request("POST", "/api/internal/messages", json=payload)
