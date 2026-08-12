-- Widen the embedding column from 384 to 1024, and clear the corpus.
--
-- This is the migration `0006_documents.sql` predicted in a comment two
-- commits ago: "changing embedding model means a migration *and* a re-ingest".
-- It happened for a reason worth recording rather than hiding in a rewritten
-- 0006 — 384 was picked because it is a familiar sentence-transformer width,
-- which is the wrong way to size a *feature-hashing* vector. There the
-- dimension is a collision budget, not a model property. A retrieval eval over
-- the seeded corpus then ranked a chaperones passage above the cancellation
-- policy for "how do I cancel my appointment", on one colliding term. Top-1
-- accuracy went 16/18 → 18/18 at 768 buckets; 1024 is the next power of two.
--
-- The DELETE is not optional and not destructive-by-accident. Vectors of one
-- width are not convertible to another — they are different points in
-- different spaces — so old rows cannot be widened, only replaced. Postgres
-- would refuse the ALTER outright while they exist. Documents are deleted
-- rather than only their chunks, because a document with no passages is
-- invisible to retrieval and would sit in the corpus listing claiming to be
-- searchable.
--
-- Re-ingest afterwards, from apps/ai with the venv active:
--   python -m app.rag.ingest --demo
DELETE FROM "documents";--> statement-breakpoint

ALTER TABLE "document_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);
