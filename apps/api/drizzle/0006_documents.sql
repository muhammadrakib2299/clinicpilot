-- Clinic documents, and the vectors the Document Q&A agent retrieves them by.
--
-- The extension line is hand-added: drizzle-kit emits table DDL from the
-- schema and has no notion of extensions, so a generated migration referencing
-- `vector(384)` would fail on a fresh database that has never had it created.
-- It has to come first, in the same migration, or clone-and-run breaks for
-- everyone but the person whose database already had it.
--
-- The compose image is `pgvector/pgvector:pg16`, which ships the extension but
-- does not enable it — installed and created are different things.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" text,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_document_ordinal_key" ON "document_chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "document_chunks_tenant_idx" ON "document_chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_slug_key" ON "documents" USING btree ("tenant_id","slug");--> statement-breakpoint

-- Row-level security is not generated — see the note in 0005. Every new
-- tenant-scoped table is enrolled here by hand, which is the failure mode
-- ADR-005 names, and why the isolation suite iterates `TENANT_SCOPED_TABLES`
-- rather than asserting a count: forgetting this block means a *new* failing
-- test, not a silently unprotected table.
ALTER TABLE "documents"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_chunks" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

-- `document_chunks` carries its own `tenant_id` rather than reaching the
-- tenant through `document_id`. Denormalised on purpose: a policy that joins
-- to the parent runs per row on the hot retrieval path, and — worse — a chunk
-- whose tenant is only implied could be inserted against another tenant's
-- document by a caller that got one argument wrong. Here WITH CHECK refuses it.
CREATE POLICY tenant_isolation ON "documents"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "document_chunks"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());