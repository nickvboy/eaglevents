// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import { index, pgTableCreator, text } from "drizzle-orm/pg-core";
import { sql as psql } from "drizzle-orm";

// Drizzle column builders
import { varchar, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `t3-app-template_${name}`);

export const users = createTable(
  "user",
  (d) => ({
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    username: varchar({ length: 50 }).notNull(),
    email: varchar({ length: 255 }).notNull(),
    displayName: varchar({ length: 255 }).default("").notNull(),
    passwordHash: varchar({ length: 255 }).notNull(),
    createdAt: timestamp({ withTimezone: true })
      .default(psql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex("user_username_unique").on(t.username),
    uniqueIndex("user_email_unique").on(t.email),
  ],
);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("name_idx").on(t.name)],
);

// Calendars and events schema for Outlook-style calendar

export const profiles = createTable(
  "profile",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d.integer().references(() => users.id, { onDelete: "set null" }),
    firstName: d.varchar({ length: 100 }).notNull(),
    lastName: d.varchar({ length: 100 }).notNull(),
    email: d.varchar({ length: 255 }).notNull(),
    phoneNumber: d.varchar({ length: 32 }).notNull(),
    dateOfBirth: d.date(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex("profile_email_unique").on(t.email),
    uniqueIndex("profile_user_unique")
      .on(t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
  ],
);

export const calendars = createTable(
  "calendar",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d.integer().notNull().references(() => users.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 100 }).notNull(),
    color: d.varchar({ length: 32 }).default("#22c55e").notNull(),
    isPrimary: d.boolean().default(false).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("calendar_user_idx").on(t.userId),
  ],
);

export const events = createTable(
  "event",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    calendarId: d.integer().notNull().references(() => calendars.id, { onDelete: "cascade" }),
    title: d.varchar({ length: 255 }).notNull(),
    description: text(),
    location: d.varchar({ length: 255 }),
    isAllDay: d.boolean().default(false).notNull(),
    startDatetime: d.timestamp({ withTimezone: true }).notNull(),
    endDatetime: d.timestamp({ withTimezone: true }).notNull(),
    recurrenceRule: text(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("event_calendar_idx").on(t.calendarId),
    index("event_start_idx").on(t.startDatetime),
  ],
);

export const eventAttendees = createTable(
  "event_attendee",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    eventId: d.integer().notNull().references(() => events.id, { onDelete: "cascade" }),
    email: d.varchar({ length: 255 }).notNull(),
    responseStatus: d.varchar({ length: 32 }).default("needsAction").notNull(),
  }),
  (t) => [index("attendee_event_idx").on(t.eventId)],
);

export const eventReminders = createTable(
  "event_reminder",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    eventId: d.integer().notNull().references(() => events.id, { onDelete: "cascade" }),
    reminderMinutes: integer().default(30).notNull(),
  }),
  (t) => [index("reminder_event_idx").on(t.eventId)],
);
