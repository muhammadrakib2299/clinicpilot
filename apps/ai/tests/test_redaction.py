"""De-identification before the model sees anything (ADR-006).

The tests that matter here are the negative ones. A redactor that removes too
much breaks the agent silently — a scheduling agent whose dates have been
scrubbed produces confident nonsense — so "what survives" is asserted as
carefully as "what goes".
"""

from __future__ import annotations

import pytest

from app.llm.pricing import TokenUsage
from app.llm.provider import (
    AssistantTurn,
    LlmResponse,
    RecordedProvider,
    ToolCall,
    ToolResult,
    ToolResultTurn,
    UserTurn,
)
from app.llm.redacting_provider import RedactingProvider
from app.safety.redaction import Redactor


class TestWhatIsRemoved:
    def test_email(self) -> None:
        assert "priya@example.com" not in Redactor().redact("mail me at priya@example.com")

    @pytest.mark.parametrize(
        "number",
        ["+15550100", "+44 20 7946 0958", "(555) 010-0199", "555-010-0199"],
    )
    def test_phone_in_its_common_shapes(self, number: str) -> None:
        redacted = Redactor().redact(f"call {number} please")

        assert number not in redacted
        assert "[PHONE_1]" in redacted

    def test_social_security_and_nhs_numbers(self) -> None:
        redacted = Redactor().redact("ssn 123-45-6789 nhs 943 476 5919")

        assert "123-45-6789" not in redacted
        assert "943 476 5919" not in redacted

    def test_a_name_the_caller_already_knows(self) -> None:
        # The only way names get caught: exact match on a value the system
        # fetched from FHIR. No regex finds names without also finding half
        # the dictionary.
        redactor = Redactor.for_patient(NAME="Priya Nair")

        assert "Priya" not in redactor.redact("Priya Nair would like to reschedule")

    def test_the_longest_known_value_wins(self) -> None:
        # Redacting "Priya" first would leave "Nair" sitting in the prompt.
        redactor = Redactor.for_patient(FIRST="Priya", FULL="Priya Nair")

        assert "Nair" not in redactor.redact("patient Priya Nair")

    def test_optional_known_values_can_be_omitted(self) -> None:
        redactor = Redactor.for_patient(NAME="Priya Nair", DOB=None, ADDRESS="")

        assert redactor.redact("Priya Nair") == "[NAME_1]"


class TestWhatSurvives:
    def test_fhir_resource_ids(self) -> None:
        # The agent addresses everything by id. Redacting these does not make
        # the product safer, it makes it non-functional — and the ids point at
        # synthetic data on a public sandbox.
        text = "patient id 137240393, appointment 137240399, schedule 137240394"

        assert Redactor().redact(text) == text

    def test_dates_and_times(self) -> None:
        # This is a scheduling product. Dates are the payload.
        text = "move it from 2026-08-13T14:00:00Z to 2026-08-18T10:30:00Z; today is 2026-08-11"

        assert Redactor().redact(text) == text

    def test_ordinary_prose(self) -> None:
        text = "I need to move my Thursday appointment to next week, please."

        assert Redactor().redact(text) == text


