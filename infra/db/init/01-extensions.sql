-- Enable required Postgres extensions on first boot.
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: embeddings for RAG (Document Q&A)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digests
