"""Chunking a clinic document into passages worth citing."""

from __future__ import annotations

from app.rag.chunking import chunk_markdown

DOCUMENT = """\
# Appointments

We run appointments from 8am.

## Cancelling an appointment

Call us on the main line, or reply to your reminder message.

## Bank holidays

The surgery is closed on bank holidays.
"""


def test_one_chunk_per_section() -> None:
    chunks = chunk_markdown(DOCUMENT)

    assert [chunk.heading for chunk in chunks] == [
        "Appointments",
        "Cancelling an appointment",
        "Bank holidays",
    ]


def test_ordinals_are_contiguous_across_the_whole_document() -> None:
    # `slug#4` has to identify exactly one passage — the database enforces it
    # with a unique (document_id, ordinal) index, so per-section numbering
    # would be a write error rather than a wrong citation.
    chunks = chunk_markdown(DOCUMENT)

    assert [chunk.ordinal for chunk in chunks] == [1, 2, 3]


def test_the_heading_is_embedded_with_its_section() -> None:
    # The highest-signal sentence in a section, and the words a patient uses
    # before they use anything in the body.
    chunks = chunk_markdown(DOCUMENT)

    assert chunks[1].text.startswith("Cancelling an appointment")
    assert "reply to your reminder message" in chunks[1].text


def test_text_before_the_first_heading_is_kept() -> None:
    chunks = chunk_markdown("Some preamble with no heading above it.\n\n# Later\n\nBody.")

    assert chunks[0].heading is None
    assert chunks[0].text == "Some preamble with no heading above it."


def test_a_heading_with_no_body_is_dropped() -> None:
    # It answers no question, and would rank against the section that does.
    chunks = chunk_markdown("# Empty\n\n## Real\n\nSomething to say.")

    assert [chunk.heading for chunk in chunks] == ["Real"]


def test_paragraphs_stay_whole_when_they_fit() -> None:
    chunks = chunk_markdown("# H\n\nOne.\n\nTwo.\n\nThree.", target_words=50)

    assert len(chunks) == 1
    assert chunks[0].text.count("\n\n") == 3  # heading + three paragraphs


def test_a_bullet_list_stays_one_block_and_keeps_its_line_breaks() -> None:
    # Splitting happens on blank lines, so consecutive bullets are one
    # paragraph. Collapsing the newlines would hand the model
    # "- your NHS number - a list of medications" as a run-on line, and a list
    # the patient can read back is most of what these documents are.
    document = "# Bring\n\n- your NHS number\n- a list of medications\n- a urine sample"

    chunks = chunk_markdown(document)

    assert len(chunks) == 1
    assert chunks[0].text == (
        "Bring\n\n- your NHS number\n- a list of medications\n- a urine sample"
    )


def test_an_oversized_paragraph_is_windowed_with_overlap() -> None:
    words = [f"w{index}" for index in range(100)]
    chunks = chunk_markdown("# H\n\n" + " ".join(words), target_words=40, overlap_words=10)

    bodies = [chunk.text.split("\n\n", 1)[1].split() for chunk in chunks]

    assert bodies[0] == words[:40]
    assert bodies[1] == words[30:70]
    # The tail of one window opens the next, so a sentence across the boundary
    # is retrievable from at least one of them.
    assert bodies[0][-10:] == bodies[1][:10]


def test_windowing_stops_at_the_end_rather_than_emitting_a_duplicate_tail() -> None:
    # Striding past the end would produce a short final chunk whose content the
    # previous one already carried — a duplicate for the retriever to rank
    # against itself.
    words = [f"w{index}" for index in range(45)]
    chunks = chunk_markdown("# H\n\n" + " ".join(words), target_words=40, overlap_words=10)

    assert len(chunks) == 2
    assert chunks[-1].text.split("\n\n", 1)[1].split()[-1] == "w44"


def test_overlap_larger_than_the_target_still_terminates() -> None:
    # A stride of zero would loop forever; it is clamped to one word.
    chunks = chunk_markdown("# H\n\n" + " ".join(["word"] * 20), target_words=5, overlap_words=99)

    assert len(chunks) > 1


def test_an_empty_document_produces_nothing() -> None:
    assert chunk_markdown("") == []
    assert chunk_markdown("   \n\n  \n") == []


def test_trailing_hashes_are_not_part_of_the_heading() -> None:
    chunks = chunk_markdown("## Opening hours ##\n\nWe open at eight.")

    assert chunks[0].heading == "Opening hours"
