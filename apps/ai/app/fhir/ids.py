"""Normalising FHIR resource ids at the tool boundary.

Models pass ids both ways. Observed live: asked for an Appointment id, Claude
supplied ``Appointment/137240399`` because that is the form it had just read
out of a search result — entirely reasonable, and it produced a request to
``/Appointment/Appointment/137240399`` that 400'd.

The loop recovered (the error went back as an observation and the model fixed
itself on the next turn), but that cost two extra iterations and doubled the
run's token spend. Tool descriptions now say "bare id"; these helpers make the
adapter tolerant anyway, because a tool boundary should not be brittle about a
distinction the model has no strong reason to preserve.
"""

from __future__ import annotations


def bare_id(value: str) -> str:
    """Strip an optional ``ResourceType/`` prefix from an id.

    >>> bare_id("Appointment/137240399")
    '137240399'
    >>> bare_id("137240399")
    '137240399'
    """
    cleaned = value.strip().strip("/")
    if not cleaned:
        raise ValueError("FHIR id must not be empty")

    # Only the last segment is the id. `Patient/123/_history/2` is not an id we
    # ever want to address, so reject it rather than silently taking "2".
    parts = cleaned.split("/")
    if len(parts) > 2:
        raise ValueError(f"Not a plain resource id: {value!r}")

    return parts[-1]


def reference(resource_type: str, value: str) -> str:
    """Build a ``Type/id`` reference, tolerating an already-prefixed id.

    >>> reference("Slot", "Slot/88")
    'Slot/88'
    >>> reference("Slot", "88")
    'Slot/88'
    """
    return f"{resource_type}/{bare_id(value)}"
