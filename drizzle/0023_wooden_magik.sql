ALTER TABLE "t3-app-template_calendar" ADD COLUMN "isPersonal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "t3-app-template_calendar" ADD COLUMN "scopeType" "organization_scope_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "t3-app-template_calendar" ADD COLUMN "scopeId" integer NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_scope_idx" ON "t3-app-template_calendar" USING btree ("scopeType","scopeId");