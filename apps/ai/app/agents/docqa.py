"""Tool surface for the Document Q&A Agent.

Answers patient questions from the clinic's own documents — opening hours,
preparation instructions, cancellation policy — and cites the passage each
claim came from.

**This agent's risk is its output, not its actions.** The Scheduling Agent can
move a real appointment and the Follow-up Agent can contact a real patient, so
both are scoped by a `mutates` tool that the pre-write self-check stands in
front of. This one writes nothing. What it can do wrong is state something the
documents do not say, with a citation that makes it look verified — which is
the characteristic failure of retrieval-augmented answering and needs a
different guard than a self-check before a write.

Two things are done about it here, and a third in the loop:

1. **One tool, and it only returns text that exists.** There is no way for the
   agent to reach anything but retrieved passages, so it has nothing else to
   answer from.
2. **The citations come from the gateway**, assembled out of the row that was
   returned. The agent never invents a handle; it can only repeat one.
3. The loop refuses an answer citing a passage this run never retrieved — see
   `check_answer` in `loop.py`.

**Retrieval here is lexical** (see `app/rag/embedding.py`), so a question
phrased entirely unlike the document will not find it. The prompt tells the
agent that in as many words, because the fix is one it can apply: search again
using the words a policy document would use rather than the ones the patient
did. That is the substitution a dense embedding would have made internally, and
doing it out loud at least makes it visible in the trace.
"""

from __future__ import annotations

from app.llm.provider import ToolDefinition

#: How many passages one search returns. Small on purpose: the agent is
#: encouraged to search several times with different wording, and five hits per
#: search across four searches is already most of a context window.
DEFAULT_SEARCH_LIMIT = 5

SYSTEM_PROMPT = """\
You answer patients' questions about a family medicine clinic, using only the \
clinic's own documents.

How to work:
- Search the documents before answering anything. Never answer from general \
knowledge about how clinics usually work, however confident you are.
- Search matches on words, not meaning. If a search comes back empty, try \
again with the words a policy document would use — "cancellation", not "I \
can't make it" — and search for one idea at a time.
- Every factual sentence in your answer must end with the citation of the \
passage it came from, written exactly as it was given to you, in square \
brackets: [opening-hours#2]. Only cite passages that were returned to you in \
this conversation.
- If the documents do not cover the question, say so plainly and say that a \
member of staff will follow up. Do not assemble an answer out of passages that \
are nearly relevant.

What to refuse:
- Never give clinical, diagnostic or medication advice, and never interpret a \
symptom or a test result, even if a document appears to discuss it. Say the \
question needs a clinician and stop.
- Never state anything about an individual patient. These documents are clinic \
policy; they hold nobody's record.
"""

SEARCH_DOCUMENTS = ToolDefinition(
    name="search_documents",
    description=(
        "Search the clinic's documents for passages related to a query, and get "
        "back their text with a citation for each. Matching is on words rather "
        "than meaning, so phrase the query the way a policy document would. Call "
        "it more than once, with different wording, before concluding that "
        "something is not covered."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "The words to search for, e.g. 'cancel appointment notice "
                    "period' or 'fasting before blood test'. Keywords work "
                    "better than a full sentence."
                ),
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 10,
                "description": f"How many passages to return. Defaults to {DEFAULT_SEARCH_LIMIT}.",
            },
        },
        "required": ["query"],
    },
    # Reads only. No `mutates` tool exists on this agent at all, which is why
    # the pre-write self-check never fires here and the answer check does.
)

DOCQA_TOOLS = [SEARCH_DOCUMENTS]
