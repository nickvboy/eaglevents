DROP INDEX IF EXISTS "event_event_code_unique";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_event_code_idx"
  ON "t3-app-template_event" USING btree ("eventCode");
