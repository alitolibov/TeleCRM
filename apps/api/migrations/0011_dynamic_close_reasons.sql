CREATE TABLE "close_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "close_reasons_value_unique" UNIQUE("value")
);
--> statement-breakpoint
ALTER TABLE "close_reasons" ADD CONSTRAINT "close_reasons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "close_reasons_sort_idx" ON "close_reasons" USING btree ("sort_order");
--> statement-breakpoint
ALTER TABLE "chat_results" ALTER COLUMN "client_status" SET DATA TYPE varchar(50) USING "client_status"::text;
--> statement-breakpoint
DROP TYPE "public"."client_status";
--> statement-breakpoint
INSERT INTO "close_reasons" ("value", "label", "sort_order") VALUES
	('thinking',      'Думает',                  10),
	('consulting',    'Пошёл посоветоваться',    20),
	('waiting_price', 'Ждёт снижения цены',      30),
	('booked',        'Забронировал',            40),
	('bought',        'Купил',                   50)
ON CONFLICT ("value") DO NOTHING;
