"""The Follow-up Agent, and the template boundary that scopes it.

The point of the templates is that a clinic can review four of them. It cannot
review every sentence a model might generate, and "the model usually phrases
things well" is not a governance position when the output goes to a patient.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.agents.followup import FOLLOWUP_TOOLS, SYSTEM_PROMPT, TEMPLATES, TemplateError, render
from app.agents.followup_executor import make_followup_executor
from app.fhir.gateway import GatewayFhir
from app.llm.provider import ToolCall

CLINIC = "Northside Family Clinic"

VISIT = {
    "id": "137240399",
    "status": "fulfilled",
    "start": "2026-08-13T14:00:00Z",
    "end": "2026-08-13T14:30:00Z",
    "description": "Routine follow-up",
}


def gateway(handler) -> GatewayFhir:
    return GatewayFhir(
        base_url="http://gw.test", client=httpx.Client(transport=httpx.MockTransport(handler))
    )


def responder(payload, status: int = 200):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=payload)

    return handler, seen


class TestTemplates:
    def test_every_template_declares_the_fields_its_body_uses(self) -> None:
        # A placeholder the caller is never asked for renders as "{first_name}"
        # on somebody's phone.
        for template in TEMPLATES.values():
            for field in template.fields:
                assert "{" + field + "}" in template.body, template.id

    def test_no_template_states_a_clinical_result(self) -> None:
        # `results_ready` exists precisely to say results are back *without*
        # saying what they are.
        body = TEMPLATES["results_ready"].body.lower()
        assert "cannot share results" in body

    def test_rendering_fills_the_placeholders(self) -> None:
        body = render(
            "post_visit_check_in",
            {"first_name": "Priya", "clinic": CLINIC, "visit_date": "13 August 2026"},
        )

        assert "Priya" in body and CLINIC in body and "13 August 2026" in body
        assert "{" not in body

    def test_an_unknown_template_is_refused_by_name(self) -> None:
        with pytest.raises(TemplateError, match="No template"):
            render("improvise_something_nice", {})

    def test_a_missing_value_is_refused_rather_than_rendered_blank(self) -> None:
        with pytest.raises(TemplateError, match="first_name"):
            render("post_visit_check_in", {"clinic": CLINIC, "visit_date": "today"})

    def test_extra_values_cannot_smuggle_text_into_the_body(self) -> None:
        # The template is the contract. An unexpected key is dropped, not
        # appended.
        body = render(
            "post_visit_check_in",
            {
                "first_name": "Priya",
                "clinic": CLINIC,
                "visit_date": "today",
                "postscript": "and here is some unreviewed text",
            },
        )

        assert "unreviewed" not in body


class TestToolSurface:
    def test_only_sending_is_marked_as_mutating(self) -> None:
        assert [t.name for t in FOLLOWUP_TOOLS if t.mutates] == ["send_followup_message"]

    def test_the_agent_has_no_tool_that_writes_free_text(self) -> None:
        # Capability is bounded by the tool surface, not by the prompt asking
        # nicely — the same principle that scopes the Scheduling Agent.
        send = next(t for t in FOLLOWUP_TOOLS if t.name == "send_followup_message")
        properties = send.input_schema["properties"]

        assert "body" not in properties
        assert "message" not in properties
        assert properties["template_id"]["enum"] == sorted(TEMPLATES)

    def test_the_prompt_forbids_clinical_advice_and_improvising(self) -> None:
        lowered = SYSTEM_PROMPT.lower()

        assert "never give clinical" in lowered
        assert "do not improvise" in lowered


class TestExecutor:
    def test_recent_visits_are_rendered_with_bare_ids(self) -> None:
        handler, seen = responder([VISIT])
        execute = make_followup_executor(gateway(handler), clinic_name=CLINIC)

        observation = execute(ToolCall("t1", "find_recent_visits", {"patient_id": "137240393"}))

        assert "Appointment id=137240399" in observation
        assert dict(seen[0].url.params)["status"] == "fulfilled"

    def test_it_defaults_to_fulfilled_visits(self) -> None:
        handler, seen = responder([])
        execute = make_followup_executor(gateway(handler), clinic_name=CLINIC)

        execute(ToolCall("t1", "find_recent_visits", {"patient_id": "1"}))

        assert dict(seen[0].url.params)["status"] == "fulfilled"

    def test_listing_templates_tells_the_model_what_each_one_needs(self) -> None:
        handler, _ = responder([])
        execute = make_followup_executor(gateway(handler), clinic_name=CLINIC)

        listed = execute(ToolCall("t1", "list_message_templates", {}))

        assert "post_visit_check_in" in listed
        assert "first_name" in listed

    def test_sending_records_the_rendered_body(self) -> None:
        handler, seen = responder(
            {"id": "m-1", "templateId": "post_visit_check_in", "status": "drafted"}
        )
        execute = make_followup_executor(gateway(handler), clinic_name=CLINIC, task_id="task-1")

        observation = execute(
            ToolCall(
                "t1",
                "send_followup_message",
                {
                    "patient_id": "137240393",
                    "appointment_id": "137240399",
                    "template_id": "post_visit_check_in",
                    "values": {"first_name": "Priya", "visit_date": "13 August 2026"},
                },
            )
        )

        body = json.loads(seen[0].content)
        assert seen[0].url.path == "/api/internal/messages"
        assert "Priya" in body["body"] and CLINIC in body["body"]
        assert body["taskId"] == "task-1"
        assert "m-1" in observation

    def test_the_clinic_name_is_supplied_not_invented(self) -> None:
        # The model has no way to know the tenant's name, and guessing puts the
        # wrong clinic's name on a message to a patient.
        handler, seen = responder({"id": "m-1", "templateId": "x", "status": "drafted"})
        execute = make_followup_executor(gateway(handler), clinic_name="Riverside Medical Group")

        execute(
            ToolCall(
                "t1",
                "send_followup_message",
                {
                    "patient_id": "1",
                    "template_id": "post_visit_check_in",
                    "values": {
                        "first_name": "Sam",
                        "visit_date": "today",
                        "clinic": "Wrong Clinic",
                    },
                },
            )
        )

        body = json.loads(seen[0].content)
        assert "Riverside Medical Group" in body["body"]
        assert "Wrong Clinic" not in body["body"]

    def test_a_bad_template_becomes_an_error_the_model_can_fix(self) -> None:
        handler, _ = responder({})
        execute = make_followup_executor(gateway(handler), clinic_name=CLINIC)

        with pytest.raises(ValueError, match="No template"):
            execute(
                ToolCall(
                    "t1",
                    "send_followup_message",
                    {"patient_id": "1", "template_id": "nope", "values": {}},
                )
            )

    def test_a_missing_placeholder_value_names_the_field(self) -> None:
        handler, _ = responder({})
        execute = make_followup_executor(gateway(handler), clinic_name=CLINIC)

        with pytest.raises(ValueError, match="first_name"):
            execute(
                ToolCall(
                    "t1",
                    "send_followup_message",
                    {
                        "patient_id": "1",
                        "template_id": "post_visit_check_in",
                        "values": {"visit_date": "today"},
                    },
                )
            )
