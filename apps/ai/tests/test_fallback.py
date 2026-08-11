"""Model fallback (ADR-003).

The mechanism is trivial; the classification is the design. Every test here is
about *which* failures are worth a second attempt, because falling back
indiscriminately doubles the bill on a request that was always going to fail,
and falling back on nothing lets a rate limit end a patient's conversation.
"""

from __future__ import annotations

import pytest

from app.llm.fallback_provider import AllProvidersFailedError, FallbackProvider, is_transient
from app.llm.pricing import TokenUsage
from app.llm.provider import LlmResponse


def reply(model: str) -> LlmResponse:
    return LlmResponse(
        text=f"served by {model}",
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=10, output_tokens=5),
        model=model,
    )


class Stub:
    """A provider that answers, or raises whatever it was given."""

    def __init__(self, name: str, *, raises: Exception | None = None) -> None:
        self.name = name
        self.model = name
        self.raises = raises
        self.calls = 0

    def complete(self, **_kwargs: object) -> LlmResponse:
        self.calls += 1
        if self.raises:
            raise self.raises
        return reply(self.name)


def named(name: str, **attrs: object) -> Exception:
    """An exception of an arbitrary class name, as an SDK would raise."""
    return type(name, (Exception,), attrs)("boom")


class TestClassification:
    @pytest.mark.parametrize(
        "error",
        ["APIConnectionError", "APITimeoutError", "RateLimitError", "OverloadedError"],
    )
    def test_unreachable_or_overloaded_is_worth_retrying(self, error: str) -> None:
        assert is_transient(named(error)) is True

    @pytest.mark.parametrize(
        "error",
        ["AuthenticationError", "BadRequestError", "PermissionDeniedError", "NotFoundError"],
    )
    def test_a_wrong_request_is_not(self, error: str) -> None:
        # The next provider fails the same way, slower and for more money.
        assert is_transient(named(error)) is False

    @pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
    def test_status_codes_are_read_when_present(self, status: int) -> None:
        assert is_transient(named("APIStatusError", status_code=status)) is True

    @pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
    def test_client_error_statuses_are_permanent(self, status: int) -> None:
        assert is_transient(named("APIStatusError", status_code=status)) is False

    def test_the_status_wins_over_the_class_name(self) -> None:
        # SDKs raise a generic error class for anything they do not model, so
        # the status is the more reliable signal when both exist.
        assert is_transient(named("APIStatusError", status_code=401)) is False

    def test_an_unrecognised_error_is_not_retried(self) -> None:
        # Conservative: an unknown failure might be deterministic, and retrying
        # it costs a second conversation to learn nothing.
        assert is_transient(ValueError("something else")) is False


class TestFallbackProvider:
    def test_uses_the_primary_when_it_answers(self) -> None:
        primary, secondary = Stub("primary"), Stub("secondary")

        response = FallbackProvider([primary, secondary]).complete(system="s", turns=[], tools=[])

        assert response.model == "primary"
        assert secondary.calls == 0

    def test_falls_over_when_the_primary_is_overloaded(self) -> None:
        primary = Stub("primary", raises=named("OverloadedError"))
        secondary = Stub("secondary")

        response = FallbackProvider([primary, secondary]).complete(system="s", turns=[], tools=[])

        assert response.model == "secondary"
        assert secondary.calls == 1

    def test_does_not_fall_over_on_a_bad_request(self) -> None:
        primary = Stub("primary", raises=named("BadRequestError"))
        secondary = Stub("secondary")

        with pytest.raises(Exception, match="boom"):
            FallbackProvider([primary, secondary]).complete(system="s", turns=[], tools=[])

        assert secondary.calls == 0

    def test_raises_a_combined_error_when_everything_is_down(self) -> None:
        # "The model is down" and "the model and its backup are down" are
        # different operational situations.
        providers = [
            Stub("primary", raises=named("OverloadedError")),
            Stub("secondary", raises=named("APIConnectionError")),
        ]

        with pytest.raises(AllProvidersFailedError) as raised:
            FallbackProvider(providers).complete(system="s", turns=[], tools=[])

        assert len(raised.value.failures) == 2
        assert "primary" in str(raised.value)
        assert "secondary" in str(raised.value)

    def test_the_response_names_the_model_that_actually_served_it(self) -> None:
        # Cost accounting reads this field. A run that fell back to a cheaper
        # model must not be billed at the expensive rate.
        response = FallbackProvider(
            [Stub("expensive", raises=named("RateLimitError")), Stub("cheap")]
        ).complete(system="s", turns=[], tools=[])

        assert response.model == "cheap"

    def test_tries_a_third_provider_if_two_are_down(self) -> None:
        third = Stub("third")
        providers = [
            Stub("first", raises=named("OverloadedError")),
            Stub("second", raises=named("APITimeoutError")),
            third,
        ]

        FallbackProvider(providers).complete(system="s", turns=[], tools=[])

        assert third.calls == 1

    def test_refuses_to_be_built_with_no_providers(self) -> None:
        with pytest.raises(ValueError, match="at least one"):
            FallbackProvider([])

    def test_reports_the_chain_in_its_name(self) -> None:
        chain = FallbackProvider([Stub("primary"), Stub("secondary")])

        assert chain.name == "primary+secondary"
