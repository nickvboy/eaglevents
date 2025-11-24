-- Additional event metadata for request form
DO $$
BEGIN
  CREATE TYPE "event_request_category" AS ENUM (
    'university_affiliated_request_to_university_business',
    'university_affiliated_nonrequest_to_university_business',
    'fgcu_student_affiliated_event',
    'non_affiliated_or_revenue_generating_event'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "participantCount" integer,
  ADD COLUMN IF NOT EXISTS "technicianNeeded" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "requestCategory" "event_request_category",
  ADD COLUMN IF NOT EXISTS "equipmentNeeded" text,
  ADD COLUMN IF NOT EXISTS "eventStartTime" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "eventEndTime" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "setupTime" timestamp with time zone;
