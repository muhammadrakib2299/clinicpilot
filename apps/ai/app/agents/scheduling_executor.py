"""Executes the Scheduling Agent's tools against the gateway.

The other half of `scheduling.py`: that file declares what the agent may do,
this one does it. They are separate so the tool surface — the thing that scopes
the agent — stays readable without transport code interleaved through it.

Every observation string here is prompt material. The model reads it and then
passes ids back, so how a resource is named in a search result determines what
the next tool call looks like.
"""

from __future__ import annotations

from typing import Any

from app.fhir.gateway import GatewayFhir
from app.llm.provider import ToolCall

MAX_SLOTS = 10


def make_scheduling_executor(fhir: GatewayFhir):
    """Bind the tool surface to a gateway client."""

    def execute(call: ToolCall) -> str:
        args = call.arguments

        if call.name == "find_appointments":
            return _render_appointments(
                fhir.find_appointments(
                    patient_id=_required(args, "patient_id"),
                    status=_optional_str(args, "status"),
                )
            )

        if call.name == "find_availability":
            return _render_slots(
                fhir.find_free_slots(
                    schedule_id=_required(args, "schedule_id"),
                    from_instant=_required(args, "from_instant"),
                    count=min(int(args.get("limit") or MAX_SLOTS), MAX_SLOTS),
                )
            )

        if call.name == "reschedule_appointment":
            moved = fhir.reschedule(
                appointment_id=_required(args, "appointment_id"),
                slot_id=_required(args, "slot_id"),
                start=_required(args, "start"),
                end=_required(args, "end"),
            )
            return f"Rescheduled appointment id={moved['id']} to {moved['start']}."

        # The loop already refuses tools it has no definition for; this covers a
        # definition existing with no executor branch, which is a bug in here.
        return f"Tool {call.name!r} is declared but not implemented."

    return execute


def _render_appointments(appointments: list[dict[str, Any]]) -> str:
    if not appointments:
        return "No appointments found for that patient."

    # `id=137240399`, not `Appointment/137240399`. The prefixed form is how the
    # model learned to pass prefixed ids back — it was quoting the search
    # results it had just been given. Both forms are accepted downstream now,
    # but showing the bare one removes the confusion instead of absorbing it.
    return "\n".join(
        f"Appointment id={appointment['id']}: {appointment.get('start')} to "
        f"{appointment.get('end')} status={appointment.get('status')} "
        f"desc={appointment.get('description') or ''}".rstrip()
        for appointment in appointments
    )


def _render_slots(slots: list[dict[str, Any]]) -> str:
    if not slots:
        return "No free slots on that schedule."

    return "\n".join(f"Slot id={slot['id']}: {slot['start']} to {slot['end']}" for slot in slots)


def _required(args: dict[str, Any], key: str) -> str:
    """Missing arguments become a message the model can fix, not a KeyError.

    The loop would catch a KeyError and report it, but `KeyError: 'patient_id'`
    reads as an internal fault. Naming the parameter tells the model what to do.
    """
    value = args.get(key)
    if value is None or str(value).strip() == "":
        raise ValueError(f"the {key!r} argument is required")
    return str(value)


def _optional_str(args: dict[str, Any], key: str) -> str | None:
    value = args.get(key)
    return str(value) if value is not None and str(value).strip() else None
