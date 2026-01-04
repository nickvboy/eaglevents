ALTER TABLE "t3-app-template_event_attendee"
  ADD COLUMN IF NOT EXISTS "profileId" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_attendee_profile_fk'
  ) THEN
    ALTER TABLE "t3-app-template_event_attendee"
      ADD CONSTRAINT "event_attendee_profile_fk"
      FOREIGN KEY ("profileId") REFERENCES "t3-app-template_profile"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_attendee_profile_idx"
  ON "t3-app-template_event_attendee"("profileId");

-- Optional backfill: link attendees to profiles by email when possible
UPDATE "t3-app-template_event_attendee" ea
SET "profileId" = p."id"
FROM "t3-app-template_profile" p
WHERE ea."profileId" IS NULL AND lower(ea."email") = lower(p."email");
