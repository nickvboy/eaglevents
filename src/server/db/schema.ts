// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import { index, pgTableCreator, text, foreignKey, jsonb } from "drizzle-orm/pg-core";
import { sql as psql } from "drizzle-orm";

// Drizzle column builders
import { varchar, integer, timestamp, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { ThemePaletteTokens } from "~/types/theme";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `t3-app-template_${name}`);

export const businessTypeEnum = pgEnum("business_type", ["university", "nonprofit", "corporation", "government", "venue", "other"]);
export const organizationRoleTypeEnum = pgEnum("organization_role_type", ["admin", "manager", "employee"]);
export const organizationScopeTypeEnum = pgEnum("organization_scope_type", ["business", "department", "division"]);
export const themeProfileScopeEnum = pgEnum("theme_profile_scope", ["business", "department"]);
export const eventRequestCategoryEnum = pgEnum("event_request_category", [
  "university_affiliated_request_to_university_business",
  "university_affiliated_nonrequest_to_university_business",
  "fgcu_student_affiliated_event",
  "non_affiliated_or_revenue_generating_event",
]);

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

export const businesses = createTable(
  "business",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 255 }).notNull(),
    type: businessTypeEnum().default("other").notNull(),
    setupCompletedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [uniqueIndex("business_name_unique").on(t.name)],
);

export const buildings = createTable(
  "building",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    businessId: d.integer().notNull().references(() => businesses.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 255 }).notNull(),
    acronym: d.varchar({ length: 32 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("building_business_idx").on(t.businessId),
    uniqueIndex("building_business_acronym_idx").on(t.businessId, t.acronym),
  ],
);

export const rooms = createTable(
  "room",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    buildingId: d.integer().notNull().references(() => buildings.id, { onDelete: "cascade" }),
    roomNumber: d.varchar({ length: 64 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("room_building_idx").on(t.buildingId),
    uniqueIndex("room_building_number_idx").on(t.buildingId, t.roomNumber),
  ],
);

export const departments = createTable(
  "department",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    businessId: d.integer().notNull().references(() => businesses.id, { onDelete: "cascade" }),
    parentDepartmentId: d.integer(),
    name: d.varchar({ length: 255 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("department_business_idx").on(t.businessId),
    index("department_parent_idx").on(t.parentDepartmentId),
    foreignKey({
      columns: [t.parentDepartmentId],
      foreignColumns: [t.id],
      name: "department_parent_fk",
    }).onDelete("cascade"),
  ],
);

export const themePalettes = createTable(
  "theme_palette",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    businessId: d.integer().notNull().references(() => businesses.id, { onDelete: "cascade" }),
    name: d.varchar({ length: 120 }).notNull(),
    description: text().default("").notNull(),
    tokens: jsonb("tokens").$type<ThemePaletteTokens>().notNull(),
    isDefault: d.boolean().default(false).notNull(),
    createdByUserId: d.integer().references(() => users.id, { onDelete: "set null" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("theme_palette_business_idx").on(t.businessId),
    uniqueIndex("theme_palette_business_name_idx").on(t.businessId, t.name),
  ],
);

export const themeProfiles = createTable(
  "theme_profile",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    businessId: d.integer().notNull().references(() => businesses.id, { onDelete: "cascade" }),
    scopeType: themeProfileScopeEnum().notNull(),
    scopeId: d.integer().notNull(),
    label: d.varchar({ length: 120 }).default("").notNull(),
    description: text().default("").notNull(),
    paletteId: d.integer().notNull().references(() => themePalettes.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex("theme_profile_scope_idx").on(t.businessId, t.scopeType, t.scopeId),
    index("theme_profile_palette_idx").on(t.paletteId),
  ],
);

export const organizationRoles = createTable(
  "organization_role",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    userId: d.integer().notNull().references(() => users.id, { onDelete: "cascade" }),
    profileId: d.integer().notNull().references(() => profiles.id, { onDelete: "cascade" }),
    roleType: organizationRoleTypeEnum().notNull(),
    scopeType: organizationScopeTypeEnum().notNull(),
    scopeId: d.integer().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("organization_role_user_idx").on(t.userId),
    index("organization_role_scope_idx").on(t.scopeType, t.scopeId),
    uniqueIndex("organization_role_unique").on(t.userId, t.scopeType, t.scopeId, t.roleType),
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
    assigneeProfileId: d.integer().references(() => profiles.id, { onDelete: "set null" }),
    title: d.varchar({ length: 255 }).notNull(),
    description: text(),
    location: d.varchar({ length: 255 }),
    isAllDay: d.boolean().default(false).notNull(),
    startDatetime: d.timestamp({ withTimezone: true }).notNull(),
    endDatetime: d.timestamp({ withTimezone: true }).notNull(),
    recurrenceRule: text(),
    participantCount: d.integer(),
    technicianNeeded: d.boolean().default(false).notNull(),
    requestCategory: eventRequestCategoryEnum(),
    equipmentNeeded: text(),
    eventStartTime: d.timestamp({ withTimezone: true }),
    eventEndTime: d.timestamp({ withTimezone: true }),
    setupTime: d.timestamp({ withTimezone: true }),
    zendeskTicketNumber: d.varchar({ length: 64 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("event_calendar_idx").on(t.calendarId),
    index("event_start_idx").on(t.startDatetime),
    index("event_assignee_idx").on(t.assigneeProfileId),
  ],
);

export const eventAttendees = createTable(
  "event_attendee",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    eventId: d.integer().notNull().references(() => events.id, { onDelete: "cascade" }),
    profileId: d.integer().references(() => profiles.id, { onDelete: "set null" }),
    email: d.varchar({ length: 255 }).notNull(),
    responseStatus: d.varchar({ length: 32 }).default("needsAction").notNull(),
  }),
  (t) => [index("attendee_event_idx").on(t.eventId), index("attendee_profile_idx").on(t.profileId)],
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

export const eventHourLogs = createTable(
  "event_hour_log",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    eventId: d.integer().notNull().references(() => events.id, { onDelete: "cascade" }),
    loggedByProfileId: d.integer().references(() => profiles.id, { onDelete: "set null" }),
    startTime: d.timestamp({ withTimezone: true }).notNull(),
    endTime: d.timestamp({ withTimezone: true }).notNull(),
    durationMinutes: integer().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [index("event_hour_log_event_idx").on(t.eventId)],
);
