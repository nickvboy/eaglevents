ALTER TABLE "t3-app-template_calendar" ADD COLUMN IF NOT EXISTS "isPersonal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "t3-app-template_calendar" ADD COLUMN IF NOT EXISTS "scopeType" "organization_scope_type";--> statement-breakpoint
ALTER TABLE "t3-app-template_calendar" ADD COLUMN IF NOT EXISTS "scopeId" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_scope_idx" ON "t3-app-template_calendar" USING btree ("scopeType","scopeId");
