"""Tool surface for the Scheduling Agent.

Scoped deliberately narrowly. The agent books, moves and confirms appointments;
it has no tool that could answer a clinical question, so it cannot drift into
one however the patient phrases the request. Anything outside this surface is
an escalation to a human by construction, not by prompt instruction.
"""

from __future__ import annotations

from app.llm.provider import ToolDefinition

SYSTEM_PROMPT = """\
You are the Scheduling Agent for a family medicine clinic. You handle \
appointment logistics only: finding existing appointments, offering open slots, \
and rescheduling or cancelling on the patient's request.

Working rules:
- Never give clinical, diagnostic, or medication advice. If the patient raises a \
symptom or a clinical question, say you are handing it to clinic staff and stop.
- Look up the patient's current appointment before proposing anything. Do not \
guess at times or assume what is on the calendar.
- Offer real slots returned by the tools. Never invent an availability.
- Confirm the specific date and time in your final message so the patient can \
check it.
- Reschedule only when the patient has clearly chosen a time. If the request is \
ambiguous, ask rather than picking for them.
"""

FIND_APPOINTMENTS = ToolDefinition(
    name="find_appointments",
    description=(
        "Look up a patient's appointments. Call this before offering to change "
        "anything, so you are working from what is actually booked."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "patient_id": {
                "type": "string",
                "description": (
                    "Bare FHIR Patient id with no resource-type prefix — "
                    "'137240393', not 'Patient/137240393'."
                ),
            },
            "status": {
                "type": "string",
                "enum": ["booked", "pending", "arrived", "fulfilled", "cancelled"],
                "description": "Optional status filter. Use 'booked' for upcoming visits.",
            },
        },
        "required": ["patient_id"],
    },
)

FIND_AVAILABILITY = ToolDefinition(
    name="find_availability",
    description=(
        "List free appointment slots on a provider's schedule from a given "
        "instant onwards. Call this whenever the patient needs a new time."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "schedule_id": {
                "type": "string",
                "description": (
                    "Bare FHIR Schedule id with no resource-type prefix — "
                    "'137240394', not 'Schedule/137240394'."
                ),
            },
            "from_instant": {
                "type": "string",
                "description": "ISO 8601 UTC instant, e.g. '2026-08-01T00:00:00Z'.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum slots to return. Defaults to 10.",
            },
        },
        "required": ["schedule_id", "from_instant"],
    },
)

RESCHEDULE_APPOINTMENT = ToolDefinition(
    name="reschedule_appointment",
    description=(
        "Move an existing appointment to a new time. Only call this once the "
        "patient has chosen a specific slot returned by find_availability."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "appointment_id": {
                "type": "string",
                "description": (
                    "Bare FHIR Appointment id with no resource-type prefix — "
                    "'137240399', not 'Appointment/137240399'."
                ),
            },
            "slot_id": {
                "type": "string",
                "description": (
                    "Bare id of the free Slot the patient chose, no resource-type "
                    "prefix — '137240396', not 'Slot/137240396'."
                ),
            },
            "start": {"type": "string", "description": "ISO 8601 UTC start instant."},
            "end": {"type": "string", "description": "ISO 8601 UTC end instant."},
        },
        "required": ["appointment_id", "slot_id", "start", "end"],
    },
    # The only tool here that changes the world — traced as `action`, and the
    # one call a human reviewing the audit log actually cares about.
    mutates=True,
)

SCHEDULING_TOOLS = [FIND_APPOINTMENTS, FIND_AVAILABILITY, RESCHEDULE_APPOINTMENT]
