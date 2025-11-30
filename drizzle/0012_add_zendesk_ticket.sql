ALTER TABLE "t3-app-template_event"
  ADD COLUMN IF NOT EXISTS "zendeskTicketNumber" varchar(64);
