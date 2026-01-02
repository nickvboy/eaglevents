-- Backfill buildingId column on events (missing in some baseline migrations)
ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "buildingId" integer;

CREATE INDEX IF NOT EXISTS "event_building_idx" ON "t3-app-template_event" ("buildingId");

DO $$
BEGIN
  ALTER TABLE "t3-app-template_event"
    ADD CONSTRAINT "event_building_fk"
    FOREIGN KEY ("buildingId") REFERENCES "t3-app-template_building" ("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;