class TestStabilityAndRestoration:
    def test_the_same_value_always_gets_the_same_placeholder(self) -> None:
        # Otherwise the model cannot tell whether two mentions are one person.
        redactor = Redactor()
        redacted = redactor.redact("ring +15550100 or +15550100 again")

        assert redacted.count("[PHONE_1]") == 2
        assert redactor.redacted_count == 1

    def test_different_values_get_different_placeholders(self) -> None:
        redactor = Redactor()
        redacted = redactor.redact("a@x.com and b@y.com")

        assert "[EMAIL_1]" in redacted
        assert "[EMAIL_2]" in redacted

    def test_placeholders_are_stable_across_calls(self) -> None:
        # One conversation, many turns: turn three must use the same label as
        # turn one or the model sees two different people.
        redactor = Redactor()
        first = redactor.redact("call +15550100")
        second = redactor.redact("still +15550100")

        assert first.split()[-1] == second.split()[-1]

    def test_restore_is_lossless(self) -> None:
        redactor = Redactor.for_patient(NAME="Priya Nair")
        original = "Priya Nair, +15550100, priya@example.com, id 137240393, 2026-08-13"

        assert redactor.restore(redactor.redact(original)) == original

    def test_restore_reaches_into_nested_tool_arguments(self) -> None:
        # Tools act on the real world; a literal "[PHONE_1]" reaching one would
        # be worse than not redacting at all.
        redactor = Redactor()
        redactor.redact("+15550100")

        restored = redactor.restore_deep(
            {"to": "[PHONE_1]", "cc": ["[PHONE_1]"], "count": 2, "flag": True}
        )

        assert restored == {"to": "+15550100", "cc": ["+15550100"], "count": 2, "flag": True}

    def test_restoring_with_nothing_redacted_changes_nothing(self) -> None:
        assert Redactor().restore("plain text") == "plain text"


def reply(text: str) -> LlmResponse:
    return LlmResponse(
        text=text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=10, output_tokens=5),
        model="claude-sonnet-5",
    )


class TestRedactingProvider:
    """The decorator is the actual boundary; the Redactor is just a tool."""

    def test_the_model_never_sees_the_identifier(self) -> None:
        inner = RecordedProvider(responses=[reply("done")])
        provider = RedactingProvider(inner, Redactor.for_patient(NAME="Priya Nair"))

        provider.complete(
            system="s",
            turns=[UserTurn(text="Priya Nair on +15550100")],
            tools=[],
        )

        sent = inner.calls[0]["turns"][0].text
        assert "Priya Nair" not in sent
        assert "+15550100" not in sent
        assert "[NAME_1]" in sent

    def test_tool_results_are_redacted_too(self) -> None:
        # Where PHI most often enters: a search result, not the user's message.
        inner = RecordedProvider(responses=[reply("ok")])
        provider = RedactingProvider(inner, Redactor())

        provider.complete(
            system="s",
            turns=[ToolResultTurn(results=(ToolResult("t1", "phone +15550100"),))],
            tools=[],
        )

        assert "+15550100" not in inner.calls[0]["turns"][0].results[0].content

    def test_assistant_text_is_re_redacted_on_the_way_back_in(self) -> None:
        # `complete` restores text for the human; the next request must not
        # carry the restored copy back out.
        redactor = Redactor()
        redactor.redact("+15550100")
        inner = RecordedProvider(responses=[reply("ok")])
        provider = RedactingProvider(inner, redactor)

        provider.complete(
            system="s",
            turns=[AssistantTurn(text="I will call +15550100")],
            tools=[],
        )

        assert "+15550100" not in inner.calls[0]["turns"][0].text

    def test_the_reply_is_restored_for_the_human(self) -> None:
        redactor = Redactor.for_patient(NAME="Priya Nair")
        inner = RecordedProvider(responses=[reply("Booked for [NAME_1].")])
        provider = RedactingProvider(inner, redactor)

        redactor.redact("Priya Nair")
        response = provider.complete(system="s", turns=[], tools=[])

        assert response.text == "Booked for Priya Nair."

    def test_tool_arguments_come_back_restored(self) -> None:
        redactor = Redactor()
        redactor.redact("+15550100")
        inner = RecordedProvider(
            responses=[
                LlmResponse(
                    text="",
                    tool_calls=(ToolCall("t1", "send_sms", {"to": "[PHONE_1]"}),),
                    stop_reason="tool_use",
                    usage=TokenUsage(),
                    model="claude-sonnet-5",
                )
            ]
        )

        response = RedactingProvider(inner, redactor).complete(system="s", turns=[], tools=[])

        assert response.tool_calls[0].arguments == {"to": "+15550100"}

    def test_it_reports_itself_as_wrapping(self) -> None:
        provider = RedactingProvider(RecordedProvider(responses=[]), Redactor())

        assert provider.name == "redacted:recorded"
