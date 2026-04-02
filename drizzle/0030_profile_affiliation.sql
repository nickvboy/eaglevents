DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'profile_affiliation'
  ) THEN
    CREATE TYPE "public"."profile_affiliation" AS ENUM('staff', 'faculty', 'student');
  END IF;
END $$;

ALTER TABLE "t3-app-template_profile"
  ADD COLUMN IF NOT EXISTS "affiliation" "profile_affiliation";
