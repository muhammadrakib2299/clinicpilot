"""Executes the Follow-up Agent's tools against the gateway.

The counterpart to `followup.py`, which declares what the agent may do. The
rendering happens here rather than in the gateway on purpose: the templates are
agent behaviour, and the gateway stores what was written rather than
re-deriving it (see the `messages` table comment).
"""

from __future__ import annotations

from typing import Any

from app.agents.followup import TEMPLATES, TemplateError, render
from app.fhir.gateway import GatewayFhir
from app.llm.provider import ToolCall


def make_followup_executor(fhir: GatewayFhir, *, clinic_name: str, task_id: str | None = None):
    """Bind the tool surface to a gateway client."""

    def execute(call: ToolCall) -> str:
        args = call.arguments

        if call.name == "find_recent_visits":
            return _render_visits(
                fhir.find_appointments(
                    patient_id=_required(args, "patient_id"),
                    status=_optional(args, "status") or "fulfilled",
                )
            )

        if call.name == "list_message_templates":
            return "\n".join(
                f"{template.id}: {template.purpose} (needs {', '.join(template.fields)})"
                for template in TEMPLATES.values()
            )

        if call.name == "send_followup_message":
            values = dict(args.get("values") or {})
            # Overwritten, not defaulted. The model has no way to know the
            # tenant's name, so anything it supplies here is invented — and
            # `clinic` is a template field, which means letting it through
            # would be a hole straight into the rendered body. A test that
            # asserted `setdefault` caught this: the name said "supplied not
            # invented" and the assertion said the model's value won.
            values["clinic"] = clinic_name

            try:
                body = render(_required(args, "template_id"), values)
            except TemplateError as error:
                # The model can fix this: wrong template, or a missing value.
                raise ValueError(str(error)) from None

            recorded = fhir.record_message(
                patient_ref=_required(args, "patient_id"),
                appointment_ref=_optional(args, "appointment_id"),
                template_id=_required(args, "template_id"),
                body=body,
                task_id=task_id,
            )

            return (
                f"Recorded message id={recorded['id']} "
                f"(template {recorded['templateId']}, status {recorded['status']}):\n{body}"
            )

        return f"Tool {call.name!r} is declared but not implemented."

    return execute


def _render_visits(appointments: list[dict[str, Any]]) -> str:
    if not appointments:
        return "No matching visits for that patient."

    return "\n".join(
        f"Appointment id={visit['id']}: {visit.get('start')} "
        f"status={visit.get('status')} desc={visit.get('description') or ''}".rstrip()
        for visit in appointments
    )


def _required(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if value is None or str(value).strip() == "":
        raise ValueError(f"the {key!r} argument is required")
    return str(value)


def _optional(args: dict[str, Any], key: str) -> str | None:
    value = args.get(key)
    return str(value) if value is not None and str(value).strip() else None
