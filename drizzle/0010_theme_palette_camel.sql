DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_palette'
    AND column_name = 'business_id'
  ) THEN
    ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "business_id" TO "businessId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_palette'
    AND column_name = 'is_default'
  ) THEN
    ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "is_default" TO "isDefault";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_palette'
    AND column_name = 'created_by_user_id'
  ) THEN
    ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "created_by_user_id" TO "createdByUserId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_palette'
    AND column_name = 'created_at'
  ) THEN
    ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "created_at" TO "createdAt";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_palette'
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "t3-app-template_theme_palette" RENAME COLUMN "updated_at" TO "updatedAt";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_profile'
    AND column_name = 'business_id'
  ) THEN
    ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "business_id" TO "businessId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_profile'
    AND column_name = 'scope_type'
  ) THEN
    ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "scope_type" TO "scopeType";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_profile'
    AND column_name = 'scope_id'
  ) THEN
    ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "scope_id" TO "scopeId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_profile'
    AND column_name = 'palette_id'
  ) THEN
    ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "palette_id" TO "paletteId";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_profile'
    AND column_name = 'created_at'
  ) THEN
    ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "created_at" TO "createdAt";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 't3-app-template_theme_profile'
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "t3-app-template_theme_profile" RENAME COLUMN "updated_at" TO "updatedAt";
  END IF;
END $$;
