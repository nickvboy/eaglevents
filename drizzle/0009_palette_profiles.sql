DO $$
BEGIN
  CREATE TYPE "t3-app-template_theme_profile_scope" AS ENUM ('business', 'department');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "t3-app-template_theme_palette" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "tokens" jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_by_user_id" integer,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "t3-app-template_theme_profile" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL,
  "scope_type" "t3-app-template_theme_profile_scope" NOT NULL,
  "scope_id" integer NOT NULL,
  "label" varchar(120) DEFAULT '' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "palette_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone
);

ALTER TABLE "t3-app-template_theme_palette"
  ADD CONSTRAINT "theme_palette_business_fk"
  FOREIGN KEY ("business_id") REFERENCES "t3-app-template_business"("id") ON DELETE cascade;

ALTER TABLE "t3-app-template_theme_palette"
  ADD CONSTRAINT "theme_palette_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "t3-app-template_user"("id") ON DELETE set null;

ALTER TABLE "t3-app-template_theme_profile"
  ADD CONSTRAINT "theme_profile_business_fk"
  FOREIGN KEY ("business_id") REFERENCES "t3-app-template_business"("id") ON DELETE cascade;

ALTER TABLE "t3-app-template_theme_profile"
  ADD CONSTRAINT "theme_profile_palette_fk"
  FOREIGN KEY ("palette_id") REFERENCES "t3-app-template_theme_palette"("id") ON DELETE cascade;

CREATE INDEX "theme_palette_business_idx" ON "t3-app-template_theme_palette" ("business_id");
CREATE UNIQUE INDEX "theme_palette_business_name_idx" ON "t3-app-template_theme_palette" ("business_id","name");

CREATE UNIQUE INDEX "theme_profile_scope_idx" ON "t3-app-template_theme_profile" ("business_id","scope_type","scope_id");
CREATE INDEX "theme_profile_palette_idx" ON "t3-app-template_theme_profile" ("palette_id");
