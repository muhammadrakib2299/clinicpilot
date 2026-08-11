# ADR-003 — Provider abstraction with fallback

- **Status:** Accepted
- **Date:** 2026-08-11
- **Relates to:** [ADR-006](./ADR-006-phi-redaction-before-model-calls.md) (the
  other provider decorator)

## Context

The agent loop makes a model call per iteration and a failed call ends a
patient's conversation. Anthropic returns 429 under load and 529 when
overloaded; both are transient and both are survivable if something tries
again somewhere else.

`LlmProvider` has been a Protocol since Phase 1, with `RecordedProvider` as a
second implementation, so the abstraction already exists and is already proven
by every test in the suite running against it. What was missing was the
failover.

## Decision

**`FallbackProvider` takes an ordered list of providers and tries each in turn,
but only for failures where trying again could plausibly help.**

The default chain is the configured model followed by `ANTHROPIC_MODEL_FAST` —
a second Anthropic model, not a second vendor.

## Rationale

### The classification is the design

The mechanism is a loop. The decision is which errors are worth a second
attempt:

| Failure | Fail over | Why |
|---|---|---|
| Connection, timeout, 5xx, 429 | yes | The request was fine; the endpoint was not |
| 401, 403 | no | The key is wrong, and it will be wrong for the next provider too |
| 400, 404, 422 | no | The request is malformed; sending it elsewhere is slower and dearer |
| Anything unrecognised | no | It may be deterministic, and retrying costs a conversation to learn nothing |

Falling back indiscriminately turns one doomed request into several. Falling
back on nothing means a rate limit ends a conversation. Neither is a policy.

The status code is trusted over the exception class when both exist, because
SDKs raise a generic `APIStatusError` for anything they do not model
specifically — a 401 arriving under a class name that *looks* transient is
exactly the case that must not fail over.

### A second model, not a second vendor

`09-TODO` says "Claude → OpenAI", and `FallbackProvider` takes any
`LlmProvider`, so an OpenAI implementation drops in with no change to the loop,
the tracing or the cost accounting. It is not written yet, because there is no
OpenAI key to test it against and an untested failover path is worse than none.

Sonnet → Haiku is also the more common production case. Degrading to a smaller
model of the same family keeps tool-use semantics identical, which a
cross-vendor fallback does not — tool schemas, `tool_use` block shapes and
stop reasons all differ, and discovering that during an outage is the wrong
time.

### The response reports what served it

Cost accounting reads `response.model`, not the configured one. A run that fell
back to Haiku must not be billed at Sonnet's rate, and `pricing.py` raises on
an unknown model rather than pricing it at zero — so this had to be right or
the reconciliation between `traces` and `llm_usage` would drift.

## Consequences

**Accepted costs**

- **Latency is additive on failure.** A timeout followed by a fallback costs
  both. No circuit breaker yet: the fifth request in an outage pays the full
  timeout again, exactly like the first.
- **Silent quality degradation.** A run served by the smaller model produces a
  worse answer and reports success. The trace records the model per step, so it
  is *visible*, but nothing alerts on it. Phase 4's analytics should.
- **The chain is fixed at construction.** No per-task or per-tenant routing,
  which is what a "use the cheap model for simple tasks" policy would need.
- **Not tested against a real second vendor.** The classification is derived
  from Anthropic's and OpenAI's documented error classes and is unit-tested
  against synthetic exceptions of those names, which is not the same as having
  seen OpenAI fail.

## Revisit if

- An OpenAI key exists, at which point write the provider and test the
  cross-vendor path properly rather than assuming it.
- Outages get long enough that a circuit breaker earns its complexity.
- Cost pressure justifies routing by task rather than by failure, which is a
  different feature that happens to use the same interface.
