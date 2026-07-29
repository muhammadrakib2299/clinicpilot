"""Id normalisation at the tool boundary.

Motivated by a real failure: asked for an Appointment id, the model supplied
'Appointment/137240399' because that is the form it had just read out of a
search result. The request went to /Appointment/Appointment/137240399 and 400'd.
"""

import pytest

from app.agents.scheduling import SCHEDULING_TOOLS
from app.fhir.ids import bare_id, reference


class TestBareId:
    def test_passes_a_plain_id_through(self) -> None:
        assert bare_id("137240399") == "137240399"

    def test_strips_a_resource_type_prefix(self) -> None:
        assert bare_id("Appointment/137240399") == "137240399"

    def test_tolerates_surrounding_whitespace_and_slashes(self) -> None:
        assert bare_id("  Slot/137240396  ") == "137240396"
        assert bare_id("/Patient/1/") == "1"

    def test_rejects_an_empty_id(self) -> None:
        with pytest.raises(ValueError, match="must not be empty"):
            bare_id("   ")

    def test_rejects_a_history_or_other_deep_path(self) -> None:
        # Silently taking the last segment would address version "2" as if it
        # were a resource id, which is a wrong write waiting to happen.
        with pytest.raises(ValueError, match="Not a plain resource id"):
            bare_id("Patient/123/_history/2")


class TestReference:
    def test_builds_a_reference_from_a_bare_id(self) -> None:
        assert reference("Slot", "88") == "Slot/88"

    def test_does_not_double_prefix_an_already_qualified_id(self) -> None:
        # The bug this exists to prevent: 'Slot/Slot/137240396' was written as a
        # reference on a live appointment and the server accepted it.
        assert reference("Slot", "Slot/137240396") == "Slot/137240396"


class TestToolDescriptions:
    @pytest.mark.parametrize(
        ("tool_name", "field"),
        [
            ("find_appointments", "patient_id"),
            ("find_availability", "schedule_id"),
            ("reschedule_appointment", "appointment_id"),
            ("reschedule_appointment", "slot_id"),
        ],
    )
    def test_every_id_field_tells_the_model_to_send_a_bare_id(
        self, tool_name: str, field: str
    ) -> None:
        tool = next(t for t in SCHEDULING_TOOLS if t.name == tool_name)
        description = tool.input_schema["properties"][field]["description"]

        assert "bare" in description.lower()
        assert "not '" in description, "should show the wrong form explicitly"
