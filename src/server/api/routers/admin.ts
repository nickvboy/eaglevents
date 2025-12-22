import { z } from "zod";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  buildings,
  businesses,
  calendars,
  departments,
  eventAttendees,
  eventHourLogs,
  eventReminders,
  eventZendeskConfirmations,
  events,
  organizationRoles,
  posts,
  profiles,
  rooms,
  themePalettes,
  themeProfiles,
  users,
} from "~/server/db/schema";
import {
  bucketizeByMonth,
  calculateTrendDelta,
  startOfMonth,
  sumSeries,
} from "~/server/services/admin";

type DbClient = typeof import("~/server/db").db;

const SNAPSHOT_VERSION = 1;

const timestampSchema = z.string().datetime();
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableTimestampSchema = timestampSchema.nullable();
const nullableDateOnlySchema = dateOnlySchema.nullable();

const snapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  exportedAt: timestampSchema,
  metadata: z
    .object({
      app: z.string().min(1),
      note: z.string().max(500).optional(),
    })
    .optional(),
  exportedBy: z
    .object({
      userId: z.number().int().positive().nullable(),
      email: z.string().email().nullable(),
      displayName: z.string().nullable(),
    })
    .optional(),
  data: z.object({
    users: z.array(
      z.object({
        id: z.number().int().positive(),
        username: z.string(),
        email: z.string().min(1),
        displayName: z.string(),
        passwordHash: z.string(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    posts: z.array(
      z.object({
        id: z.number().int().positive(),
        name: z.string().nullable(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    profiles: z.array(
      z.object({
        id: z.number().int().positive(),
        userId: z.number().int().positive().nullable(),
        firstName: z.string(),
        lastName: z.string(),
        email: z.string().min(1),
        phoneNumber: z.string(),
        dateOfBirth: nullableDateOnlySchema,
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    businesses: z.array(
      z.object({
        id: z.number().int().positive(),
        name: z.string(),
        type: z.string(),
        setupCompletedAt: nullableTimestampSchema,
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    buildings: z.array(
      z.object({
        id: z.number().int().positive(),
        businessId: z.number().int().positive(),
        name: z.string(),
        acronym: z.string(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    rooms: z.array(
      z.object({
        id: z.number().int().positive(),
        buildingId: z.number().int().positive(),
        roomNumber: z.string(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    departments: z.array(
      z.object({
        id: z.number().int().positive(),
        businessId: z.number().int().positive(),
        parentDepartmentId: z.number().int().positive().nullable(),
        name: z.string(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    themePalettes: z.array(
      z.object({
        id: z.number().int().positive(),
        businessId: z.number().int().positive(),
        name: z.string(),
        description: z.string(),
        tokens: z.record(z.unknown()),
        isDefault: z.boolean(),
        createdByUserId: z.number().int().positive().nullable(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    themeProfiles: z.array(
      z.object({
        id: z.number().int().positive(),
        businessId: z.number().int().positive(),
        scopeType: z.string(),
        scopeId: z.number().int().positive(),
        label: z.string(),
        description: z.string(),
        paletteId: z.number().int().positive(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    organizationRoles: z.array(
      z.object({
        id: z.number().int().positive(),
        userId: z.number().int().positive(),
        profileId: z.number().int().positive(),
        roleType: z.string(),
        scopeType: z.string(),
        scopeId: z.number().int().positive(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    calendars: z.array(
      z.object({
        id: z.number().int().positive(),
        userId: z.number().int().positive(),
        name: z.string(),
        color: z.string(),
        isPrimary: z.boolean(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    events: z.array(
      z.object({
        id: z.number().int().positive(),
        calendarId: z.number().int().positive(),
        buildingId: z.number().int().positive().nullable(),
        assigneeProfileId: z.number().int().positive().nullable(),
        eventCode: z.string(),
        title: z.string(),
        description: z.string().nullable(),
        location: z.string().nullable(),
        isAllDay: z.boolean(),
        startDatetime: timestampSchema,
        endDatetime: timestampSchema,
        recurrenceRule: z.string().nullable(),
        participantCount: z.number().int().nullable(),
        technicianNeeded: z.boolean(),
        requestCategory: z.string().nullable(),
        equipmentNeeded: z.string().nullable(),
        eventStartTime: nullableTimestampSchema,
        eventEndTime: nullableTimestampSchema,
        setupTime: nullableTimestampSchema,
        zendeskTicketNumber: z.string().nullable(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    eventAttendees: z.array(
      z.object({
        id: z.number().int().positive(),
        eventId: z.number().int().positive(),
        profileId: z.number().int().positive().nullable(),
        email: z.string().min(1),
        responseStatus: z.string(),
      }),
    ),
    eventReminders: z.array(
      z.object({
        id: z.number().int().positive(),
        eventId: z.number().int().positive(),
        reminderMinutes: z.number().int(),
      }),
    ),
    eventHourLogs: z.array(
      z.object({
        id: z.number().int().positive(),
        eventId: z.number().int().positive(),
        loggedByProfileId: z.number().int().positive().nullable(),
        startTime: timestampSchema,
        endTime: timestampSchema,
        durationMinutes: z.number().int(),
        createdAt: timestampSchema,
      }),
    ),
    eventZendeskConfirmations: z.array(
      z.object({
        id: z.number().int().positive(),
        eventId: z.number().int().positive(),
        profileId: z.number().int().positive(),
        confirmedAt: timestampSchema,
      }),
    ),
  }),
});

type SnapshotPayload = z.infer<typeof snapshotSchema>;

const MONTHS_IN_TREND = 6;
const MS_IN_DAY = 24 * 60 * 60 * 1000;
const REPORT_WINDOW_DAYS = 60;
const UPCOMING_ZENDESK_DAYS = 14;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const REQUEST_CATEGORY_LABELS = {
  university_affiliated_request_to_university_business: "University business requests",
  university_affiliated_nonrequest_to_university_business: "Affiliated events without request",
  fgcu_student_affiliated_event: "FGCU student affiliated",
  non_affiliated_or_revenue_generating_event: "External or revenue events",
} as const;

const EVENT_CODE_MIN = 1000000;
const EVENT_CODE_RANGE = 9000000;
const EVENT_CODE_RETRY_LIMIT = 10;

function generateEventCode() {
  return String(Math.floor(EVENT_CODE_MIN + Math.random() * EVENT_CODE_RANGE));
}

async function generateUniqueEventCodes(db: DbClient, count: number) {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateEventCode());

  for (let attempt = 0; attempt < EVENT_CODE_RETRY_LIMIT; attempt += 1) {
    const candidates = Array.from(codes);
    const existingRows =
      candidates.length === 0
        ? []
        : await db.select({ code: events.eventCode }).from(events).where(inArray(events.eventCode, candidates));
    if (existingRows.length === 0) return candidates;

    for (const row of existingRows) {
      codes.delete(row.code);
    }
    while (codes.size < count) codes.add(generateEventCode());
  }

  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to reserve unique event codes." });
}

type UserSummary = {
  id: number;
  username: string;
  email: string;
  displayName: string;
  createdAt: Date;
  primaryRole: "admin" | "manager" | "employee" | null;
  profile: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    dateOfBirth: Date | null;
  } | null;
  lastActivity: Date | null;
  totalEvents: number;
};

type SelectParameter = {
  id: string;
  label: string;
  type: "select";
  options: Array<{ label: string; value: string }>;
  defaultValue: string;
  helper?: string;
};

type NumberParameter = {
  id: string;
  label: string;
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number;
  suffix?: string;
  helper?: string;
};

type ToggleParameter = {
  id: string;
  label: string;
  type: "toggle";
  defaultValue: boolean;
  helper?: string;
};

type ReportParameter = SelectParameter | NumberParameter | ToggleParameter;

type ExportReport =
  | {
      id: string;
      label: string;
      description: string;
      format: "multiYearMonth";
      years: Array<{
        year: number;
        months: Array<{ label: string; eventCount: number; staffedHours: number }>;
        totals: { events: number; hours: number };
      }>;
      parameters?: ReportParameter[];
    }
  | {
      id: string;
      label: string;
      description: string;
      format: "simpleTable";
      columns: string[];
      rows: Array<Array<string | number>>;
      parameters?: ReportParameter[];
    };

function minutesToHours(minutes: number) {
  if (minutes <= 0) return 0;
  return Math.round((minutes / 60) * 10) / 10;
}

function formatRequestCategory(code: string | null) {
  if (!code) return "Uncategorized";
  const label = REQUEST_CATEGORY_LABELS[code as keyof typeof REQUEST_CATEGORY_LABELS];
  if (label) return label;
  return code
    .split("_")
    .map((segment) => (segment ? segment[0]!.toUpperCase() + segment.slice(1) : segment))
    .join(" ");
}

function coerceTimestampValue(value: Date | string) {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Snapshot timestamp is invalid." });
}

function serializeTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  return coerceTimestampValue(value).toISOString();
}

function serializeRequiredTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Snapshot timestamp is missing." });
  }
  return coerceTimestampValue(value).toISOString();
}

function serializeDateOnly(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Snapshot date is invalid." });
  }
  return date.toISOString().slice(0, 10);
}

function parseTimestamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Snapshot timestamp is invalid." });
  }
  return parsed;
}

function parseRequiredTimestamp(value: string) {
  const parsed = parseTimestamp(value);
  if (!parsed) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Snapshot timestamp is missing." });
  }
  return parsed;
}

function parseDateOnly(value: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Snapshot date is invalid." });
    }
    return value.toISOString().slice(0, 10);
  }
  return value;
}

async function requireAdminSession(ctx: { session: Session | null; db: DbClient }) {
  const userIdRaw = ctx.session?.user?.id;
  if (!userIdRaw) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in to access admin tools." });
  }
  const userId = Number(userIdRaw);
  if (!Number.isFinite(userId)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid user session." });
  }

  const [role] = await ctx.db
    .select({ id: organizationRoles.id })
    .from(organizationRoles)
    .where(
      and(
        eq(organizationRoles.userId, userId),
        eq(organizationRoles.roleType, "admin"),
        eq(organizationRoles.scopeType, "business"),
      ),
    );

  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access is required for this operation." });
  }

  return userId;
}

async function findBusinessId(db: DbClient): Promise<number | null> {
  const [business] = await db.select({ id: businesses.id }).from(businesses).orderBy(businesses.id).limit(1);
  return business?.id ?? null;
}

async function fetchUsers(db: DbClient, ids?: number[]): Promise<UserSummary[]> {
  let userQuery = db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt), users.id);

  if (ids && ids.length > 0) {
    userQuery = userQuery.where(inArray(users.id, ids));
  }

  const userRows = await userQuery;
  if (userRows.length === 0) return [];

  const userIds = userRows.map((row) => row.id);

  const profileRows = await db
    .select({
      id: profiles.id,
      userId: profiles.userId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      email: profiles.email,
      phoneNumber: profiles.phoneNumber,
      dateOfBirth: profiles.dateOfBirth,
    })
    .from(profiles)
    .where(inArray(profiles.userId, userIds));

  const profileMap = new Map<number, (typeof profileRows)[number]>();
  for (const profile of profileRows) {
    if (profile.userId !== null) profileMap.set(profile.userId, profile);
  }

  const activityRows = await db
    .select({
      userId: calendars.userId,
      lastActivity: sql<Date | null>`max(${events.startDatetime})`,
      totalEvents: sql<number>`count(${events.id})::int`,
    })
    .from(events)
    .innerJoin(calendars, eq(events.calendarId, calendars.id))
    .where(inArray(calendars.userId, userIds))
    .groupBy(calendars.userId);

  const activityMap = new Map<number, { lastActivity: Date | null; totalEvents: number }>();
  for (const activity of activityRows) {
    activityMap.set(activity.userId, {
      lastActivity: activity.lastActivity,
      totalEvents: activity.totalEvents ?? 0,
    });
  }

  const roleRows = await db
    .select({
      userId: organizationRoles.userId,
      roleType: organizationRoles.roleType,
    })
    .from(organizationRoles)
    .where(
      and(
        inArray(organizationRoles.userId, userIds),
        eq(organizationRoles.scopeType, "business"),
      ),
    );

  const priority = new Map<"admin" | "manager" | "employee", number>([
    ["admin", 3],
    ["manager", 2],
    ["employee", 1],
  ]);
  const roleMap = new Map<number, "admin" | "manager" | "employee">();
  for (const role of roleRows) {
    const existing = roleMap.get(role.userId);
    if (!existing || (priority.get(role.roleType) ?? 0) > (priority.get(existing) ?? 0)) {
      roleMap.set(role.userId, role.roleType);
    }
  }

  return userRows.map((user) => {
    const profile = profileMap.get(user.id) ?? null;
    const activity = activityMap.get(user.id);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      primaryRole: roleMap.get(user.id) ?? null,
      profile: profile
        ? {
            id: profile.id,
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            phoneNumber: profile.phoneNumber,
            dateOfBirth: profile.dateOfBirth ?? null,
          }
        : null,
      lastActivity: activity?.lastActivity ?? null,
      totalEvents: activity?.totalEvents ?? 0,
    };
  });
}

async function loadSnapshotData(db: DbClient): Promise<SnapshotPayload["data"]> {
  const [
    userRows,
    postRows,
    profileRows,
    businessRows,
    buildingRows,
    roomRows,
    departmentRows,
    paletteRows,
    themeProfileRows,
    organizationRoleRows,
    calendarRows,
    eventRows,
    attendeeRows,
    reminderRows,
    hourLogRows,
    confirmationRows,
  ] = await Promise.all([
    db.select().from(users).orderBy(users.id),
    db.select().from(posts).orderBy(posts.id),
    db.select().from(profiles).orderBy(profiles.id),
    db.select().from(businesses).orderBy(businesses.id),
    db.select().from(buildings).orderBy(buildings.id),
    db.select().from(rooms).orderBy(rooms.id),
    db.select().from(departments).orderBy(departments.id),
    db.select().from(themePalettes).orderBy(themePalettes.id),
    db.select().from(themeProfiles).orderBy(themeProfiles.id),
    db.select().from(organizationRoles).orderBy(organizationRoles.id),
    db.select().from(calendars).orderBy(calendars.id),
    db.select().from(events).orderBy(events.id),
    db.select().from(eventAttendees).orderBy(eventAttendees.id),
    db.select().from(eventReminders).orderBy(eventReminders.id),
    db.select().from(eventHourLogs).orderBy(eventHourLogs.id),
    db.select().from(eventZendeskConfirmations).orderBy(eventZendeskConfirmations.id),
  ]);

  return {
    users: userRows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    posts: postRows.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    profiles: profileRows.map((row) => ({
      id: row.id,
      userId: row.userId ?? null,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phoneNumber: row.phoneNumber,
      dateOfBirth: serializeDateOnly(row.dateOfBirth ?? null),
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    businesses: businessRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      setupCompletedAt: serializeTimestamp(row.setupCompletedAt),
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    buildings: buildingRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      acronym: row.acronym,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    rooms: roomRows.map((row) => ({
      id: row.id,
      buildingId: row.buildingId,
      roomNumber: row.roomNumber,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    departments: departmentRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      parentDepartmentId: row.parentDepartmentId ?? null,
      name: row.name,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    themePalettes: paletteRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      description: row.description,
      tokens: row.tokens,
      isDefault: row.isDefault,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    themeProfiles: themeProfileRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      label: row.label,
      description: row.description,
      paletteId: row.paletteId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    organizationRoles: organizationRoleRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      profileId: row.profileId,
      roleType: row.roleType,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    calendars: calendarRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      color: row.color,
      isPrimary: row.isPrimary,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    events: eventRows.map((row) => ({
      id: row.id,
      calendarId: row.calendarId,
      buildingId: row.buildingId ?? null,
      assigneeProfileId: row.assigneeProfileId ?? null,
      eventCode: row.eventCode,
      title: row.title,
      description: row.description ?? null,
      location: row.location ?? null,
      isAllDay: row.isAllDay,
      startDatetime: serializeRequiredTimestamp(row.startDatetime),
      endDatetime: serializeRequiredTimestamp(row.endDatetime),
      recurrenceRule: row.recurrenceRule ?? null,
      participantCount: row.participantCount ?? null,
      technicianNeeded: row.technicianNeeded,
      requestCategory: row.requestCategory ?? null,
      equipmentNeeded: row.equipmentNeeded ?? null,
      eventStartTime: serializeTimestamp(row.eventStartTime),
      eventEndTime: serializeTimestamp(row.eventEndTime),
      setupTime: serializeTimestamp(row.setupTime),
      zendeskTicketNumber: row.zendeskTicketNumber ?? null,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    eventAttendees: attendeeRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      profileId: row.profileId ?? null,
      email: row.email,
      responseStatus: row.responseStatus,
    })),
    eventReminders: reminderRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      reminderMinutes: row.reminderMinutes,
    })),
    eventHourLogs: hourLogRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      loggedByProfileId: row.loggedByProfileId ?? null,
      startTime: serializeRequiredTimestamp(row.startTime),
      endTime: serializeRequiredTimestamp(row.endTime),
      durationMinutes: row.durationMinutes,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
    eventZendeskConfirmations: confirmationRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      profileId: row.profileId,
      confirmedAt: serializeRequiredTimestamp(row.confirmedAt),
    })),
  };
}

async function resetIdentitySequences(db: DbClient) {
  const tableNames = [
    "t3-app-template_user",
    "t3-app-template_post",
    "t3-app-template_profile",
    "t3-app-template_business",
    "t3-app-template_building",
    "t3-app-template_room",
    "t3-app-template_department",
    "t3-app-template_theme_palette",
    "t3-app-template_theme_profile",
    "t3-app-template_organization_role",
    "t3-app-template_calendar",
    "t3-app-template_event",
    "t3-app-template_event_attendee",
    "t3-app-template_event_reminder",
    "t3-app-template_event_hour_log",
    "t3-app-template_event_zendesk_confirmation",
  ];

  for (const tableName of tableNames) {
    const quoted = `"${tableName}"`;
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('${quoted}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${quoted}`,
      ),
    );
  }
}

export const adminRouter = createTRPCRouter({
  dashboard: publicProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const trendRangeStart = startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_IN_TREND - 1), 1)));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_IN_DAY);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * MS_IN_DAY);
    const fourteenDaysAhead = new Date(now.getTime() + 14 * MS_IN_DAY);

    const [{ totalUsers }] = await ctx.db.select({ totalUsers: sql<number>`count(${users.id})::int` }).from(users);

    const userCreatedRows = await ctx.db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(gte(users.createdAt, trendRangeStart));

    const eventRows = await ctx.db
      .select({ startAt: events.startDatetime })
      .from(events)
      .where(gte(events.startDatetime, trendRangeStart));

    const userTrend = bucketizeByMonth(
      userCreatedRows.map((row) => row.createdAt).filter(Boolean),
      MONTHS_IN_TREND,
      now,
    );
    const eventTrend = bucketizeByMonth(
      eventRows.map((row) => row.startAt).filter(Boolean),
      MONTHS_IN_TREND,
      now,
    );

    const newUsersCurrent = userCreatedRows.filter((row) => row.createdAt >= thirtyDaysAgo).length;
    const newUsersPrevious = userCreatedRows.filter(
      (row) => row.createdAt < thirtyDaysAgo && row.createdAt >= sixtyDaysAgo,
    ).length;
    const eventsCurrent = eventRows.filter((row) => row.startAt >= thirtyDaysAgo).length;
    const eventsPrevious = eventRows.filter(
      (row) => row.startAt < thirtyDaysAgo && row.startAt >= sixtyDaysAgo,
    ).length;

    const recentEvents = await ctx.db
      .select({
        userId: calendars.userId,
        startAt: events.startDatetime,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(gte(events.startDatetime, thirtyDaysAgo));

    const previousEvents = await ctx.db
      .select({
        userId: calendars.userId,
        startAt: events.startDatetime,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(and(gte(events.startDatetime, sixtyDaysAgo), lt(events.startDatetime, thirtyDaysAgo)));

    const activeUserIds = new Set(recentEvents.map((row) => row.userId).filter((id): id is number => typeof id === "number"));
    const previousActiveUserIds = new Set(
      previousEvents.map((row) => row.userId).filter((id): id is number => typeof id === "number"),
    );

    const activeUserCount = activeUserIds.size;
    const previousActiveUserCount = previousActiveUserIds.size;

    const utilizationCurrent =
      activeUserCount > 0 ? Math.round((eventsCurrent / activeUserCount) * 10) / 10 : 0;
    const utilizationPrevious =
      previousActiveUserCount > 0 ? Math.round((eventsPrevious / previousActiveUserCount) * 10) / 10 : 0;

    const upcomingRows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        start: events.startDatetime,
        assigneeProfileId: events.assigneeProfileId,
      })
      .from(events)
      .where(and(gte(events.startDatetime, now), lt(events.startDatetime, fourteenDaysAhead)))
      .orderBy(events.startDatetime)
      .limit(6);

    const assigneeIds = Array.from(
      new Set(
        upcomingRows
          .map((row) => row.assigneeProfileId)
          .filter((id): id is number => typeof id === "number" && Number.isFinite(id)),
      ),
    );

    const assignees =
      assigneeIds.length > 0
        ? await ctx.db
            .select({
              id: profiles.id,
              firstName: profiles.firstName,
              lastName: profiles.lastName,
            })
            .from(profiles)
            .where(inArray(profiles.id, assigneeIds))
        : [];

    const assigneeMap = new Map<number, { firstName: string; lastName: string }>();
    for (const profile of assignees) {
      assigneeMap.set(profile.id, {
        firstName: profile.firstName,
        lastName: profile.lastName,
      });
    }

    const upcomingEvents = upcomingRows.map((row) => {
      const assignee = row.assigneeProfileId ? assigneeMap.get(row.assigneeProfileId) : null;
      return {
        id: row.id,
        title: row.title,
        start: row.start,
        assigneeName: assignee ? `${assignee.firstName} ${assignee.lastName}` : null,
      };
    });

    const activeUserRows = await ctx.db
      .select({
        userId: calendars.userId,
        displayName: users.displayName,
        email: users.email,
        username: users.username,
        lastActivity: sql<Date | null>`max(${events.startDatetime})`,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .innerJoin(users, eq(calendars.userId, users.id))
      .groupBy(calendars.userId, users.displayName, users.email, users.username)
      .orderBy(sql`max(${events.startDatetime}) desc`)
      .limit(8);

    const activeUsersList =
      activeUserRows.length > 0
        ? activeUserRows.map((row) => ({
            id: row.userId,
            name: row.displayName || row.username || row.email,
            email: row.email,
            lastActivity: row.lastActivity,
          }))
        : (
            await ctx.db
              .select({
                id: users.id,
                displayName: users.displayName,
                username: users.username,
                email: users.email,
              })
              .from(users)
              .orderBy(desc(users.createdAt))
              .limit(8)
          ).map((row) => ({
            id: row.id,
            name: row.displayName || row.username || row.email,
            email: row.email,
            lastActivity: null,
          }));

    const userTrendTotal = sumSeries(userTrend);
    const eventTrendTotal = sumSeries(eventTrend);

    const alerts: Array<{ id: string; message: string; severity: "critical" | "warning" | "info"; occurredAt: Date }> =
      [];

    if (newUsersCurrent < newUsersPrevious) {
      alerts.push({
        id: "user-growth",
        message: "User growth dipped compared to the previous month.",
        severity: "warning",
        occurredAt: now,
      });
    }

    if (activeUserCount === 0) {
      alerts.push({
        id: "no-active-users",
        message: "No user activity recorded in the last 30 days.",
        severity: "critical",
        occurredAt: now,
      });
    }

    if (upcomingEvents.length === 0) {
      alerts.push({
        id: "no-upcoming-events",
        message: "There are no scheduled events in the next two weeks.",
        severity: "warning",
        occurredAt: now,
      });
    }

    if (eventsCurrent > eventsPrevious * 1.2 && eventsPrevious > 0) {
      alerts.push({
        id: "event-velocity",
        message: "Event scheduling volume is trending sharply upward.",
        severity: "info",
        occurredAt: now,
      });
    }

    return {
      summaryCards: [
        {
          id: "total-users",
          label: "Total Users",
          value: totalUsers ?? 0,
          helper: `${newUsersCurrent} new this month`,
          delta: calculateTrendDelta(newUsersCurrent, newUsersPrevious),
        },
        {
          id: "active-users",
          label: "Active Users (30d)",
          value: activeUserCount,
          helper: `${previousActiveUserCount} previous period`,
          delta: calculateTrendDelta(activeUserCount, previousActiveUserCount),
        },
        {
          id: "events-month",
          label: "Events Scheduled (30d)",
          value: eventsCurrent,
          helper: `${eventsPrevious} previous period`,
          delta: calculateTrendDelta(eventsCurrent, eventsPrevious),
        },
        {
          id: "utilization",
          label: "Events per Active User",
          value: utilizationCurrent,
          helper: `${utilizationPrevious} previous`,
          delta: calculateTrendDelta(utilizationCurrent, utilizationPrevious),
        },
      ],
      charts: {
        userTrend,
        eventTrend,
        totals: {
          userTrendTotal,
          eventTrendTotal,
        },
      },
      activeUsers: activeUsersList,
      alerts,
      upcomingEvents,
    };
  }),

  reports: publicProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - REPORT_WINDOW_DAYS * MS_IN_DAY);

    const eventRows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        start: events.startDatetime,
        end: events.endDatetime,
        buildingId: events.buildingId,
        buildingName: buildings.name,
        buildingAcronym: buildings.acronym,
        requestCategory: events.requestCategory,
        participantCount: events.participantCount,
        technicianNeeded: events.technicianNeeded,
        zendeskTicketNumber: events.zendeskTicketNumber,
      })
      .from(events)
      .leftJoin(buildings, eq(events.buildingId, buildings.id))
      .where(and(gte(events.startDatetime, windowStart), lt(events.startDatetime, now)))
      .orderBy(desc(events.startDatetime));

    const eventIds = eventRows.map((row) => row.id);
    const hourRows =
      eventIds.length === 0
        ? []
        : await ctx.db
            .select({
              eventId: eventHourLogs.eventId,
              durationMinutes: eventHourLogs.durationMinutes,
              loggedByProfileId: eventHourLogs.loggedByProfileId,
            })
            .from(eventHourLogs)
            .where(inArray(eventHourLogs.eventId, eventIds));

    const confirmationRows =
      eventIds.length === 0
        ? []
        : await ctx.db
            .select({
              eventId: eventZendeskConfirmations.eventId,
            })
            .from(eventZendeskConfirmations)
            .where(inArray(eventZendeskConfirmations.eventId, eventIds));

    const confirmedEvents = new Set(confirmationRows.map((row) => row.eventId));
    const ticketedEventIds = eventRows.filter((event) => event.zendeskTicketNumber).map((event) => event.id);
    const confirmedTicketCount = ticketedEventIds.filter((id) => confirmedEvents.has(id)).length;
    const awaitingTicketCount = ticketedEventIds.length - confirmedTicketCount;

    const totalMinutes = hourRows.reduce((acc, row) => acc + (row.durationMinutes ?? 0), 0);
    const totalEvents = eventRows.length;
    const technicianEvents = eventRows.filter((event) => event.technicianNeeded);
    const technicianTicketed = technicianEvents.filter((event) => event.zendeskTicketNumber).length;
    const technicianConfirmed = technicianEvents.filter((event) => confirmedEvents.has(event.id)).length;
    const technicianWithoutTicket = technicianEvents.length - technicianTicketed;
    const technicianAwaitingConfirmation = technicianTicketed - technicianConfirmed;

    const participantSamples = eventRows.filter((event) => typeof event.participantCount === "number").length;
    const totalParticipants = eventRows.reduce((acc, event) => acc + (event.participantCount ?? 0), 0);
    const avgParticipants = participantSamples === 0 ? null : Math.round(totalParticipants / participantSamples);

    type BuildingKey = number | "unassigned";
    const buildingStats = new Map<
      BuildingKey,
      {
        buildingId: number | null;
        buildingName: string | null;
        buildingAcronym: string | null;
        eventCount: number;
        technicianEvents: number;
        staffedMinutes: number;
      }
    >();
    const eventLookup = new Map(eventRows.map((row) => [row.id, row]));
    for (const event of eventRows) {
      const key: BuildingKey = event.buildingId ?? "unassigned";
      let entry = buildingStats.get(key);
      if (!entry) {
        entry = {
          buildingId: event.buildingId ?? null,
          buildingName: event.buildingName ?? null,
          buildingAcronym: event.buildingAcronym ?? null,
          eventCount: 0,
          technicianEvents: 0,
          staffedMinutes: 0,
        };
        buildingStats.set(key, entry);
      }
      entry.eventCount += 1;
      if (event.technicianNeeded) entry.technicianEvents += 1;
    }
    for (const log of hourRows) {
      const event = eventLookup.get(log.eventId);
      if (!event) continue;
      const key: BuildingKey = event.buildingId ?? "unassigned";
      const entry = buildingStats.get(key);
      if (!entry) continue;
      entry.staffedMinutes += log.durationMinutes ?? 0;
    }
    const buildingStatsList = Array.from(buildingStats.values())
      .sort((a, b) => b.eventCount - a.eventCount)
      .map((entry) => ({
        buildingId: entry.buildingId,
        buildingName: entry.buildingName ?? (entry.buildingId ? "Unnamed building" : "Unassigned location"),
        buildingAcronym: entry.buildingAcronym ?? null,
        eventCount: entry.eventCount,
        technicianEvents: entry.technicianEvents,
        staffedHours: minutesToHours(entry.staffedMinutes),
      }));
    const eventsByBuilding = buildingStatsList.slice(0, 6);

    const requestCategoryCounts = new Map<string, number>();
    for (const event of eventRows) {
      const key = event.requestCategory ?? "uncategorized";
      requestCategoryCounts.set(key, (requestCategoryCounts.get(key) ?? 0) + 1);
    }
    const requestCategories = Array.from(requestCategoryCounts.entries())
      .map(([category, value]) => ({
        category,
        label: formatRequestCategory(category === "uncategorized" ? null : category),
        value,
        percent: totalEvents === 0 ? 0 : Math.round((value / totalEvents) * 1000) / 10,
      }))
      .sort((a, b) => b.value - a.value);

    type DepartmentKey = number | "unassigned";
    const profileIds = Array.from(
      new Set(hourRows.map((row) => row.loggedByProfileId).filter((profileId): profileId is number => typeof profileId === "number")),
    );
    const roleRows =
      profileIds.length === 0
        ? []
        : await ctx.db
            .select({
              profileId: organizationRoles.profileId,
              scopeId: organizationRoles.scopeId,
            })
            .from(organizationRoles)
            .where(and(inArray(organizationRoles.profileId, profileIds), eq(organizationRoles.scopeType, "department")));
    const departmentIds = Array.from(new Set(roleRows.map((role) => role.scopeId)));
    const departmentRows =
      departmentIds.length === 0
        ? []
        : await ctx.db
            .select({
              id: departments.id,
              name: departments.name,
            })
            .from(departments)
            .where(inArray(departments.id, departmentIds));
    const departmentNameMap = new Map(departmentRows.map((dept) => [dept.id, dept.name]));
    const profileDepartmentMap = new Map(roleRows.map((role) => [role.profileId, role.scopeId]));
    const departmentMinutes = new Map<DepartmentKey, number>();
    for (const log of hourRows) {
      const departmentId = log.loggedByProfileId ? profileDepartmentMap.get(log.loggedByProfileId) ?? null : null;
      const key: DepartmentKey = departmentId ?? "unassigned";
      departmentMinutes.set(key, (departmentMinutes.get(key) ?? 0) + (log.durationMinutes ?? 0));
    }
    const departmentHoursList = Array.from(departmentMinutes.entries())
      .map(([key, minutes]) => ({
        departmentId: key === "unassigned" ? null : key,
        departmentName: key === "unassigned" ? "Unassigned" : departmentNameMap.get(key) ?? "Unassigned",
        hours: minutesToHours(minutes),
      }))
      .filter((entry) => entry.hours > 0)
      .sort((a, b) => b.hours - a.hours);
    const hoursByDepartment = departmentHoursList.slice(0, 6);

    const earliestEventYearRow = await ctx.db
      .select({
        year: sql<number>`min(extract(year from ${events.startDatetime}))::int`,
      })
      .from(events)
      .limit(1);
    const earliestEventYearValue = earliestEventYearRow[0]?.year ?? null;
    const lookbackStartYear = earliestEventYearValue ?? now.getUTCFullYear();
    const monthRangeStart = new Date(Date.UTC(lookbackStartYear, 0, 1));
    const eventYearExpr = sql<number>`extract(year from ${events.startDatetime})::int`;
    const eventMonthExpr = sql<number>`extract(month from ${events.startDatetime})::int`;
    const monthlyRows = await ctx.db
      .select({
        year: eventYearExpr,
        month: eventMonthExpr,
        eventCount: sql<number>`count(${events.id})::int`,
        staffedMinutes: sql<number>`coalesce(sum(${eventHourLogs.durationMinutes}), 0)::int`,
      })
      .from(events)
      .leftJoin(eventHourLogs, eq(events.id, eventHourLogs.eventId))
      .where(gte(events.startDatetime, monthRangeStart))
      .groupBy(eventYearExpr, eventMonthExpr)
      .orderBy(eventYearExpr, eventMonthExpr);

    const monthlyRowMap = new Map<string, { eventCount: number; staffedMinutes: number }>();
    let maxYearWithData = lookbackStartYear;
    for (const row of monthlyRows) {
      const year = Number(row.year ?? lookbackStartYear);
      const month = Number(row.month ?? 1);
      const eventCount = Number(row.eventCount ?? 0);
      const staffedMinutes = Number(row.staffedMinutes ?? 0);
      monthlyRowMap.set(`${year}-${month}`, { eventCount, staffedMinutes });
      if (year > maxYearWithData) {
        maxYearWithData = year;
      }
    }

    const targetEndYear = Math.max(maxYearWithData, lookbackStartYear);
    const monthlyReportYears: Array<{
      year: number;
      months: Array<{ label: string; eventCount: number; staffedHours: number }>;
      totals: { events: number; hours: number };
    }> = [];
    for (let year = lookbackStartYear; year <= targetEndYear; year++) {
      let yearlyEvents = 0;
      let yearlyHours = 0;
      const months = MONTH_LABELS.map((label, index) => {
        const stats = monthlyRowMap.get(`${year}-${index + 1}`);
        const eventCount = stats?.eventCount ?? 0;
        const staffedHours = minutesToHours(stats?.staffedMinutes ?? 0);
        yearlyEvents += eventCount;
        yearlyHours += staffedHours;
        return {
          label,
          eventCount,
          staffedHours,
        };
      });
      monthlyReportYears.push({
        year,
        months,
        totals: { events: yearlyEvents, hours: Math.round(yearlyHours * 10) / 10 },
      });
    }

    const futureCutoff = new Date(now.getTime() + UPCOMING_ZENDESK_DAYS * MS_IN_DAY);
    const upcomingZendeskRows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        start: events.startDatetime,
        buildingName: buildings.name,
        buildingAcronym: buildings.acronym,
        ticket: events.zendeskTicketNumber,
        technicianNeeded: events.technicianNeeded,
        confirmationId: eventZendeskConfirmations.id,
      })
      .from(events)
      .leftJoin(buildings, eq(events.buildingId, buildings.id))
      .leftJoin(eventZendeskConfirmations, eq(events.id, eventZendeskConfirmations.eventId))
      .where(and(gte(events.startDatetime, now), lt(events.startDatetime, futureCutoff), sql`${events.zendeskTicketNumber} IS NOT NULL`))
      .orderBy(events.startDatetime)
      .limit(32);

    const queueMap = new Map<
      number,
      {
        id: number;
        title: string;
        start: Date;
        buildingName: string | null;
        buildingAcronym: string | null;
        technicianNeeded: boolean;
        ticketNumber: string;
        hasConfirmation: boolean;
      }
    >();
    for (const row of upcomingZendeskRows) {
      let entry = queueMap.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          title: row.title,
          start: row.start,
          buildingName: row.buildingName ?? null,
          buildingAcronym: row.buildingAcronym ?? null,
          technicianNeeded: row.technicianNeeded,
          ticketNumber: row.ticket ?? "",
          hasConfirmation: false,
        };
        queueMap.set(row.id, entry);
      }
      if (row.confirmationId !== null) {
        entry.hasConfirmation = true;
      }
    }
    const zendeskQueue = Array.from(queueMap.values())
      .filter((item) => !item.hasConfirmation)
      .slice(0, 6)
      .map(({ hasConfirmation, ...rest }) => rest);

    const yearOptions = monthlyReportYears.map((year) => ({
      label: String(year.year),
      value: String(year.year),
    }));
    const firstYear = monthlyReportYears[0]?.year ?? now.getUTCFullYear();
    const lastYear = monthlyReportYears[monthlyReportYears.length - 1]?.year ?? firstYear;

    const exportReports: ExportReport[] = [
      {
        id: "events-hours-month",
        label: "Events & hours by month",
        description: "Monthly event counts and logged technician hours across your available historical data.",
        format: "multiYearMonth",
        years: monthlyReportYears,
        parameters:
          yearOptions.length > 0
            ? [
                {
                  id: "startYear",
                  label: "Start year",
                  type: "select",
                  options: yearOptions,
                  defaultValue: String(firstYear),
                  helper: "Choose the earliest year to include.",
                },
                {
                  id: "endYear",
                  label: "End year",
                  type: "select",
                  options: yearOptions,
                  defaultValue: String(lastYear),
                  helper: "Choose the latest year to include.",
                },
              ]
            : undefined,
      },
      {
        id: "building-utilization",
        label: "Building utilization (last 60 days)",
        description: "Events, technician coverage, and staffed hours per building within the reporting window.",
        format: "simpleTable",
        columns: ["Building", "Events", "Technician Events", "Staffed Hours"],
        rows: buildingStatsList.map((entry) => [
          entry.buildingName && entry.buildingAcronym
            ? `${entry.buildingAcronym} - ${entry.buildingName}`
            : entry.buildingName ?? entry.buildingAcronym ?? "Unassigned",
          entry.eventCount,
          entry.technicianEvents,
          entry.staffedHours,
        ]),
        parameters: [
          {
            id: "limit",
            label: "Max rows",
            type: "number",
            min: 1,
            max: Math.max(buildingStatsList.length, 1),
            defaultValue: Math.min(10, Math.max(buildingStatsList.length, 1)),
            helper: "Control how many buildings are included.",
          },
          {
            id: "includeUnassigned",
            label: "Include unassigned locations",
            type: "toggle",
            defaultValue: true,
          },
        ],
      },
      {
        id: "department-hours",
        label: "Department hours (last 60 days)",
        description: "Total staffed hours by department for the current reporting window.",
        format: "simpleTable",
        columns: ["Department", "Hours Logged"],
        rows: departmentHoursList.map((dept) => [dept.departmentName, dept.hours]),
        parameters: [
          {
            id: "minHours",
            label: "Minimum hours",
            type: "number",
            min: 0,
            step: 0.5,
            defaultValue: 0,
            helper: "Hide departments below this threshold.",
          },
        ],
      },
      {
        id: "request-mix",
        label: "Request mix (last 60 days)",
        description: "Distribution of event request categories for the reporting period.",
        format: "simpleTable",
        columns: ["Category", "Events", "Percent"],
        rows: requestCategories.map((category) => [category.label, category.value, `${category.percent}%`]),
        parameters: [
          {
            id: "minPercent",
            label: "Minimum share",
            type: "number",
            min: 0,
            max: 100,
            step: 1,
            defaultValue: 0,
            suffix: "%",
            helper: "Filter categories by percentage of total events.",
          },
          {
            id: "sortBy",
            label: "Sort order",
            type: "select",
            options: [
              { label: "Largest share", value: "value" },
              { label: "Alphabetical", value: "alpha" },
            ],
            defaultValue: "value",
          },
        ],
      },
    ];

    return {
      window: {
        start: windowStart,
        end: now,
        days: REPORT_WINDOW_DAYS,
      },
      summary: {
        totalEvents,
        staffedHours: minutesToHours(totalMinutes),
        avgParticipants,
        zendesk: {
          ticketed: ticketedEventIds.length,
          confirmed: confirmedTicketCount,
          awaiting: awaitingTicketCount,
          coveragePercent: ticketedEventIds.length === 0 ? 0 : Math.round((confirmedTicketCount / ticketedEventIds.length) * 100),
        },
        technician: {
          needed: technicianEvents.length,
          ticketed: technicianTicketed,
          confirmed: technicianConfirmed,
          withoutTicket: technicianWithoutTicket,
          awaitingConfirmation: Math.max(technicianAwaitingConfirmation, 0),
          readyPercent: technicianEvents.length === 0 ? 100 : Math.round((technicianConfirmed / technicianEvents.length) * 100),
        },
      },
      breakdowns: {
        eventsByBuilding,
        requestCategories,
        hoursByDepartment,
      },
      zendeskQueue,
      exportReports,
    };
  }),

  exportSnapshot: publicProcedure
    .input(z.object({ note: z.string().max(500).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
    const adminUserId = await requireAdminSession(ctx);
    const [user] = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);

    const data = await loadSnapshotData(ctx.db);
    const note = input?.note?.trim() ? input.note.trim() : undefined;
    return {
      version: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      metadata: {
        app: "eaglevents",
        note,
      },
      exportedBy: {
        userId: user?.id ?? adminUserId,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
      },
      data,
    };
  }),

  importIcsEvents: publicProcedure
    .input(
      z.object({
        calendarId: z.number().int().positive(),
        events: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(255),
              start: z.coerce.date(),
              end: z.coerce.date(),
              isAllDay: z.boolean(),
            }),
          )
          .min(1)
          .max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminSession(ctx);
      const [calendar] = await ctx.db.select({ id: calendars.id }).from(calendars).where(eq(calendars.id, input.calendarId)).limit(1);
      if (!calendar) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar not found." });
      }

      const codes = await generateUniqueEventCodes(ctx.db, input.events.length);
      const now = new Date();
      const values = input.events.map((event, index) => {
        const start = event.start;
        let end = event.end;
        if (!(end instanceof Date) || Number.isNaN(end.getTime()) || end <= start) {
          end = event.isAllDay
            ? new Date(start.getTime() + MS_IN_DAY)
            : new Date(start.getTime() + 60 * 60 * 1000);
        }
        return {
          calendarId: input.calendarId,
          eventCode: codes[index] ?? generateEventCode(),
          title: event.title,
          isAllDay: event.isAllDay,
          startDatetime: start,
          endDatetime: end,
          createdAt: now,
          updatedAt: now,
        };
      });

      await ctx.db.insert(events).values(values);
      return { inserted: values.length };
    }),

  importSnapshot: publicProcedure
    .input(snapshotSchema)
    .mutation(async ({ ctx, input }) => {
      await requireAdminSession(ctx);

      if (input.version !== SNAPSHOT_VERSION) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported snapshot version." });
      }

      const data = input.data;

      await ctx.db.transaction(async (tx) => {
        await tx.delete(eventZendeskConfirmations);
        await tx.delete(eventHourLogs);
        await tx.delete(eventReminders);
        await tx.delete(eventAttendees);
        await tx.delete(events);
        await tx.delete(calendars);
        await tx.delete(organizationRoles);
        await tx.delete(themeProfiles);
        await tx.delete(themePalettes);
        await tx.delete(rooms);
        await tx.delete(buildings);
        await tx.delete(departments);
        await tx.delete(businesses);
        await tx.delete(profiles);
        await tx.delete(posts);
        await tx.delete(users);

        if (data.users.length > 0) {
          await tx.insert(users).values(
            data.users.map((row) => ({
              id: row.id,
                username: row.username,
                email: row.email,
                displayName: row.displayName,
                passwordHash: row.passwordHash,
                createdAt: parseRequiredTimestamp(row.createdAt),
                updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.posts.length > 0) {
          await tx.insert(posts).values(
            data.posts.map((row) => ({
                id: row.id,
                name: row.name ?? null,
                createdAt: parseRequiredTimestamp(row.createdAt),
                updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.profiles.length > 0) {
          await tx.insert(profiles).values(
            data.profiles.map((row) => ({
              id: row.id,
              userId: row.userId ?? null,
              firstName: row.firstName,
              lastName: row.lastName,
                email: row.email,
                phoneNumber: row.phoneNumber,
                dateOfBirth: parseDateOnly(row.dateOfBirth),
                createdAt: parseRequiredTimestamp(row.createdAt),
                updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.businesses.length > 0) {
          await tx.insert(businesses).values(
            data.businesses.map((row) => ({
              id: row.id,
                name: row.name,
                type: row.type,
                setupCompletedAt: parseTimestamp(row.setupCompletedAt),
                createdAt: parseRequiredTimestamp(row.createdAt),
                updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.buildings.length > 0) {
          await tx.insert(buildings).values(
            data.buildings.map((row) => ({
              id: row.id,
                businessId: row.businessId,
                name: row.name,
                acronym: row.acronym,
                createdAt: parseRequiredTimestamp(row.createdAt),
                updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.rooms.length > 0) {
          await tx.insert(rooms).values(
            data.rooms.map((row) => ({
              id: row.id,
                buildingId: row.buildingId,
                roomNumber: row.roomNumber,
                createdAt: parseRequiredTimestamp(row.createdAt),
                updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.departments.length > 0) {
          const departmentParents = new Map<number, number | null>();
          const insertRows = data.departments.map((row) => {
            departmentParents.set(row.id, row.parentDepartmentId ?? null);
            return {
              id: row.id,
              businessId: row.businessId,
                parentDepartmentId: null,
                name: row.name,
                createdAt: parseRequiredTimestamp(row.createdAt),
                updatedAt: parseTimestamp(row.updatedAt),
            };
          });

          await tx.insert(departments).values(insertRows);

          for (const [id, parentId] of departmentParents.entries()) {
            if (parentId === null) continue;
            await tx.update(departments).set({ parentDepartmentId: parentId }).where(eq(departments.id, id));
          }
        }

        if (data.themePalettes.length > 0) {
          await tx.insert(themePalettes).values(
            data.themePalettes.map((row) => ({
              id: row.id,
              businessId: row.businessId,
              name: row.name,
              description: row.description,
              tokens: row.tokens as typeof themePalettes.$inferInsert["tokens"],
              isDefault: row.isDefault,
              createdByUserId: row.createdByUserId ?? null,
              createdAt: parseRequiredTimestamp(row.createdAt),
              updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.themeProfiles.length > 0) {
          await tx.insert(themeProfiles).values(
            data.themeProfiles.map((row) => ({
              id: row.id,
              businessId: row.businessId,
              scopeType: row.scopeType,
              scopeId: row.scopeId,
              label: row.label,
              description: row.description,
              paletteId: row.paletteId,
              createdAt: parseRequiredTimestamp(row.createdAt),
              updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.calendars.length > 0) {
          await tx.insert(calendars).values(
            data.calendars.map((row) => ({
              id: row.id,
              userId: row.userId,
              name: row.name,
              color: row.color,
              isPrimary: row.isPrimary,
              createdAt: parseRequiredTimestamp(row.createdAt),
              updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.events.length > 0) {
          await tx.insert(events).values(
            data.events.map((row) => ({
              id: row.id,
              calendarId: row.calendarId,
              buildingId: row.buildingId ?? null,
              assigneeProfileId: row.assigneeProfileId ?? null,
              eventCode: row.eventCode,
              title: row.title,
              description: row.description ?? null,
              location: row.location ?? null,
              isAllDay: row.isAllDay,
              startDatetime: parseRequiredTimestamp(row.startDatetime),
              endDatetime: parseRequiredTimestamp(row.endDatetime),
              recurrenceRule: row.recurrenceRule ?? null,
              participantCount: row.participantCount ?? null,
              technicianNeeded: row.technicianNeeded,
              requestCategory: row.requestCategory ?? null,
              equipmentNeeded: row.equipmentNeeded ?? null,
              eventStartTime: parseTimestamp(row.eventStartTime),
              eventEndTime: parseTimestamp(row.eventEndTime),
              setupTime: parseTimestamp(row.setupTime),
              zendeskTicketNumber: row.zendeskTicketNumber ?? null,
              createdAt: parseRequiredTimestamp(row.createdAt),
              updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        if (data.eventAttendees.length > 0) {
          await tx.insert(eventAttendees).values(
            data.eventAttendees.map((row) => ({
              id: row.id,
              eventId: row.eventId,
              profileId: row.profileId ?? null,
              email: row.email,
              responseStatus: row.responseStatus,
            })),
          );
        }

        if (data.eventReminders.length > 0) {
          await tx.insert(eventReminders).values(
            data.eventReminders.map((row) => ({
              id: row.id,
              eventId: row.eventId,
              reminderMinutes: row.reminderMinutes,
            })),
          );
        }

        if (data.eventHourLogs.length > 0) {
          await tx.insert(eventHourLogs).values(
            data.eventHourLogs.map((row) => ({
              id: row.id,
              eventId: row.eventId,
              loggedByProfileId: row.loggedByProfileId ?? null,
              startTime: parseRequiredTimestamp(row.startTime),
              endTime: parseRequiredTimestamp(row.endTime),
              durationMinutes: row.durationMinutes,
              createdAt: parseRequiredTimestamp(row.createdAt),
            })),
          );
        }

        if (data.eventZendeskConfirmations.length > 0) {
          await tx.insert(eventZendeskConfirmations).values(
            data.eventZendeskConfirmations.map((row) => ({
              id: row.id,
              eventId: row.eventId,
              profileId: row.profileId,
              confirmedAt: parseRequiredTimestamp(row.confirmedAt),
            })),
          );
        }

        if (data.organizationRoles.length > 0) {
          await tx.insert(organizationRoles).values(
            data.organizationRoles.map((row) => ({
              id: row.id,
              userId: row.userId,
              profileId: row.profileId,
              roleType: row.roleType,
              scopeType: row.scopeType,
              scopeId: row.scopeId,
              createdAt: parseRequiredTimestamp(row.createdAt),
              updatedAt: parseTimestamp(row.updatedAt),
            })),
          );
        }

        await resetIdentitySequences(tx);
      });

      return {
        success: true,
        counts: {
          users: data.users.length,
          posts: data.posts.length,
          profiles: data.profiles.length,
          businesses: data.businesses.length,
          buildings: data.buildings.length,
          rooms: data.rooms.length,
          departments: data.departments.length,
          themePalettes: data.themePalettes.length,
          themeProfiles: data.themeProfiles.length,
          organizationRoles: data.organizationRoles.length,
          calendars: data.calendars.length,
          events: data.events.length,
          eventAttendees: data.eventAttendees.length,
          eventReminders: data.eventReminders.length,
          eventHourLogs: data.eventHourLogs.length,
          eventZendeskConfirmations: data.eventZendeskConfirmations.length,
        },
      };
    }),

  users: publicProcedure.query(async ({ ctx }) => {
    return {
      users: await fetchUsers(ctx.db),
    };
  }),

  updateUser: publicProcedure
    .input(
      z
        .object({
          userId: z.number().int().positive(),
          displayName: z.string().min(1).max(255).optional(),
          profile: z
            .object({
              firstName: z.string().min(1).max(100),
              lastName: z.string().min(1).max(100),
              email: z.string().email().max(255),
              phoneNumber: z.string().min(1).max(32),
              dateOfBirth: z.coerce.date().optional().nullable(),
            })
            .optional(),
          primaryRole: z.enum(["admin", "manager", "employee"]).optional(),
        })
        .refine((value) => value.displayName !== undefined || value.profile !== undefined || value.primaryRole !== undefined, {
          message: "No updates provided",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        if (input.displayName !== undefined) {
          await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, input.userId));
        }

        let profileId: number | null = null;
        let existingProfileRecord: { id: number } | undefined;

        if (input.profile) {
          const [existingProfile] = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.userId, input.userId))
            .limit(1);

          existingProfileRecord = existingProfile;

          if (existingProfileRecord) {
            await tx
              .update(profiles)
              .set({
                firstName: input.profile.firstName,
                lastName: input.profile.lastName,
                email: input.profile.email,
                phoneNumber: input.profile.phoneNumber,
                dateOfBirth: input.profile.dateOfBirth ?? null,
              })
              .where(eq(profiles.id, existingProfileRecord.id));
            profileId = existingProfileRecord.id;
          } else {
            const [createdProfile] = await tx
              .insert(profiles)
              .values({
                userId: input.userId,
                firstName: input.profile.firstName,
                lastName: input.profile.lastName,
                email: input.profile.email,
                phoneNumber: input.profile.phoneNumber,
                dateOfBirth: input.profile.dateOfBirth ?? null,
              })
              .returning({ id: profiles.id });
            profileId = createdProfile?.id ?? null;
          }
        }

        if (profileId === null && input.primaryRole) {
          const [existingProfile] = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.userId, input.userId))
            .limit(1);
          profileId = existingProfile?.id ?? null;
        }

        if (input.primaryRole) {
          const scopeId = await findBusinessId(tx);
          if (scopeId !== null && profileId !== null) {
            await tx
              .delete(organizationRoles)
              .where(
                and(
                  eq(organizationRoles.userId, input.userId),
                  eq(organizationRoles.scopeType, "business"),
                  eq(organizationRoles.scopeId, scopeId),
                ),
              );
            await tx
              .insert(organizationRoles)
              .values({
                userId: input.userId,
                profileId,
                roleType: input.primaryRole,
                scopeType: "business",
                scopeId,
              })
              .returning();
          }
        }

        const [updatedUser] = await fetchUsers(tx, [input.userId]);
        if (!updatedUser) {
          throw new Error("User not found after update");
        }

        return updatedUser;
      });
    }),
});
