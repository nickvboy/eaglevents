-- Assign events to profiles
ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "assigneeProfileId" integer;

CREATE INDEX IF NOT EXISTS "event_assignee_idx" ON "t3-app-template_event" ("assigneeProfileId");

ALTER TABLE "t3-app-template_event"
  ADD CONSTRAINT "event_assignee_profile_fk" FOREIGN KEY ("assigneeProfileId") REFERENCES "t3-app-template_profile"("id") ON DELETE SET NULL;
