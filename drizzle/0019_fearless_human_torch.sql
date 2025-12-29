DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 't3-app-template_user'
      AND column_name = 'isActive'
  ) THEN
    ALTER TABLE "t3-app-template_user"
      ADD COLUMN "isActive" boolean DEFAULT true NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 't3-app-template_user'
      AND column_name = 'deactivatedAt'
  ) THEN
    ALTER TABLE "t3-app-template_user"
      ADD COLUMN "deactivatedAt" timestamp with time zone;
  END IF;
END $$;
