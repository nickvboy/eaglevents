-- Track when a user confirms that a ticket has been entered into Zendesk
CREATE TABLE IF NOT EXISTS "t3-app-template_event_zendesk_confirmation" (
  "id" serial PRIMARY KEY,
  "eventId" integer NOT NULL REFERENCES "t3-app-template_event" ("id") ON DELETE cascade,
  "profileId" integer NOT NULL REFERENCES "t3-app-template_profile" ("id") ON DELETE cascade,
  "confirmedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "zendesk_confirmation_event_idx"
  ON "t3-app-template_event_zendesk_confirmation" ("eventId");

CREATE INDEX IF NOT EXISTS "zendesk_confirmation_profile_idx"
  ON "t3-app-template_event_zendesk_confirmation" ("profileId");

CREATE UNIQUE INDEX IF NOT EXISTS "zendesk_confirmation_event_profile_idx"
  ON "t3-app-template_event_zendesk_confirmation" ("eventId", "profileId");

-- Speed up lookups by logger
CREATE INDEX IF NOT EXISTS "event_hour_log_profile_idx"
  ON "t3-app-template_event_hour_log" ("loggedByProfileId");
