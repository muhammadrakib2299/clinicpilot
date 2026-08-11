"""LLM provider layer: pricing, the provider interface, and its decorators.

`AnthropicProvider` is the only thing here that talks to a vendor. Everything
else wraps a provider and returns one, so safety and resilience compose:

    RedactingProvider(FallbackProvider([primary, secondary]), redactor)

Redaction outermost, deliberately — a fallback must not become a path that
skips it.
"""

from app.llm.fallback_provider import AllProvidersFailedError, FallbackProvider, is_transient
from app.llm.pricing import ModelPricing, TokenUsage, cost_usd, pricing_for
from app.llm.redacting_provider import RedactingProvider

__all__ = [
    "AllProvidersFailedError",
    "FallbackProvider",
    "ModelPricing",
    "RedactingProvider",
    "TokenUsage",
    "cost_usd",
    "is_transient",
    "pricing_for",
]
