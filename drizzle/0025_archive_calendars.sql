-- Add archive flags to hide calendars/events without deleting data
ALTER TABLE "t3-app-template_calendar" ADD COLUMN IF NOT EXISTS "isArchived" boolean DEFAULT false NOT NULL;
ALTER TABLE "t3-app-template_event" ADD COLUMN IF NOT EXISTS "isArchived" boolean DEFAULT false NOT NULL;
