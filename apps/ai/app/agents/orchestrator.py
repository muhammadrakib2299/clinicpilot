"""Deciding which agent should handle a task.

Until now the caller named the agent, which meant nothing was being routed —
the dashboard hardcoded `scheduling` and the demo CLI did the same. This is the
routing pattern from `10-LESSONS`' orchestration list, and the smallest honest
version of it: one cheap model call that picks a lane, or refuses to.

**Refusing is the important half.** A router that must always choose sends
"I've had chest pain since this morning" to the scheduling agent, which has no
clinical tool, will not answer a clinical question, and will spend four
iterations discovering that. Routing to nobody and handing straight to a human
is both cheaper and safer, and it is the behaviour a clinic would actually
require.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.llm.provider import LlmProvider, LlmResponse, UserTurn

#: The lanes, and what each one is for. This text *is* the router's prompt, so
#: it is written for a model rather than for a reader — concrete enough to
#: discriminate, short enough not to dominate the context.
ROUTES: dict[str, str] = {
    "scheduling": (
        "Booking, moving, cancelling or confirming an appointment. Anything "
        "about when the patient is next seen."
    ),
    "followup": (
        "Post-visit contact: checking how someone is doing after an "
        "appointment, medication adherence reminders, routine recovery "
        "check-ins."
    ),
    "docqa": (
        "Questions answerable from clinic documents — policies, preparation "
        "instructions, opening hours, what to bring."
    ),
}

#: The router's answer when nothing fits, or when a human is required whether
#: or not something fits.
ESCALATE = "ESCALATE"

SYSTEM = f"""\
You route incoming patient messages to one team at a family medicine clinic.

Reply with exactly one word from this list and nothing else:
{chr(10).join(f"  {name} — {purpose}" for name, purpose in ROUTES.items())}
  {ESCALATE} — anything else.

Choose {ESCALATE} whenever a human should see the message first. That includes:
- any symptom, diagnosis, medication change, or request for clinical advice
- anything urgent or suggesting an emergency
- complaints, billing disputes, legal or safeguarding matters
- messages you cannot confidently place in one of the other lanes

Routing a clinical question to an administrative team is worse than escalating \
something routine. When in doubt, {ESCALATE}.
"""


@dataclass(frozen=True)
class Routing:
    """Where a task goes, and what it cost to decide."""

    #: `None` means no agent — hand to a human.
    agent_kind: str | None
    reason: str
    response: LlmResponse

    @property
    def escalated(self) -> bool:
        return self.agent_kind is None


def route(*, provider: LlmProvider, task: str) -> Routing:
    """Pick a lane for one task."""
    response = provider.complete(
        system=SYSTEM,
        turns=[UserTurn(text=task)],
        tools=[],
    )

    kind = interpret(response.text)
    said = response.text.strip()[:200]

    return Routing(
        agent_kind=kind,
        reason=(
            f"Routed to the {kind} agent."
            if kind
            else f"No agent matched; handing to a human. Router said: {said!r}"
        ),
        response=response,
    )


def interpret(text: str) -> str | None:
    """Read the router's answer, failing to a human.

    Anything unrecognised escalates. That is the safe direction here in a way
    it usually is not: the cost of escalating a routine message is a person
    reading it, and the cost of misrouting a clinical one is an administrative
    agent trying to book an appointment for chest pain.
    """
    if not text.strip():
        return None

    # First bare word. A model that answers "scheduling." or "**followup**"
    # has still answered; one that writes a paragraph has not.
    match = re.search(r"[A-Za-z]+", text)
    if not match:
        return None

    word = match.group(0).lower()
    return word if word in ROUTES else None
