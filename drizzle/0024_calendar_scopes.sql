-- Add scoped calendars and personal flags
ALTER TABLE "t3-app-template_calendar" ADD COLUMN IF NOT EXISTS "isPersonal" boolean DEFAULT true NOT NULL;
ALTER TABLE "t3-app-template_calendar" ADD COLUMN IF NOT EXISTS "scopeType" "organization_scope_type";
ALTER TABLE "t3-app-template_calendar" ADD COLUMN IF NOT EXISTS "scopeId" integer;

WITH ranked_roles AS (
  SELECT
    "userId",
    "scopeType",
    "scopeId",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY
        CASE "roleType"
          WHEN 'admin' THEN 4
          WHEN 'co_admin' THEN 3
          WHEN 'manager' THEN 2
          WHEN 'employee' THEN 1
          ELSE 0
        END DESC,
        CASE "scopeType"
          WHEN 'business' THEN 3
          WHEN 'department' THEN 2
          WHEN 'division' THEN 1
          ELSE 0
        END DESC,
        "scopeId" ASC
    ) AS role_rank
  FROM "t3-app-template_organization_role"
),
primary_roles AS (
  SELECT "userId", "scopeType", "scopeId"
  FROM ranked_roles
  WHERE role_rank = 1
),
business_fallback AS (
  SELECT id AS "businessId"
  FROM "t3-app-template_business"
  ORDER BY id
  LIMIT 1
)
UPDATE "t3-app-template_calendar" AS calendar
SET
  "scopeType" = COALESCE(primary_roles."scopeType", 'business'::organization_scope_type),
  "scopeId" = COALESCE(primary_roles."scopeId", (SELECT "businessId" FROM business_fallback))
FROM primary_roles
WHERE calendar."userId" = primary_roles."userId";

UPDATE "t3-app-template_calendar"
SET
  "scopeType" = 'business'::organization_scope_type,
  "scopeId" = (SELECT id FROM "t3-app-template_business" ORDER BY id LIMIT 1)
WHERE "scopeType" IS NULL OR "scopeId" IS NULL;

ALTER TABLE "t3-app-template_calendar" ALTER COLUMN "scopeType" SET NOT NULL;
ALTER TABLE "t3-app-template_calendar" ALTER COLUMN "scopeId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "calendar_scope_idx" ON "t3-app-template_calendar" ("scopeType", "scopeId");

UPDATE "t3-app-template_event" AS event
SET
  "scopeType" = calendar."scopeType",
  "scopeId" = calendar."scopeId"
FROM "t3-app-template_calendar" AS calendar
WHERE event."calendarId" = calendar."id";
