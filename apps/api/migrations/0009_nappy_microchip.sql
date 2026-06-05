ALTER TABLE "chats" ADD COLUMN "pinned_message_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "forwarded_from" jsonb;