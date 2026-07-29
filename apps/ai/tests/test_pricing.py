"""Cost accounting is what the Trace Viewer, llm_usage and budget caps all read."""

from datetime import date

import pytest

from app.llm.pricing import (
    SONNET_5_INTRO_THROUGH,
    ModelPricing,
    TokenUsage,
    cost_usd,
    pricing_for,
)

# Any date inside the Sonnet 5 introductory window.
DURING_INTRO = date(2026, 7, 29)
AFTER_INTRO = date(2026, 9, 1)


class TestPricingLookup:
    def test_resolves_a_canonical_model_id(self) -> None:
        assert pricing_for("claude-opus-5", on=DURING_INTRO) == ModelPricing(5.00, 25.00)

    def test_resolves_a_dated_snapshot_id_to_its_base_model(self) -> None:
        # ANTHROPIC_MODEL_FAST in .env.example is a dated Haiku snapshot.
        assert pricing_for("claude-haiku-4-5-20251001", on=DURING_INTRO) == ModelPricing(1.00, 5.00)

    def test_sonnet_5_uses_introductory_rates_inside_the_window(self) -> None:
        assert pricing_for("claude-sonnet-5", on=DURING_INTRO) == ModelPricing(2.00, 10.00)

    def test_sonnet_5_intro_includes_the_final_day(self) -> None:
        assert pricing_for("claude-sonnet-5", on=SONNET_5_INTRO_THROUGH).input_per_mtok == 2.00

    def test_sonnet_5_reverts_the_day_after(self) -> None:
        assert pricing_for("claude-sonnet-5", on=AFTER_INTRO) == ModelPricing(3.00, 15.00)

    def test_unknown_model_raises_rather_than_pricing_at_zero(self) -> None:
        with pytest.raises(KeyError, match="gpt-4"):
            pricing_for("gpt-4", on=DURING_INTRO)


class TestCost:
    def test_zero_usage_costs_nothing(self) -> None:
        assert cost_usd("claude-opus-5", TokenUsage(), on=DURING_INTRO) == 0.0

    def test_prices_input_and_output_at_their_separate_rates(self) -> None:
        usage = TokenUsage(input_tokens=1_000_000, output_tokens=1_000_000)

        assert cost_usd("claude-opus-5", usage, on=DURING_INTRO) == pytest.approx(30.00)

    def test_matches_the_live_smoke_call(self) -> None:
        # 22 in / 10 out on claude-sonnet-5 at introductory rates.
        usage = TokenUsage(input_tokens=22, output_tokens=10)

        assert cost_usd("claude-sonnet-5", usage, on=DURING_INTRO) == pytest.approx(
            0.000144, abs=1e-9
        )

    def test_cache_reads_bill_at_a_tenth_of_the_input_rate(self) -> None:
        cached = TokenUsage(cache_read_input_tokens=1_000_000)
        fresh = TokenUsage(input_tokens=1_000_000)

        assert cost_usd("claude-opus-5", cached, on=DURING_INTRO) == pytest.approx(
            cost_usd("claude-opus-5", fresh, on=DURING_INTRO) * 0.10
        )

    def test_cache_writes_carry_a_premium_that_depends_on_ttl(self) -> None:
        usage = TokenUsage(cache_creation_input_tokens=1_000_000)

        five_min = cost_usd("claude-opus-5", usage, on=DURING_INTRO, cache_ttl="5m")
        one_hour = cost_usd("claude-opus-5", usage, on=DURING_INTRO, cache_ttl="1h")

        assert five_min == pytest.approx(5.00 * 1.25)
        assert one_hour == pytest.approx(5.00 * 2.00)

    def test_rejects_an_unknown_cache_ttl(self) -> None:
        with pytest.raises(ValueError, match="cache_ttl"):
            cost_usd("claude-opus-5", TokenUsage(), on=DURING_INTRO, cache_ttl="7m")

    def test_a_cached_turn_is_cheaper_than_the_same_turn_uncached(self) -> None:
        # The whole point of caching: same prompt, second call reads the cache.
        uncached = TokenUsage(input_tokens=50_000, output_tokens=500)
        cached = TokenUsage(input_tokens=200, cache_read_input_tokens=49_800, output_tokens=500)

        assert cost_usd("claude-opus-5", cached, on=DURING_INTRO) < cost_usd(
            "claude-opus-5", uncached, on=DURING_INTRO
        )


class TestTokenUsage:
    def test_reads_an_sdk_usage_object(self) -> None:
        class SdkUsage:
            input_tokens = 22
            output_tokens = 10
            cache_read_input_tokens = 0
            cache_creation_input_tokens = 0

        assert TokenUsage.from_response(SdkUsage()) == TokenUsage(input_tokens=22, output_tokens=10)

    def test_treats_absent_cache_fields_as_zero(self) -> None:
        class OlderUsage:
            input_tokens = 5
            output_tokens = 3

        usage = TokenUsage.from_response(OlderUsage())

        assert usage.cache_read_input_tokens == 0
        assert usage.cache_creation_input_tokens == 0

    def test_treats_null_cache_fields_as_zero(self) -> None:
        class NullCacheUsage:
            input_tokens = 5
            output_tokens = 3
            cache_read_input_tokens = None
            cache_creation_input_tokens = None

        assert TokenUsage.from_response(NullCacheUsage()).total_tokens == 8

    def test_total_tokens_counts_every_billable_bucket(self) -> None:
        usage = TokenUsage(
            input_tokens=1,
            output_tokens=2,
            cache_read_input_tokens=4,
            cache_creation_input_tokens=8,
        )

        assert usage.total_tokens == 15
