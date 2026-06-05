ALTER TABLE "chats" ADD COLUMN "pinned_message_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN "pinned_message_id";