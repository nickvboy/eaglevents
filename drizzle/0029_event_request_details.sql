ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "requestDetails" jsonb;

UPDATE "t3-app-template_event"
SET "requestDetails" = jsonb_build_object(
  'version',
  1,
  'equipmentNeededText',
  "equipmentNeeded"
)
WHERE "requestDetails" IS NULL
  AND "equipmentNeeded" IS NOT NULL
  AND btrim("equipmentNeeded") <> '';
