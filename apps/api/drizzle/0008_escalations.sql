-- The human queue: work an agent handed back to a person.
--
-- Written by the gateway inside the same transaction that marks a task
-- escalated, so no code path can escalate without queueing. See the schema
-- comment on `escalations` for why this is a table rather than a task status,
-- and why `task_id` carries no unique constraint.

CREATE TYPE "public"."escalation_reason" AS ENUM('router', 'max_iterations', 'answer_check', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"reason" "escalation_reason" DEFAULT 'unspecified' NOT NULL,
	"summary" text NOT NULL,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escalations_tenant_status_idx" ON "escalations" USING btree ("tenant_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "escalations_task_idx" ON "escalations" USING btree ("task_id");--> statement-breakpoint

-- Row-level security, by hand as always — drizzle-kit generates table DDL and
-- knows nothing about policies. `TENANT_SCOPED_TABLES` is what the isolation
-- suite iterates, so omitting this block produces a failing test rather than a
-- table anyone can read.
ALTER TABLE "escalations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "escalations" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "escalations"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
