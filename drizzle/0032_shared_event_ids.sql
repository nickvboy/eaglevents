ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "sharedEventId" varchar(64)
  DEFAULT md5(random()::text || clock_timestamp()::text);
--> statement-breakpoint
UPDATE "t3-app-template_event"
SET "sharedEventId" = "id"::text
WHERE "sharedEventId" IS NULL;
--> statement-breakpoint
ALTER TABLE "t3-app-template_event"
  ALTER COLUMN "sharedEventId" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_shared_event_idx"
  ON "t3-app-template_event" USING btree ("sharedEventId");
