"""Tool surface for the Follow-up Agent.

Post-visit contact: checking how someone is doing after an appointment, and
medication adherence reminders.

**The agent cannot write to a patient in its own words.** It picks an approved
template and supplies the values that fill it. That is the central design
choice here, and it is the same principle that scopes the Scheduling Agent —
capability is bounded by the tool surface rather than by asking the prompt
nicely. A clinic can review four templates; it cannot review every sentence a
model might generate, and "the model usually phrases things well" is not a
governance position when the output goes to a patient.

The cost is real: the agent cannot respond to something a template does not
cover. That is what escalation is for.

**What this does and does not constrain.** The wording around a value is fixed
and reviewable; the values themselves are model-supplied, so a name or a date
can still be wrong. It bounds the shape of patient communication, not its
accuracy — accuracy is what `find_recent_visits` and the pre-write self-check
are for. Fields the system knows (the clinic's own name) are overwritten by the
executor rather than trusted, because anything the model supplies there is
invented by definition.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.llm.provider import ToolDefinition


@dataclass(frozen=True)
class Template:
    id: str
    purpose: str
    body: str
    #: Placeholder names the caller must supply. Checked at render time, so a
    #: missing value is an error the model can fix rather than the string
    #: "{first_name}" arriving on someone's phone.
    fields: tuple[str, ...]


TEMPLATES: dict[str, Template] = {
    "post_visit_check_in": Template(
        id="post_visit_check_in",
        purpose="General check-in a few days after a routine appointment.",
        body=(
            "Hello {first_name}, this is {clinic} following up on your appointment "
            "on {visit_date}. How have you been feeling since then? Reply to this "
            "message and a member of the team will read it. If anything has got "
            "worse, please contact us or call 111."
        ),
        fields=("first_name", "clinic", "visit_date"),
    ),
    "medication_adherence": Template(
        id="medication_adherence",
        purpose="Reminder to keep taking a medication started or changed at a visit.",
        body=(
            "Hello {first_name}, a reminder from {clinic} to keep taking the "
            "medication discussed at your appointment on {visit_date}. If you have "
            "stopped, or you are having side effects, reply and we will arrange a "
            "review. Please do not change the dose without speaking to us."
        ),
        fields=("first_name", "clinic", "visit_date"),
    ),
    "missed_appointment": Template(
        id="missed_appointment",
        purpose="Offer to rebook after a missed appointment.",
        body=(
            "Hello {first_name}, we missed you at your appointment on {visit_date}. "
            "No problem at all — reply to this message and {clinic} will help you "
            "find another time."
        ),
        fields=("first_name", "clinic", "visit_date"),
    ),
    "results_ready": Template(
        id="results_ready",
        purpose=(
            "Tell someone results are available and they should book a call. "
            "Never states what the results are."
        ),
        body=(
            "Hello {first_name}, your results from {visit_date} are back and "
            "{clinic} would like to discuss them with you. Please reply to arrange "
            "a call. We cannot share results by message."
        ),
        fields=("first_name", "clinic", "visit_date"),
    ),
}


class TemplateError(ValueError):
    """The template does not exist, or its values are wrong."""


def render(template_id: str, values: dict[str, str]) -> str:
    """Fill a template, refusing anything it was not designed for."""
    template = TEMPLATES.get(template_id)
    if template is None:
        raise TemplateError(
            f"No template {template_id!r}. Available: {', '.join(sorted(TEMPLATES))}."
        )

    missing = [field for field in template.fields if not values.get(field)]
    if missing:
        raise TemplateError(f"Template {template_id!r} needs values for: {', '.join(missing)}.")

    # Only declared fields are substituted. An extra value is silently ignored
    # rather than smuggled into the body — the template is the contract.
    return template.body.format(**{field: values[field] for field in template.fields})


SYSTEM_PROMPT = """\
You are the Follow-up Agent for a family medicine clinic. You contact patients \
after their appointments.

Working rules:
- Never give clinical, diagnostic, or medication advice, and never tell a \
patient what a result says. If a message needs any of that, stop and say it is \
going to clinic staff.
- Look up the patient's recent appointments before writing anything. Do not \
guess at what they were seen for or when.
- You may only send an approved template. If none of them fits the situation, \
say so and stop — do not improvise a message.
- Send at most one message per patient per request.
- Confirm in your final answer which template you used and what it said.
"""

FIND_RECENT_VISITS = ToolDefinition(
    name="find_recent_visits",
    description=(
        "Look up a patient's recent appointments so a follow-up refers to a real "
        "visit. Call this before drafting anything."
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
                "enum": ["fulfilled", "cancelled", "noshow", "booked"],
                "description": (
                    "Which visits to look at. 'fulfilled' for a post-visit "
                    "check-in, 'noshow' to offer a rebooking."
                ),
            },
        },
        "required": ["patient_id"],
    },
)

LIST_TEMPLATES = ToolDefinition(
    name="list_message_templates",
    description=(
        "List the approved message templates and the values each one needs. "
        "You may only send one of these — you cannot write your own message."
    ),
    input_schema={"type": "object", "properties": {}},
)

SEND_FOLLOWUP = ToolDefinition(
    name="send_followup_message",
    description=(
        "Record an approved follow-up message for a patient. Call this once, "
        "after checking their recent visits and choosing a template."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "patient_id": {
                "type": "string",
                "description": "Bare FHIR Patient id, e.g. '137240393'.",
            },
            "template_id": {
                "type": "string",
                "enum": sorted(TEMPLATES),
                "description": "Which approved template to send.",
            },
            "values": {
                "type": "object",
                "description": (
                    "Values for the template's placeholders, e.g. "
                    '{"first_name": "Priya", "clinic": "Northside Family Clinic", '
                    '"visit_date": "13 August 2026"}. Take these from the visit '
                    "you looked up; do not invent a date."
                ),
                "additionalProperties": {"type": "string"},
            },
            "appointment_id": {
                "type": "string",
                "description": "Bare id of the visit this follows up on, if there is one.",
            },
        },
        "required": ["patient_id", "template_id", "values"],
    },
    # The only tool here that reaches a patient. Traced as `action`, and the
    # one the self-check runs against before it fires.
    mutates=True,
)

FOLLOWUP_TOOLS = [FIND_RECENT_VISITS, LIST_TEMPLATES, SEND_FOLLOWUP]
