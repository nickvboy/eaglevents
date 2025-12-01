-- Add buildingId to events to reference facilities
ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "buildingId" integer;

CREATE INDEX IF NOT EXISTS "event_building_idx" ON "t3-app-template_event" ("buildingId");

ALTER TABLE "t3-app-template_event"
  ADD CONSTRAINT IF NOT EXISTS "event_building_fk"
  FOREIGN KEY ("buildingId") REFERENCES "t3-app-template_building" ("id") ON DELETE SET NULL;

