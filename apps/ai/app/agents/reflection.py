"""A self-check immediately before a high-stakes write.

The Scheduling Agent's failure mode is not refusing to work — it is confidently
moving an appointment to a time nobody offered. That has happened here: an
early run wrote a malformed slot reference onto a live appointment and the FHIR
server accepted it, because nothing between the model and the write asked
whether the values were real.

So mutating tools get a second opinion from the same model, in a fresh context,
with one job: decide whether every argument came from something observed, or
whether some of it was inferred. A fresh context matters — asking the model to
review its own reasoning inside the conversation that produced it mostly gets
agreement.

This is a cost, not a free win: one extra model call per write. It is scoped to
tools declared `mutates=True`, which is currently exactly one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.llm.provider import LlmProvider, LlmResponse, ToolCall, UserTurn

SYSTEM = """\
You are a safety reviewer for a clinic's scheduling agent. You are shown one \
proposed write to a patient's record and the evidence behind it.

Approve only if every value in the proposal appears in the observations. \
Reject if any value was inferred, guessed, or does not match what the patient \
asked for — especially times and identifiers.

Reply with exactly one line:
APPROVE
or
BLOCK: <the specific value that is not supported, and why>
"""

TEMPLATE = """\
Patient's request:
{task}

What the agent has observed so far:
{observations}

Proposed write: {tool}({arguments})

Is every value in that proposal supported by the observations above?
"""

APPROVE = "APPROVE"
BLOCK = "BLOCK"


@dataclass(frozen=True)
class Reflection:
    approved: bool
    detail: str
    response: LlmResponse


def review(
    *,
    provider: LlmProvider,
    task: str,
    observations: list[str],
    call: ToolCall,
) -> Reflection:
    """Ask whether this write is supported by what has actually been seen."""
    prompt = TEMPLATE.format(
        task=task,
        observations="\n".join(f"- {line}" for line in observations) or "- (nothing yet)",
        tool=call.name,
        arguments=", ".join(f"{k}={v!r}" for k, v in sorted(call.arguments.items())),
    )

    response = provider.complete(system=SYSTEM, turns=[UserTurn(text=prompt)], tools=[])
    approved, detail = interpret(response.text)

    return Reflection(approved=approved, detail=detail, response=response)


def interpret(text: str) -> tuple[bool, str]:
    """Read the verdict, failing closed.

    An unparseable answer counts as a block. That is the safe direction and it
    is not a dead end: the loop feeds the block back as an error result, the
    model sees why, and it gets another turn. A spurious block costs one
    iteration; a spurious approval costs a wrong write to a patient's calendar.
    """
    first = text.strip().splitlines()[0].strip() if text.strip() else ""

    # The *whole first word*, not a prefix. `startswith` would read "APPROVED?"
    # — a model hedging — as approval, which is the one misreading that matters.
    head = re.split(r"[\s:]+", first.upper(), maxsplit=1)[0] if first else ""

    if head == APPROVE:
        return True, first or "Approved."

    if head == BLOCK:
        return False, first[len(BLOCK) :].lstrip(": ").strip() or "No reason given."

    return False, (
        f"The safety check did not return a verdict (said {first[:120]!r}). "
        "Treating that as a block."
    )
