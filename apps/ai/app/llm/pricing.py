"""Token pricing and cost accounting for LLM calls.

Every agent step records what it cost. This module is the single place that
turns an Anthropic ``usage`` object into dollars, so the Trace Viewer, the
``llm_usage`` table and per-tenant budget caps can never disagree with each
other.

Rates are USD per million tokens (https://platform.claude.com/docs/en/pricing).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

MILLION = 1_000_000

# Cache reads bill at ~10% of the base input rate. A cache *write* carries a
# premium that depends on TTL: 1.25x for the default 5-minute cache, 2x for the
# 1-hour cache. Multipliers are model-independent.
CACHE_READ_MULTIPLIER = 0.10
CACHE_WRITE_MULTIPLIER = {"5m": 1.25, "1h": 2.00}


@dataclass(frozen=True)
class ModelPricing:
    """USD per million tokens."""

    input_per_mtok: float
    output_per_mtok: float


@dataclass(frozen=True)
class TokenUsage:
    """The subset of Anthropic's usage object that costs money.

    Kept as our own type rather than the SDK's so cost maths is unit-testable
    without constructing SDK objects, and so a provider swap (ADR-003) does not
    ripple into the accounting layer.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0

    @classmethod
    def from_response(cls, usage: object) -> TokenUsage:
        """Read an SDK response's ``usage``; absent cache fields count as zero."""

        def field(name: str) -> int:
            return int(getattr(usage, name, 0) or 0)

        return cls(
            input_tokens=field("input_tokens"),
            output_tokens=field("output_tokens"),
            cache_read_input_tokens=field("cache_read_input_tokens"),
            cache_creation_input_tokens=field("cache_creation_input_tokens"),
        )

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_input_tokens
            + self.cache_creation_input_tokens
        )


# Base rates. Keys are the canonical model IDs; dated snapshot IDs
# (e.g. claude-haiku-4-5-20251001) resolve by longest-prefix match.
_PRICING: dict[str, ModelPricing] = {
    "claude-fable-5": ModelPricing(10.00, 50.00),
    "claude-opus-5": ModelPricing(5.00, 25.00),
    "claude-opus-4-8": ModelPricing(5.00, 25.00),
    "claude-sonnet-5": ModelPricing(3.00, 15.00),
    "claude-haiku-4-5": ModelPricing(1.00, 5.00),
}

# Sonnet 5 runs introductory pricing up to and including this date, then
# reverts to the standard rate above. Encoded rather than hardcoded so a demo
# recorded before the cutover still reconciles against its stored cost.
SONNET_5_INTRO_THROUGH = date(2026, 8, 31)
SONNET_5_INTRO = ModelPricing(2.00, 10.00)


def pricing_for(model: str, on: date) -> ModelPricing:
    """Resolve a model ID to its rate card as of ``on``.

    Raises:
        KeyError: if the model is unknown. Deliberately loud — silently pricing
            an unrecognised model at zero would understate spend precisely when
            someone has switched models without telling the billing layer.
    """
    canonical = _canonical(model)

    if canonical == "claude-sonnet-5" and on <= SONNET_5_INTRO_THROUGH:
        return SONNET_5_INTRO

    return _PRICING[canonical]


def _canonical(model: str) -> str:
    if model in _PRICING:
        return model

    # Dated snapshots extend the canonical ID: claude-haiku-4-5-20251001.
    # Longest match wins so claude-opus-5 never shadows a longer sibling.
    candidates = [key for key in _PRICING if model.startswith(key)]
    if candidates:
        return max(candidates, key=len)

    raise KeyError(f"No pricing registered for model {model!r}")


def cost_usd(
    model: str,
    usage: TokenUsage,
    *,
    on: date,
    cache_ttl: str = "5m",
) -> float:
    """Cost in USD of one model call.

    Cache reads bill at a fraction of the input rate and cache writes at a
    premium, so a naive ``(input + output)`` sum is wrong in both directions
    once prompt caching is on.
    """
    rate = pricing_for(model, on)

    try:
        write_multiplier = CACHE_WRITE_MULTIPLIER[cache_ttl]
    except KeyError:
        raise ValueError(
            f"Unknown cache_ttl {cache_ttl!r}; expected one of {sorted(CACHE_WRITE_MULTIPLIER)}"
        ) from None

    input_units = (
        usage.input_tokens
        + usage.cache_read_input_tokens * CACHE_READ_MULTIPLIER
        + usage.cache_creation_input_tokens * write_multiplier
    )

    return (
        input_units / MILLION * rate.input_per_mtok
        + usage.output_tokens / MILLION * rate.output_per_mtok
    )
