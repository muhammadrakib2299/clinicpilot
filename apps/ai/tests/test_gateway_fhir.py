"""The gateway FHIR client and the scheduling executor built on it.

Driven against a stub transport rather than a live gateway: what matters here
is the request shape going out and, more than anything, the legibility of the
error text coming back — that string is fed straight to a model as an error
`tool_result` and is the only thing it has to recover from.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.agents.scheduling_executor import make_scheduling_executor
from app.fhir.gateway import GatewayError, GatewayFhir, explain
from app.llm.provider import ToolCall

BASE = "http://gateway.test"


def gateway(handler) -> GatewayFhir:
    transport = httpx.MockTransport(handler)
    return GatewayFhir(base_url=BASE, client=httpx.Client(transport=transport))


def responder(payload: Any, status: int = 200):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=payload)

    return handler, seen


APPOINTMENT = {
    "id": "137240399",
    "status": "booked",
    "start": "2026-08-13T14:00:00Z",
    "end": "2026-08-13T14:30:00Z",
    "description": "Routine follow-up",
}
SLOT = {"id": "137240396", "start": "2026-08-18T10:30:00Z", "end": "2026-08-18T11:00:00Z"}


class TestRequestShape:
    def test_find_appointments_sends_camel_case_query_parameters(self) -> None:
        handler, seen = responder([APPOINTMENT])

        gateway(handler).find_appointments(patient_id="137240393", status="booked")

        assert seen[0].url.path == "/api/internal/fhir/appointments"
        assert dict(seen[0].url.params) == {"patientId": "137240393", "status": "booked"}

    def test_an_absent_status_is_omitted_rather_than_sent_empty(self) -> None:
        handler, seen = responder([])

        gateway(handler).find_appointments(patient_id="1")

        assert "status" not in dict(seen[0].url.params)

    def test_find_free_slots_sends_the_instant_unprefixed(self) -> None:
        # `ge` is the gateway's business — the client must not add it twice.
        handler, seen = responder([SLOT])

        gateway(handler).find_free_slots(
            schedule_id="137240394", from_instant="2026-08-14T00:00:00Z"
        )

        assert dict(seen[0].url.params)["from"] == "2026-08-14T00:00:00Z"

    def test_reschedule_posts_the_ids_in_the_body(self) -> None:
        handler, seen = responder(APPOINTMENT)

        gateway(handler).reschedule(
            appointment_id="137240399",
            slot_id="137240396",
            start="2026-08-18T10:30:00Z",
            end="2026-08-18T11:00:00Z",
        )

        assert seen[0].method == "POST"
        assert json.loads(seen[0].content) == {
            "appointmentId": "137240399",
            "slotId": "137240396",
            "start": "2026-08-18T10:30:00Z",
            "end": "2026-08-18T11:00:00Z",
        }

    def test_a_prefixed_id_is_passed_through_for_the_gateway_to_normalise(self) -> None:
        # Deliberately NOT normalised here. ADR-008 exists because two
        # implementations of FHIR rules drift; the gateway owns this one.
        handler, seen = responder(APPOINTMENT)

        gateway(handler).reschedule(
            appointment_id="Appointment/137240399",
            slot_id="Slot/137240396",
            start="2026-08-18T10:30:00Z",
            end="2026-08-18T11:00:00Z",
        )

        assert json.loads(seen[0].content)["appointmentId"] == "Appointment/137240399"


class TestErrorLegibility:
    def test_a_validation_failure_names_the_field_that_was_wrong(self) -> None:
        handler, _ = responder(
            {
                "message": "Request query failed validation",
                "issues": [{"path": "from", "message": "Invalid datetime"}],
            },
            status=400,
        )

        with pytest.raises(GatewayError) as raised:
            gateway(handler).find_free_slots(schedule_id="1", from_instant="next Tuesday")

        assert "from: Invalid datetime" in str(raised.value)

    def test_the_fhir_servers_own_diagnostics_survive(self) -> None:
        handler, _ = responder(
            {
                "message": "FHIR read Appointment/9 failed: 404 — HAPI-2001: Resource not known",
                "statusCode": 404,
            },
            status=404,
        )

        with pytest.raises(GatewayError, match="HAPI-2001"):
            gateway(handler).find_appointments(patient_id="9")

    def test_a_conflict_keeps_the_instruction_to_re_read(self) -> None:
        handler, _ = responder(
            {"message": "FHIR update failed: 409. The appointment changed — re-read it."},
            status=409,
        )

        with pytest.raises(GatewayError, match="re-read"):
            gateway(handler).reschedule(appointment_id="1", slot_id="2", start="s", end="e")

    def test_an_unreachable_gateway_says_so_rather_than_leaking_a_stack(self) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        with pytest.raises(GatewayError, match="could not reach the API gateway"):
            gateway(refuse).find_appointments(patient_id="1")

    def test_a_non_json_error_body_does_not_mask_the_status(self) -> None:
        def html(request: httpx.Request) -> httpx.Response:
            return httpx.Response(502, text="<html>Bad Gateway</html>")

        with pytest.raises(GatewayError, match="502"):
            gateway(html).find_appointments(patient_id="1")

    def test_explain_falls_back_when_there_is_no_message_field(self) -> None:
        response = httpx.Response(500, json={"unexpected": True})

        assert "500" in explain(response)


class TestSchedulingExecutor:
    def test_appointments_are_rendered_with_bare_ids(self) -> None:
        handler, _ = responder([APPOINTMENT])
        execute = make_scheduling_executor(gateway(handler))

        observation = execute(ToolCall("t1", "find_appointments", {"patient_id": "137240393"}))

        # `id=137240399`, not `Appointment/137240399`. The prefixed form in a
        # search result is what taught the model to pass prefixed ids back.
        assert "id=137240399" in observation
        assert "Appointment/137240399" not in observation

    def test_slots_are_rendered_with_bare_ids(self) -> None:
        handler, _ = responder([SLOT])
        execute = make_scheduling_executor(gateway(handler))

        observation = execute(
            ToolCall("t1", "find_availability", {"schedule_id": "1", "from_instant": "x"})
        )

        assert "Slot id=137240396" in observation

    def test_an_empty_result_says_so_in_words_the_model_can_use(self) -> None:
        handler, _ = responder([])
        execute = make_scheduling_executor(gateway(handler))

        assert "No appointments found" in execute(
            ToolCall("t1", "find_appointments", {"patient_id": "1"})
        )
        assert "No free slots" in execute(
            ToolCall("t2", "find_availability", {"schedule_id": "1", "from_instant": "x"})
        )

    def test_a_reschedule_confirms_the_new_time(self) -> None:
        handler, _ = responder({**APPOINTMENT, "start": "2026-08-18T10:30:00Z"})
        execute = make_scheduling_executor(gateway(handler))

        observation = execute(
            ToolCall(
                "t1",
                "reschedule_appointment",
                {
                    "appointment_id": "137240399",
                    "slot_id": "137240396",
                    "start": "2026-08-18T10:30:00Z",
                    "end": "2026-08-18T11:00:00Z",
                },
            )
        )

        assert observation == "Rescheduled appointment id=137240399 to 2026-08-18T10:30:00Z."

    def test_the_slot_limit_is_capped_however_large_the_model_asks_for(self) -> None:
        handler, seen = responder([SLOT])
        execute = make_scheduling_executor(gateway(handler))

        execute(
            ToolCall(
                "t1",
                "find_availability",
                {"schedule_id": "1", "from_instant": "x", "limit": 5000},
            )
        )

        assert dict(seen[0].url.params)["count"] == "10"

    def test_a_missing_argument_names_the_parameter(self) -> None:
        # The loop turns this into an error observation. `KeyError: 'patient_id'`
        # reads as an internal fault; this reads as something to fix.
        handler, _ = responder([])
        execute = make_scheduling_executor(gateway(handler))

        with pytest.raises(ValueError, match="'patient_id' argument is required"):
            execute(ToolCall("t1", "find_appointments", {}))
