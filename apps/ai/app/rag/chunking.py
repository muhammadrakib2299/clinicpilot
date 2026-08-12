"""Splitting a clinic document into passages worth retrieving one at a time.

Heading-aware rather than a fixed character window, for two reasons that both
show up in the answer rather than in the pipeline:

1. **A citation should name something a human can find.** "opening-hours#2" is
   a worse answer than "opening-hours · Bank holidays", and the heading is the
   only thing that makes the second possible.
2. **The heading is the highest-signal sentence in the section.** A patient
   asking "how do I cancel" uses the words in "Cancelling an appointment"
   before they use any word in its body, so the heading is prefixed onto the
   chunk text and embedded with it.

Chunks are small — around 120 words — because the agent is given several and
precision matters more than context here. A 500-word chunk retrieved for one
matching sentence spends tokens on four paragraphs the patient did not ask
about, and gives the model more room to answer from the wrong one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Words per chunk, before the overlap is added. Not a hard cap: a paragraph is
#: never split unless it exceeds this on its own, because a paragraph is the
#: smallest unit that reliably still makes sense in isolation.
DEFAULT_TARGET_WORDS = 120

#: Words carried from the end of one chunk into the start of the next, and only
#: when a single paragraph had to be split. Without it, a sentence that
#: straddles the boundary is retrievable from neither side.
DEFAULT_OVERLAP_WORDS = 30

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@dataclass(frozen=True)
class Chunk:
    """One retrievable passage.

    `text` includes the heading; `heading` repeats it as a separate field. The
    duplication is deliberate — the first is what gets embedded and shown to
    the model, the second is what a citation displays.
    """

    ordinal: int
    heading: str | None
    text: str


@dataclass(frozen=True)
class _Section:
    heading: str | None
    paragraphs: list[str]


def chunk_markdown(
    content: str,
    *,
    target_words: int = DEFAULT_TARGET_WORDS,
    overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> list[Chunk]:
    """Split a document into ordered, individually meaningful passages.

    Ordinals are contiguous from 1 across the whole document, not per section:
    `slug#4` has to identify one passage, and the database enforces that with a
    unique (document_id, ordinal) index.
    """
    chunks: list[Chunk] = []

    for section in _sections(content):
        for body in _pack(section.paragraphs, target_words, overlap_words):
            text = f"{section.heading}\n\n{body}" if section.heading else body
            chunks.append(Chunk(ordinal=len(chunks) + 1, heading=section.heading, text=text))

    return chunks


def _sections(content: str) -> list[_Section]:
    """Group the document by heading, keeping any preamble under `None`."""
    sections: list[_Section] = []
    heading: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        paragraphs = _paragraphs("\n".join(buffer))
        # A heading with no body is dropped rather than embedded on its own. It
        # would answer no question and would rank against the section that
        # actually contains the answer.
        if paragraphs:
            sections.append(_Section(heading=heading, paragraphs=paragraphs))
        buffer.clear()

    for line in content.splitlines():
        match = _HEADING.match(line)
        if match:
            flush()
            heading = match.group(2).strip()
        else:
            buffer.append(line)

    flush()
    return sections


def _paragraphs(body: str) -> list[str]:
    """Blank-line separated blocks, which keeps a bullet list in one piece.

    Line breaks *within* a block survive; only blank lines and trailing
    whitespace are removed. Collapsing them would hand the model
    "- your NHS number - a list of medications" as one run-on line, and a list
    the patient can read back is most of what these documents are.
    """
    paragraphs: list[str] = []

    for block in re.split(r"\n\s*\n", body):
        lines = [stripped for line in block.splitlines() if (stripped := line.strip())]
        if lines:
            paragraphs.append("\n".join(lines))

    return paragraphs


def _pack(paragraphs: list[str], target_words: int, overlap_words: int) -> list[str]:
    """Fill chunks paragraph by paragraph, splitting only what is too big alone."""
    packed: list[str] = []
    current: list[str] = []
    current_words = 0

    for paragraph in paragraphs:
        words = paragraph.split()

        if len(words) > target_words:
            # Too long to sit alongside anything. Close what is open, then
            # window it with overlap.
            if current:
                packed.append("\n\n".join(current))
                current, current_words = [], 0
            packed.extend(_window(words, target_words, overlap_words))
            continue

        if current and current_words + len(words) > target_words:
            packed.append("\n\n".join(current))
            current, current_words = [], 0

        current.append(paragraph)
        current_words += len(words)

    if current:
        packed.append("\n\n".join(current))

    return packed


def _window(words: list[str], target_words: int, overlap_words: int) -> list[str]:
    """Slide a fixed window over one oversized paragraph.

    Stops as soon as a window reaches the end rather than striding past it,
    which would emit a short trailing chunk whose content the previous one
    already carried — a duplicate for the retriever to rank against itself.

    `stride` is clamped to at least one word: an overlap greater than or equal
    to the target would otherwise step nowhere and loop forever.
    """
    stride = max(1, target_words - overlap_words)
    windows: list[str] = []
    start = 0

    while True:
        windows.append(" ".join(words[start : start + target_words]))
        if start + target_words >= len(words):
            return windows
        start += stride
