ALTER TABLE "clients" ADD COLUMN "online_status" varchar(16);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "read_at" timestamp with time zone;