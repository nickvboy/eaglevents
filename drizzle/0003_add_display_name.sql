ALTER TABLE "t3-app-template_user"
  ADD COLUMN IF NOT EXISTS "displayName" varchar(255) DEFAULT '' NOT NULL;

UPDATE "t3-app-template_user"
SET "displayName" = COALESCE(NULLIF("displayName", ''), "username");
