ALTER TABLE "t3-app-template_profile"
  ADD COLUMN IF NOT EXISTS "firstName" varchar(100) DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "lastName" varchar(100) DEFAULT '' NOT NULL;

UPDATE "t3-app-template_profile"
SET "firstName" = COALESCE(NULLIF("firstName", ''), 'Profile'),
    "lastName" = COALESCE(NULLIF("lastName", ''), 'Owner');
