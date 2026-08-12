-- Delivery state for outbound follow-ups.
--
-- `messages` previously stopped at `drafted`, because nothing delivered them.
-- An n8n workflow now sweeps them on a schedule and reports back, so these
-- three columns record what happened rather than leaving `sent` to imply it.
--
-- `delivery_channel` is the honest part: the configured channel in this repo
-- is `simulated`, and a row saying so is worth more than a `sent` that reads
-- as a text message somebody received. Swapping the stand-in node for a real
-- carrier changes this value and nothing else.
--
-- The index is partial. The sweep only ever asks for one status, and a full
-- index would be mostly rows it will never look at again.

ALTER TABLE "messages" ADD COLUMN "delivery_channel" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_error" text;--> statement-breakpoint
CREATE INDEX "messages_pending_idx" ON "messages" USING btree ("tenant_id","created_at") WHERE status = 'drafted';