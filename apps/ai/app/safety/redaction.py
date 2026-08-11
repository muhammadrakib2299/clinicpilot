"""De-identification of text on its way to a model (ADR-006).

Pseudonymisation, not deletion. `[PHONE_1]` rather than `[REDACTED]`, and the
same value always maps to the same placeholder, because an agent has to be able
to reason about the thing it cannot see — "call them back on [PHONE_1]" is
coherent; three identical `[REDACTED]`s are not. The mapping is held for the
duration of one run and used to restore the model's reply before a human reads
it.

**What this deliberately does not do.**

- *Names are not pattern-matched.* No regex finds names without also finding
  half the English language, and a redactor with false positives on ordinary
  words corrupts the request it is protecting. Names are removed by exact match
  when the caller knows them — which it usually does, because they came out of
  a FHIR resource this system fetched.
- *Dates are not pattern-matched.* This is a scheduling product; dates and
  times are the payload. Redacting them would break the agent outright. A date
  of birth is removed via the known-values path, where it is unambiguous.
- *FHIR resource ids are not redacted.* The agent's tools address resources by
  id, so removing them removes the agent's ability to work. Under HIPAA Safe
  Harbor a medical record number is an identifier, so this is a real gap and
  not a technicality: it is acceptable here only because every id refers to
  synthetic data on a public sandbox. A production deployment would need an
  internal-id mapping layer so the model sees a token that means nothing
  outside this system.

So this is a meaningful reduction in what leaves the building, not a Safe
Harbor de-identification, and the gap is written down rather than implied.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Conservative on purpose. Every pattern here requires structure — a scheme, a
# separator, a country prefix — because the alternative is matching bare digit
# runs, and a bare digit run in this system is a FHIR resource id. Redacting
# those would break every tool call the agent makes.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("EMAIL", re.compile(r"\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b")),
    # +15550100, +44 20 7946 0958, (555) 010-0199, 555-010-0199
    (
        "PHONE",
        re.compile(
            r"\+\d[\d\s().-]{6,18}\d|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b"
        ),
    ),
    ("SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    # NHS numbers are written in 3-3-4 groups.
    ("NHS", re.compile(r"\b\d{3}\s\d{3}\s\d{4}\b")),
    # UK postcodes; US ZIP+4 would collide with too much else to be worth it.
    ("POSTCODE", re.compile(r"\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b", re.IGNORECASE)),
]

PLACEHOLDER = re.compile(r"\[([A-Z_]+)_(\d+)\]")


@dataclass
class Redactor:
    """Stateful for one run: the mapping is what makes restoration possible.

    Not thread-safe and not shared between tasks — two patients' mappings in
    one object is precisely the leak this exists to prevent.
    """

    #: Values the caller already knows are identifiers — names, a date of
    #: birth, an address. Far more reliable than guessing, and the only way
    #: names get caught at all.
    known: dict[str, str] = field(default_factory=dict)

    _mapping: dict[str, str] = field(default_factory=dict, init=False)
    _counters: dict[str, int] = field(default_factory=dict, init=False)

    @classmethod
    def for_patient(cls, **known: str | None) -> Redactor:
        """Build from what the system already knows.

            Redactor.for_patient(NAME="Priya Nair", DOB="1987-04-12")

        Empty and None values are dropped, so a caller can pass optional fields
        without filtering first.
        """
        return cls(known={value: label for label, value in known.items() if value})

    def redact(self, text: str) -> str:
        """Replace identifiers with stable placeholders."""
        if not text:
            return text

        result = text

        # Known values first, and longest first: redacting "Priya" before
        # "Priya Nair" would leave the surname sitting in the prompt.
        for value in sorted(self.known, key=len, reverse=True):
            if value and value in result:
                result = result.replace(value, self._placeholder(self.known[value], value))

        for label, pattern in PATTERNS:
            result = pattern.sub(
                lambda m, label=label: self._placeholder(label, m.group(0)), result
            )

        return result

    def restore(self, text: str) -> str:
        """Put the real values back, for a human to read."""
        if not text or not self._mapping:
            return text

        result = text
        for placeholder, original in self._mapping.items():
            result = result.replace(placeholder, original)
        return result

    def restore_deep(self, value: object) -> object:
        """Restore through the nested dicts and lists of tool arguments.

        Tools act on the real world, so they need real values — a model that
        echoes `[PHONE_1]` back into a tool call must not have it sent onward
        as a literal string.
        """
        if isinstance(value, str):
            return self.restore(value)
        if isinstance(value, dict):
            return {key: self.restore_deep(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.restore_deep(item) for item in value]
        return value

    @property
    def redacted_count(self) -> int:
        """How many distinct identifiers were removed. Recorded on the trace."""
        return len(self._mapping)

    def _placeholder(self, label: str, original: str) -> str:
        for existing, value in self._mapping.items():
            if value == original:
                return existing

        self._counters[label] = self._counters.get(label, 0) + 1
        placeholder = f"[{label}_{self._counters[label]}]"
        self._mapping[placeholder] = original
        return placeholder
