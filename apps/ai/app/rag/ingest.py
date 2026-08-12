"""Reading clinic documents off disk and into the corpus.

    python -m app.rag.ingest --demo
    python -m app.rag.ingest --tenant <uuid> --dir seed_docs/shared

Chunking and embedding happen here because the vectors must come from the same
code that embeds a query; storage happens in the gateway because that is where
the tenant-scoped table and its row-level security live. This module is the
seam between those two facts, and it is a script rather than an endpoint —
ingest is an operator action, not something a patient message should trigger.

Re-running it is safe and is the intended way to update a document: the gateway
replaces a document's passages rather than appending to them, keyed on slug.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from app.env import load_root_env
from app.rag.chunking import chunk_markdown
from app.rag.embedding import Embedder, HashingEmbedder
from app.rag.gateway import GatewayDocuments

SEED_DOCS = Path(__file__).resolve().parents[2] / "seed_docs"

#: The two seeded clinics, mirroring `DEMO_TENANT_ID` and `SECOND_TENANT_ID` in
#: apps/api/src/common/tenant.ts. Duplicated across a language boundary, so a
#: test reads that file and asserts these still match rather than trusting it.
#:
#: Each gets the shared corpus plus its own opening hours — different on
#: purpose, so asking both clinics the same question returns each one's answer.
#: Tenant isolation becomes something a demo shows rather than claims.
DEMO_TENANTS: dict[str, tuple[str, ...]] = {
    "00000000-0000-4000-8000-000000000001": ("shared", "northside"),
    "00000000-0000-4000-8000-000000000002": ("shared", "riverside"),
}

_H1 = re.compile(r"^#\s+(.+?)\s*#*\s*$", re.MULTILINE)


def title_of(content: str, fallback: str) -> str:
    """The document's own H1, or a title made from its filename.

    The title is shown next to every citation, so "Repeat prescriptions" beats
    "repeat-prescriptions" for a patient reading the answer.
    """
    match = _H1.search(content)
    if match:
        return match.group(1).strip()
    return fallback.replace("-", " ").capitalize()


def ingest_file(
    path: Path,
    *,
    documents: GatewayDocuments,
    embedder: Embedder,
    source: str | None = None,
) -> dict:
    """Chunk, embed and store one markdown file."""
    content = path.read_text(encoding="utf-8")
    chunks = chunk_markdown(content)

    if not chunks:
        raise ValueError(f"{path} produced no passages — is it empty?")

    # One batch rather than one call per chunk: a real embedding provider bills
    # and rate-limits per request, and this is the shape that survives swapping
    # `HashingEmbedder` out for one.
    vectors = embedder.embed([chunk.text for chunk in chunks])

    return documents.ingest(
        slug=path.stem,
        title=title_of(content, path.stem),
        source=source or path.name,
        embedding_model=embedder.name,
        chunks=[
            {
                "ordinal": chunk.ordinal,
                "heading": chunk.heading,
                "text": chunk.text,
                "embedding": vector,
            }
            for chunk, vector in zip(chunks, vectors, strict=True)
        ],
    )


def ingest_directories(
    directories: list[Path],
    *,
    tenant_id: str,
    embedder: Embedder | None = None,
    documents: GatewayDocuments | None = None,
) -> list[dict]:
    """Ingest every markdown file in each directory, in order.

    Directories are additive, and on a slug collision the later one wins —
    because the gateway keys on slug and replaces. The seeded corpus does not
    currently collide (the shared directory has no opening hours of its own),
    but the ordering is the thing that would let a clinic override a shared
    policy without any merging logic here.
    """
    embedder = embedder or HashingEmbedder()
    owned = documents is None
    documents = documents or GatewayDocuments(tenant_id=tenant_id)

    try:
        return [
            ingest_file(
                path,
                documents=documents,
                embedder=embedder,
                source=f"{path.parent.name}/{path.name}",
            )
            for directory in directories
            for path in sorted(directory.glob("*.md"))
        ]
    finally:
        if owned:
            documents.close()


def main(argv: list[str] | None = None) -> int:
    load_root_env()

    parser = argparse.ArgumentParser(description="Ingest clinic documents into the corpus.")
    parser.add_argument("--tenant", help="Tenant id to ingest into.")
    parser.add_argument(
        "--dir",
        dest="directories",
        action="append",
        default=[],
        help="Directory of markdown files. Repeatable; later ones win on slug.",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Ingest the seeded corpus into both demo clinics.",
    )
    args = parser.parse_args(argv)

    if args.demo:
        targets = {
            tenant: [SEED_DOCS / name for name in names] for tenant, names in DEMO_TENANTS.items()
        }
    elif args.tenant and args.directories:
        targets = {args.tenant: [Path(directory) for directory in args.directories]}
    else:
        parser.error("give --demo, or both --tenant and at least one --dir")

    for tenant_id, directories in targets.items():
        stored = ingest_directories(directories, tenant_id=tenant_id)
        chunks = sum(document["chunkCount"] for document in stored)
        print(f"{tenant_id}: {len(stored)} documents, {chunks} passages")

    return 0


if __name__ == "__main__":
    sys.exit(main())
