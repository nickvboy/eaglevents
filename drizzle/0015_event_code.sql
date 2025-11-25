-- Add a 7-digit numeric event code for user-facing references
ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "eventCode" varchar(7);

-- Backfill existing rows with a deterministic 7-digit code derived from the primary key
UPDATE "t3-app-template_event"
SET "eventCode" = LPAD("id"::text, 7, '0')
WHERE "eventCode" IS NULL;

ALTER TABLE "t3-app-template_event"
  ALTER COLUMN "eventCode" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "event_event_code_unique"
  ON "t3-app-template_event" ("eventCode");
