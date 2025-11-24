ALTER TABLE "t3-app-template_event_hour_log"
  ADD COLUMN "loggedByProfileId" integer;

ALTER TABLE "t3-app-template_event_hour_log"
  ADD CONSTRAINT "event_hour_log_logged_by_fk"
  FOREIGN KEY ("loggedByProfileId") REFERENCES "t3-app-template_profile"("id") ON DELETE SET NULL;
