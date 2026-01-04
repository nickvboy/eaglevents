ALTER TABLE "t3-app-template_event_hour_log"
  ADD COLUMN IF NOT EXISTS "loggedByProfileId" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_hour_log_logged_by_fk'
  ) THEN
    ALTER TABLE "t3-app-template_event_hour_log"
      ADD CONSTRAINT "event_hour_log_logged_by_fk"
      FOREIGN KEY ("loggedByProfileId") REFERENCES "t3-app-template_profile"("id") ON DELETE SET NULL;
  END IF;
END $$;
