"""Try a second model when the first is unavailable (ADR-003).

The interesting question is not "how do I call another provider" — it is
*which failures are worth failing over on*. Falling back indiscriminately turns
a bad request into two bad requests and doubles the bill; falling back on
nothing means a rate limit ends a patient's conversation.

So the rule is narrow: fail over when the model was **unreachable or refused
for capacity reasons**, and not otherwise. An authentication error means the
key is wrong, and it will be wrong for the next provider too if they share
configuration. A validation error means the request is malformed, and sending
the same malformed request elsewhere is just slower.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from app.llm.provider import LlmProvider, LlmResponse, ToolDefinition, Turn

logger = logging.getLogger(__name__)


class AllProvidersFailedError(Exception):
    """Every provider in the chain refused.

    Carries the whole list, because "the model is down" and "the model is down
    and so is the backup" are different operational situations and the second
    one should not be reported as the first.
    """

    def __init__(self, failures: Sequence[tuple[str, Exception]]) -> None:
        detail = "; ".join(f"{name}: {type(error).__name__}: {error}" for name, error in failures)
        super().__init__(f"all {len(failures)} providers failed — {detail}")
        self.failures = list(failures)


# Matched against the exception's class name, so this works for any SDK without
# importing it. Anthropic and OpenAI both use these names; a provider that does
# not is handled by the status-code check below.
TRANSIENT_ERROR_NAMES = frozenset(
    {
        "APIConnectionError",
        "APITimeoutError",
        "InternalServerError",
        "RateLimitError",
        "ServiceUnavailableError",
        "OverloadedError",
        "APIStatusError",
    }
)

TRANSIENT_STATUS = frozenset({408, 409, 429, 500, 502, 503, 504})

# Never failed over. Retrying these elsewhere cannot help and can cost money.
PERMANENT_ERROR_NAMES = frozenset(
    {
        "AuthenticationError",
        "PermissionDeniedError",
        "BadRequestError",
        "NotFoundError",
        "UnprocessableEntityError",
    }
)


def is_transient(error: Exception) -> bool:
    """Whether trying a different provider could plausibly help."""
    name = type(error).__name__

    if name in PERMANENT_ERROR_NAMES:
        return False

    status = getattr(error, "status_code", None)
    if isinstance(status, int):
        # The status is more reliable than the class name when both exist —
        # SDKs raise a generic APIStatusError for anything they do not model.
        return status in TRANSIENT_STATUS

    return name in TRANSIENT_ERROR_NAMES


class FallbackProvider:
    """Calls each provider in order until one answers.

    The `model` reported on a response is the one that actually served it, not
    the one configured — cost accounting reads that field, and a run that fell
    back to a cheaper model must not be billed at the expensive rate.
    """

    def __init__(self, providers: Sequence[LlmProvider]) -> None:
        if not providers:
            raise ValueError("FallbackProvider needs at least one provider")

        self._providers = list(providers)
        self.attempts: list[str] = []

    @property
    def name(self) -> str:
        return "+".join(provider.name for provider in self._providers)

    @property
    def model(self) -> str:
        """The primary. What a response was *actually* served by is on the
        response itself, which is what the pricing layer reads."""
        return self._providers[0].model

    def complete(
        self,
        *,
        system: str,
        turns: list[Turn],
        tools: list[ToolDefinition],
        max_tokens: int = 16_000,
    ) -> LlmResponse:
        failures: list[tuple[str, Exception]] = []

        for index, provider in enumerate(self._providers):
            try:
                response = provider.complete(
                    system=system, turns=turns, tools=tools, max_tokens=max_tokens
                )
            except Exception as error:  # noqa: BLE001 — classified immediately below
                is_last = index == len(self._providers) - 1

                if not is_transient(error):
                    # Permanent: stop. The next provider would fail the same
                    # way, and an auth error masquerading as an outage sends
                    # somebody looking at the wrong dashboard.
                    logger.error(
                        "%s failed permanently, not falling over: %s", provider.name, error
                    )
                    raise

                failures.append((provider.name, error))
                logger.warning(
                    "%s unavailable (%s); %s",
                    provider.name,
                    type(error).__name__,
                    "no providers left" if is_last else "trying the next provider",
                )

                if is_last:
                    raise AllProvidersFailedError(failures) from error
                continue

            if index > 0:
                logger.warning(
                    "served by fallback provider %s after %d failure(s)",
                    provider.name,
                    index,
                )

            self.attempts.append(provider.name)
            return response

        raise AllProvidersFailedError(failures)
