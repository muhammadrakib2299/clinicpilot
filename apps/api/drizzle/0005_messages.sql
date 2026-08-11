-- Outbound patient contact.
--
-- Note for the next person to hand-write a migration: drizzle-kit diffs the
-- schema against `meta/<n>_snapshot.json`, and a hand-written migration writes
-- no snapshot. 0004 added the `reflection` enum value by hand, so the next
-- `db:generate` diffed against 0001 and re-emitted it here — which fails on a
-- fresh database, where 0004 has already added it. Removed by hand. This
-- migration *does* have a snapshot, so the sequence is consistent again.
CREATE TYPE "public"."message_status" AS ENUM('drafted', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid,
	"patient_ref" text NOT NULL,
	"appointment_ref" text,
	"template_id" text NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'drafted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_tenant_created_idx" ON "messages" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_patient_idx" ON "messages" USING btree ("tenant_id","patient_ref");--> statement-breakpoint

-- Row-level security is not generated. drizzle-kit emits table DDL from the
-- schema and knows nothing about policies, so every new tenant-scoped table
-- has to be enrolled here by hand — which is the failure mode ADR-005 names
-- and the reason the isolation suite asserts against a list of tables rather
-- than a fixed count.
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "messages"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
