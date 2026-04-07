import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { withDbTablePrefix } from "~/config/app";
import { eventRequestDetailsSchema } from "~/server/event-request-schema";
import type { db as dbClient } from "~/server/db";
import {
  auditLogs,
  buildings,
  businesses,
  calendars,
  dateTimes,
  departments,
  eventAttendees,
  eventCoOwners,
  eventHourLogs,
  eventReminders,
  eventRooms,
  eventZendeskConfirmations,
  events,
  organizationRoles,
  posts,
  profiles,
  rooms,
  themePalettes,
  themeProfiles,
  users,
  visibilityGrants,
} from "~/server/db/schema";
import {
  DEFAULT_TIME_ZONE,
  assertValidTimeZone,
  buildDateTimeDimensionValue,
  getDateTimeId,
  normalizeDateFormatConfig,
  resolveDateTimeIds,
} from "~/server/services/date-time";

type DbClient = typeof dbClient;
type DbExecutor = Pick<DbClient, "execute">;
type DbInserter = Pick<DbClient, "insert">;

export const SUPPORTED_SNAPSHOT_VERSIONS = [2, 3, 4] as const;

const businessTypeValues = ["university", "nonprofit", "corporation", "government", "venue", "other"] as const;
const organizationRoleValues = ["admin", "co_admin", "manager", "employee"] as const;
const organizationScopeTypeValues = ["business", "department", "division"] as const;
const profileAffiliationValues = ["staff", "faculty", "student"] as const;
const themeProfileScopeValues = ["business", "department"] as const;
const eventRequestCategoryValues = [
  "university_affiliated_request_to_university_business",
  "university_affiliated_nonrequest_to_university_business",
  "fgcu_student_affiliated_event",
  "non_affiliated_or_revenue_generating_event",
] as const;

const timestampSchema = z.string().datetime();
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableTimestampSchema = timestampSchema.nullable();
const nullableDateOnlySchema = dateOnlySchema.nullable();
const SNAPSHOT_IMPORT_BATCH_SIZE = 200;

const dateFormatConfigSchema = z
  .object({
    dateKeyPattern: z.string().min(1).optional(),
    isoDatePattern: z.string().min(1).optional(),
    usDatePattern: z.string().min(1).optional(),
    longDatePattern: z.string().min(1).optional(),
    monthYearPattern: z.string().min(1).optional(),
    yearMonthLabelPattern: z.string().min(1).optional(),
    yearQuarterLabelPattern: z.string().min(1).optional(),
    quarterYearLabelPattern: z.string().min(1).optional(),
    isoDateTimePattern: z.string().min(1).optional(),
    usDateTimePattern: z.string().min(1).optional(),
  })
  .partial();

function normalizeLegacySnapshotRequestDetails(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const details = value as Record<string, unknown>;
  if (details.version !== 2) return value;

  const eventTypes = Array.isArray(details.eventTypes)
    ? details.eventTypes.flatMap((entry) =>
        entry === "Audio PA" ? ["Inside Audio PA", "Outside Audio PA"] : typeof entry === "string" ? [entry] : [],
      )
    : details.eventTypes;

  return {
    ...details,
    eventTypes,
  };
}

const snapshotRequestDetailsSchema = z.preprocess(
  normalizeLegacySnapshotRequestDetails,
  eventRequestDetailsSchema.nullable().optional(),
);

const dateTimeImportSchema = z.object({
  id: z.number().int().positive(),
  instantUtc: timestampSchema,
  timeZone: z.string().min(1).optional(),
  dateKey: z.string().min(1).optional(),
  fullDate: dateOnlySchema.optional(),
  calendarDate: dateOnlySchema.optional(),
  dayOfWeekNumber: z.number().int().optional(),
  dayOfWeekName: z.string().min(1).optional(),
  year: z.number().int().optional(),
  quarter: z.number().int().optional(),
  month: z.number().int().optional(),
  monthLabel: z.string().min(1).optional(),
  monthName: z.string().min(1).optional(),
  monthShortName: z.string().min(1).optional(),
  isoWeekYear: z.number().int().optional(),
  isoWeek: z.number().int().optional(),
  isoWeekLabel: z.string().min(1).optional(),
  dayOfMonth: z.number().int().optional(),
  dayOfYear: z.number().int().optional(),
  weekOfYear: z.number().int().optional(),
  dayOfWeekIso: z.number().int().optional(),
  dayLabel: z.string().min(1).optional(),
  monthNumber: z.number().int().optional(),
  quarterNumber: z.number().int().optional(),
  yearMonthKey: z.string().min(1).optional(),
  yearMonthLabel: z.string().min(1).optional(),
  yearQuarterLabel: z.string().min(1).optional(),
  weekStartDate: dateOnlySchema.optional(),
  weekEndDate: dateOnlySchema.optional(),
  monthStartDate: dateOnlySchema.optional(),
  monthEndDate: dateOnlySchema.optional(),
  quarterStartDate: dateOnlySchema.optional(),
  quarterEndDate: dateOnlySchema.optional(),
  yearStartDate: dateOnlySchema.optional(),
  yearEndDate: dateOnlySchema.optional(),
  isWeekday: z.boolean().optional(),
  isWeekend: z.boolean().optional(),
  isBusinessDay: z.boolean().optional(),
  isMonthStart: z.boolean().optional(),
  isMonthEnd: z.boolean().optional(),
  isQuarterStart: z.boolean().optional(),
  isQuarterEnd: z.boolean().optional(),
  isYearStart: z.boolean().optional(),
  isYearEnd: z.boolean().optional(),
  hour24: z.number().int().optional(),
  minute: z.number().int().optional(),
  second: z.number().int().optional(),
  isoDate: z.string().min(1).optional(),
  isoDateTime: z.string().min(1).optional(),
  usDate: z.string().min(1).optional(),
  usDateTime: z.string().min(1).optional(),
  dateIsoFormat: z.string().min(1).optional(),
  dateUsFormat: z.string().min(1).optional(),
  dateLongFormat: z.string().min(1).optional(),
  monthYearText: z.string().min(1).optional(),
  quarterYearLabel: z.string().min(1).optional(),
  previousDate: dateOnlySchema.optional(),
  nextDate: dateOnlySchema.optional(),
  createdAt: timestampSchema.optional(),
});

export const snapshotSchema = z.object({
  version: z.union([z.literal(2), z.literal(3), z.literal(4)]),
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
        isActive: z.boolean().optional().default(true),
        deactivatedAt: nullableTimestampSchema.optional(),
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
        affiliation: z.enum(profileAffiliationValues).nullable().optional(),
        dateOfBirth: nullableDateOnlySchema,
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    businesses: z.array(
      z.object({
        id: z.number().int().positive(),
        name: z.string(),
        type: z.enum(businessTypeValues),
        timeZone: z.string().min(1).optional(),
        dateFormatConfig: dateFormatConfigSchema.optional(),
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
        scopeType: z.enum(themeProfileScopeValues),
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
        roleType: z.enum(organizationRoleValues),
        scopeType: z.enum(organizationScopeTypeValues),
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
        isPersonal: z.boolean().optional(),
        isArchived: z.boolean().optional().default(false),
        scopeType: z.enum(organizationScopeTypeValues).optional(),
        scopeId: z.number().int().positive().optional(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    dateTimes: z.array(dateTimeImportSchema).default([]),
    events: z.array(
      z.object({
        id: z.number().int().positive(),
        calendarId: z.number().int().positive(),
        buildingId: z.number().int().positive().nullable(),
        assigneeProfileId: z.number().int().positive().nullable(),
        ownerProfileId: z.number().int().positive().nullable(),
        scopeType: z.enum(organizationScopeTypeValues),
        scopeId: z.number().int().positive(),
        eventCode: z.string(),
        title: z.string(),
        description: z.string().nullable(),
        location: z.string().nullable(),
        isVirtual: z.boolean().optional().default(false),
        isAllDay: z.boolean(),
        startDateTimeId: z.number().int().positive().optional(),
        endDateTimeId: z.number().int().positive().optional(),
        eventStartDateTimeId: z.number().int().positive().nullable().optional(),
        eventEndDateTimeId: z.number().int().positive().nullable().optional(),
        setupDateTimeId: z.number().int().positive().nullable().optional(),
        startDatetime: timestampSchema.optional(),
        endDatetime: timestampSchema.optional(),
        recurrenceRule: z.string().nullable(),
        participantCount: z.number().int().nullable(),
        technicianNeeded: z.boolean(),
        requestCategory: z.enum(eventRequestCategoryValues).nullable(),
        equipmentNeeded: z.string().nullable(),
        requestDetails: snapshotRequestDetailsSchema,
        eventStartTime: nullableTimestampSchema.optional(),
        eventEndTime: nullableTimestampSchema.optional(),
        setupTime: nullableTimestampSchema.optional(),
        zendeskTicketNumber: z.string().nullable(),
        isArchived: z.boolean().optional().default(false),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
    eventRooms: z
      .array(
        z.object({
          id: z.number().int().positive(),
          eventId: z.number().int().positive(),
          roomId: z.number().int().positive(),
          createdAt: timestampSchema,
        }),
      )
      .default([]),
    eventCoOwners: z.array(
      z.object({
        id: z.number().int().positive(),
        eventId: z.number().int().positive(),
        profileId: z.number().int().positive(),
        createdAt: timestampSchema,
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
    visibilityGrants: z.array(
      z.object({
        id: z.number().int().positive(),
        userId: z.number().int().positive(),
        scopeType: z.enum(organizationScopeTypeValues),
        scopeId: z.number().int().positive(),
        createdByUserId: z.number().int().positive().nullable(),
        reason: z.string(),
        createdAt: timestampSchema,
      }),
    ),
    auditLogs: z.array(
      z.object({
        id: z.number().int().positive(),
        businessId: z.number().int().positive().nullable(),
        actorUserId: z.number().int().positive().nullable(),
        actorProfileId: z.number().int().positive().nullable(),
        action: z.string(),
        targetType: z.string(),
        targetId: z.number().int().positive().nullable(),
        scopeType: z.enum(organizationScopeTypeValues).nullable(),
        scopeId: z.number().int().positive().nullable(),
        metadata: z.record(z.unknown()).nullable(),
        createdAt: timestampSchema,
      }),
    ),
  }),
});

export type SnapshotImportInput = z.infer<typeof snapshotSchema>;

type SnapshotEventRow = SnapshotImportInput["data"]["events"][number];
type SnapshotDateTimeRow = SnapshotImportInput["data"]["dateTimes"][number];

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Snapshot timestamp is invalid.",
    });
  }
  return parsed;
}

function parseRequiredTimestamp(value: string | null | undefined) {
  const parsed = parseTimestamp(value);
  if (!parsed) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Snapshot timestamp is missing.",
    });
  }
  return parsed;
}

function parseDateOnly(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Snapshot date is invalid.",
      });
    }
    return value.toISOString().slice(0, 10);
  }
  return value;
}

async function resetIdentitySequence(db: DbExecutor, tableName: string) {
  const prefixedTableName = withDbTablePrefix(tableName);
  const quoted = `"${prefixedTableName}"`;
  await db.execute(
    sql.raw(
      `SELECT setval(pg_get_serial_sequence('${quoted}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${quoted}`,
    ),
  );
}

async function resetIdentitySequences(db: DbExecutor) {
  const tableNames = [
    "user",
    "post",
    "profile",
    "business",
    "building",
    "room",
    "department",
    "theme_palette",
    "theme_profile",
    "organization_role",
    "calendar",
    "date_time",
    "event",
    "event_room",
    "event_co_owner",
    "event_attendee",
    "event_reminder",
    "event_hour_log",
    "event_zendesk_confirmation",
    "visibility_grant",
    "audit_log",
  ];

  for (const tableName of tableNames) {
    await resetIdentitySequence(db, tableName);
  }
}

async function truncateSnapshotTables(db: DbExecutor) {
  const tableNames = [
    "event_zendesk_confirmation",
    "event_hour_log",
    "event_reminder",
    "event_attendee",
    "event_co_owner",
    "event_room",
    "event",
    "date_time",
    "calendar",
    "organization_role",
    "visibility_grant",
    "audit_log",
    "theme_profile",
    "theme_palette",
    "room",
    "building",
    "department",
    "business",
    "profile",
    "post",
    "user",
  ]
    .map(withDbTablePrefix)
    .map((name) => `"${name}"`)
    .join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`));
}

async function insertRowsInBatches<T>(
  db: DbInserter,
  table: Parameters<DbInserter["insert"]>[0],
  rows: T[],
  chunkSize = SNAPSHOT_IMPORT_BATCH_SIZE,
) {
  if (rows.length === 0) return;
  for (let index = 0; index < rows.length; index += chunkSize) {
    await db.insert(table).values(rows.slice(index, index + chunkSize));
  }
}

function requireDateTimeId(id: number | null | undefined, label: string) {
  if (typeof id === "number" && Number.isFinite(id)) {
    return id;
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Snapshot event ${label} reference is missing.`,
  });
}

function buildImportedDateTimeRow(
  row: SnapshotDateTimeRow,
  fallbackSettings: {
    timeZone: string;
    formatConfig: ReturnType<typeof normalizeDateFormatConfig>;
  },
) {
  const instantUtc = parseRequiredTimestamp(row.instantUtc);
  const timeZone = assertValidTimeZone(row.timeZone ?? fallbackSettings.timeZone);
  const derived = buildDateTimeDimensionValue(instantUtc, {
    timeZone,
    formatConfig: fallbackSettings.formatConfig,
  });

  return {
    id: row.id,
    instantUtc,
    timeZone,
    dateKey: row.dateKey ?? derived.dateKey,
    fullDate: parseDateOnly(row.fullDate) ?? derived.fullDate,
    calendarDate: parseDateOnly(row.calendarDate) ?? derived.calendarDate,
    dayOfWeekNumber: row.dayOfWeekNumber ?? derived.dayOfWeekNumber,
    dayOfWeekName: row.dayOfWeekName ?? derived.dayOfWeekName,
    year: row.year ?? derived.year,
    quarter: row.quarter ?? derived.quarter,
    month: row.month ?? derived.month,
    monthLabel: row.monthLabel ?? derived.monthLabel,
    monthName: row.monthName ?? derived.monthName,
    monthShortName: row.monthShortName ?? derived.monthShortName,
    isoWeekYear: row.isoWeekYear ?? derived.isoWeekYear,
    isoWeek: row.isoWeek ?? derived.isoWeek,
    isoWeekLabel: row.isoWeekLabel ?? derived.isoWeekLabel,
    dayOfMonth: row.dayOfMonth ?? derived.dayOfMonth,
    dayOfYear: row.dayOfYear ?? derived.dayOfYear,
    weekOfYear: row.weekOfYear ?? derived.weekOfYear,
    dayOfWeekIso: row.dayOfWeekIso ?? derived.dayOfWeekIso,
    dayLabel: row.dayLabel ?? derived.dayLabel,
    monthNumber: row.monthNumber ?? derived.monthNumber,
    quarterNumber: row.quarterNumber ?? derived.quarterNumber,
    yearMonthKey: row.yearMonthKey ?? derived.yearMonthKey,
    yearMonthLabel: row.yearMonthLabel ?? derived.yearMonthLabel,
    yearQuarterLabel: row.yearQuarterLabel ?? derived.yearQuarterLabel,
    weekStartDate: parseDateOnly(row.weekStartDate) ?? derived.weekStartDate,
    weekEndDate: parseDateOnly(row.weekEndDate) ?? derived.weekEndDate,
    monthStartDate: parseDateOnly(row.monthStartDate) ?? derived.monthStartDate,
    monthEndDate: parseDateOnly(row.monthEndDate) ?? derived.monthEndDate,
    quarterStartDate: parseDateOnly(row.quarterStartDate) ?? derived.quarterStartDate,
    quarterEndDate: parseDateOnly(row.quarterEndDate) ?? derived.quarterEndDate,
    yearStartDate: parseDateOnly(row.yearStartDate) ?? derived.yearStartDate,
    yearEndDate: parseDateOnly(row.yearEndDate) ?? derived.yearEndDate,
    isWeekday: row.isWeekday ?? derived.isWeekday,
    isWeekend: row.isWeekend ?? derived.isWeekend,
    isBusinessDay: row.isBusinessDay ?? derived.isBusinessDay,
    isMonthStart: row.isMonthStart ?? derived.isMonthStart,
    isMonthEnd: row.isMonthEnd ?? derived.isMonthEnd,
    isQuarterStart: row.isQuarterStart ?? derived.isQuarterStart,
    isQuarterEnd: row.isQuarterEnd ?? derived.isQuarterEnd,
    isYearStart: row.isYearStart ?? derived.isYearStart,
    isYearEnd: row.isYearEnd ?? derived.isYearEnd,
    hour24: row.hour24 ?? derived.hour24,
    minute: row.minute ?? derived.minute,
    second: row.second ?? derived.second,
    isoDate: row.isoDate ?? derived.isoDate,
    isoDateTime: row.isoDateTime ?? derived.isoDateTime,
    usDate: row.usDate ?? derived.usDate,
    usDateTime: row.usDateTime ?? derived.usDateTime,
    dateIsoFormat: row.dateIsoFormat ?? derived.dateIsoFormat,
    dateUsFormat: row.dateUsFormat ?? derived.dateUsFormat,
    dateLongFormat: row.dateLongFormat ?? derived.dateLongFormat,
    monthYearText: row.monthYearText ?? derived.monthYearText,
    quarterYearLabel: row.quarterYearLabel ?? derived.quarterYearLabel,
    previousDate: parseDateOnly(row.previousDate) ?? derived.previousDate,
    nextDate: parseDateOnly(row.nextDate) ?? derived.nextDate,
    createdAt: row.createdAt ? parseRequiredTimestamp(row.createdAt) : new Date(),
  };
}

function buildParsedEventRows(rows: SnapshotEventRow[]) {
  return rows.map((row) => ({
    row,
    startDatetime: parseTimestamp(row.startDatetime ?? null),
    endDatetime: parseTimestamp(row.endDatetime ?? null),
    eventStartTime: parseTimestamp(row.eventStartTime ?? null),
    eventEndTime: parseTimestamp(row.eventEndTime ?? null),
    setupTime: parseTimestamp(row.setupTime ?? null),
  }));
}

export async function findBusinessId(db: Pick<DbClient, "select">): Promise<number | null> {
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .orderBy(businesses.id)
    .limit(1);
  return business?.id ?? null;
}

export async function restoreSnapshot(db: DbClient, input: SnapshotImportInput) {
  if (!SUPPORTED_SNAPSHOT_VERSIONS.includes(input.version)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unsupported snapshot version.",
    });
  }

  const data = input.data;

  await db.transaction(async (tx) => {
    await truncateSnapshotTables(tx);

    if (data.users.length > 0) {
      await insertRowsInBatches(
        tx,
        users,
        data.users.map((row) => ({
          id: row.id,
          username: row.username,
          email: row.email,
          displayName: row.displayName,
          passwordHash: row.passwordHash,
          isActive: row.isActive ?? true,
          deactivatedAt: parseTimestamp(row.deactivatedAt ?? null),
          createdAt: parseRequiredTimestamp(row.createdAt),
          updatedAt: parseTimestamp(row.updatedAt),
        })),
      );
    }

    if (data.posts.length > 0) {
      await insertRowsInBatches(
        tx,
        posts,
        data.posts.map((row) => ({
          id: row.id,
          name: row.name ?? null,
          createdAt: parseRequiredTimestamp(row.createdAt),
          updatedAt: parseTimestamp(row.updatedAt),
        })),
      );
    }

    if (data.profiles.length > 0) {
      await insertRowsInBatches(
        tx,
        profiles,
        data.profiles.map((row) => ({
          id: row.id,
          userId: row.userId ?? null,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phoneNumber: row.phoneNumber,
          affiliation: row.affiliation ?? null,
          dateOfBirth: parseDateOnly(row.dateOfBirth),
          createdAt: parseRequiredTimestamp(row.createdAt),
          updatedAt: parseTimestamp(row.updatedAt),
        })),
      );
    }

    const businessRows = data.businesses.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      timeZone: assertValidTimeZone(row.timeZone ?? DEFAULT_TIME_ZONE),
      dateFormatConfig: normalizeDateFormatConfig(row.dateFormatConfig),
      setupCompletedAt: parseTimestamp(row.setupCompletedAt),
      createdAt: parseRequiredTimestamp(row.createdAt),
      updatedAt: parseTimestamp(row.updatedAt),
    }));

    if (businessRows.length > 0) {
      await insertRowsInBatches(tx, businesses, businessRows);
    }

    const businessDateSettings = {
      timeZone: businessRows[0]?.timeZone ?? DEFAULT_TIME_ZONE,
      formatConfig: businessRows[0]?.dateFormatConfig ?? normalizeDateFormatConfig(undefined),
    };

    if (data.buildings.length > 0) {
      await insertRowsInBatches(
        tx,
        buildings,
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
      await insertRowsInBatches(
        tx,
        rooms,
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
      const departmentRows = data.departments.map((row) => {
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

      await insertRowsInBatches(tx, departments, departmentRows);

      for (const [id, parentId] of departmentParents.entries()) {
        if (parentId === null) continue;
        await tx.update(departments).set({ parentDepartmentId: parentId }).where(eq(departments.id, id));
      }
    }

    if (data.themePalettes.length > 0) {
      await insertRowsInBatches(
        tx,
        themePalettes,
        data.themePalettes.map((row) => ({
          id: row.id,
          businessId: row.businessId,
          name: row.name,
          description: row.description,
          tokens: row.tokens as (typeof themePalettes.$inferInsert)["tokens"],
          isDefault: row.isDefault,
          createdByUserId: row.createdByUserId ?? null,
          createdAt: parseRequiredTimestamp(row.createdAt),
          updatedAt: parseTimestamp(row.updatedAt),
        })),
      );
    }

    if (data.themeProfiles.length > 0) {
      await insertRowsInBatches(
        tx,
        themeProfiles,
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

    if (data.organizationRoles.length > 0) {
      await insertRowsInBatches(
        tx,
        organizationRoles,
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

    const fallbackBusinessId = data.businesses[0]?.id ?? null;

    if (data.calendars.length > 0) {
      await insertRowsInBatches(
        tx,
        calendars,
        data.calendars.map((row) => ({
          id: row.id,
          userId: row.userId,
          name: row.name,
          color: row.color,
          isPrimary: row.isPrimary,
          isPersonal: row.isPersonal ?? true,
          isArchived: row.isArchived ?? false,
          scopeType: row.scopeType ?? "business",
          scopeId: row.scopeId ?? fallbackBusinessId ?? row.id,
          createdAt: parseRequiredTimestamp(row.createdAt),
          updatedAt: parseTimestamp(row.updatedAt),
        })),
      );
    }

    if (data.dateTimes.length > 0) {
      await insertRowsInBatches(
        tx,
        dateTimes,
        data.dateTimes.map((row) => buildImportedDateTimeRow(row, businessDateSettings)),
      );
      await resetIdentitySequence(tx, "date_time");
    }

    const importedDateTimeIds = new Set(data.dateTimes.map((row) => row.id));
    const parsedEventRows = buildParsedEventRows(data.events);
    const resolvedEventDateTimes = await resolveDateTimeIds(
      tx,
      businessDateSettings,
      parsedEventRows.flatMap((row) => [
        row.startDatetime,
        row.endDatetime,
        row.eventStartTime,
        row.eventEndTime,
        row.setupTime,
      ]),
    );

    if (data.events.length > 0) {
      await insertRowsInBatches(
        tx,
        events,
        parsedEventRows.map(({ row, startDatetime, endDatetime, eventStartTime, eventEndTime, setupTime }) => {
          const importedStartId =
            typeof row.startDateTimeId === "number" && importedDateTimeIds.has(row.startDateTimeId)
              ? row.startDateTimeId
              : null;
          const importedEndId =
            typeof row.endDateTimeId === "number" && importedDateTimeIds.has(row.endDateTimeId)
              ? row.endDateTimeId
              : null;
          const importedEventStartId =
            typeof row.eventStartDateTimeId === "number" && importedDateTimeIds.has(row.eventStartDateTimeId)
              ? row.eventStartDateTimeId
              : null;
          const importedEventEndId =
            typeof row.eventEndDateTimeId === "number" && importedDateTimeIds.has(row.eventEndDateTimeId)
              ? row.eventEndDateTimeId
              : null;
          const importedSetupId =
            typeof row.setupDateTimeId === "number" && importedDateTimeIds.has(row.setupDateTimeId)
              ? row.setupDateTimeId
              : null;

          return {
            id: row.id,
            calendarId: row.calendarId,
            buildingId: row.buildingId ?? null,
            assigneeProfileId: row.assigneeProfileId ?? null,
            ownerProfileId: row.ownerProfileId ?? null,
            scopeType: row.scopeType,
            scopeId: row.scopeId,
            eventCode: row.eventCode,
            title: row.title,
            description: row.description ?? null,
            location: row.location ?? null,
            isVirtual: row.isVirtual ?? false,
            isAllDay: row.isAllDay,
            startDateTimeId: requireDateTimeId(
              importedStartId ?? getDateTimeId(resolvedEventDateTimes, startDatetime),
              "start time",
            ),
            endDateTimeId: requireDateTimeId(
              importedEndId ?? getDateTimeId(resolvedEventDateTimes, endDatetime),
              "end time",
            ),
            recurrenceRule: row.recurrenceRule ?? null,
            participantCount: row.participantCount ?? null,
            technicianNeeded: row.technicianNeeded,
            requestCategory: row.requestCategory ?? null,
            equipmentNeeded: row.equipmentNeeded ?? null,
            requestDetails: row.requestDetails ?? null,
            eventStartDateTimeId: importedEventStartId ?? getDateTimeId(resolvedEventDateTimes, eventStartTime),
            eventEndDateTimeId: importedEventEndId ?? getDateTimeId(resolvedEventDateTimes, eventEndTime),
            setupDateTimeId: importedSetupId ?? getDateTimeId(resolvedEventDateTimes, setupTime),
            zendeskTicketNumber: row.zendeskTicketNumber ?? null,
            isArchived: row.isArchived ?? false,
            createdAt: parseRequiredTimestamp(row.createdAt),
            updatedAt: parseTimestamp(row.updatedAt),
          };
        }),
      );
    }

    if (data.eventRooms.length > 0) {
      await insertRowsInBatches(
        tx,
        eventRooms,
        data.eventRooms.map((row) => ({
          id: row.id,
          eventId: row.eventId,
          roomId: row.roomId,
          createdAt: parseRequiredTimestamp(row.createdAt),
        })),
      );
    }

    if (data.eventCoOwners.length > 0) {
      await insertRowsInBatches(
        tx,
        eventCoOwners,
        data.eventCoOwners.map((row) => ({
          id: row.id,
          eventId: row.eventId,
          profileId: row.profileId,
          createdAt: parseRequiredTimestamp(row.createdAt),
        })),
      );
    }

    if (data.eventAttendees.length > 0) {
      await insertRowsInBatches(
        tx,
        eventAttendees,
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
      await insertRowsInBatches(
        tx,
        eventReminders,
        data.eventReminders.map((row) => ({
          id: row.id,
          eventId: row.eventId,
          reminderMinutes: row.reminderMinutes,
        })),
      );
    }

    if (data.eventHourLogs.length > 0) {
      await insertRowsInBatches(
        tx,
        eventHourLogs,
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
      await insertRowsInBatches(
        tx,
        eventZendeskConfirmations,
        data.eventZendeskConfirmations.map((row) => ({
          id: row.id,
          eventId: row.eventId,
          profileId: row.profileId,
          confirmedAt: parseRequiredTimestamp(row.confirmedAt),
        })),
      );
    }

    if (data.visibilityGrants.length > 0) {
      await insertRowsInBatches(
        tx,
        visibilityGrants,
        data.visibilityGrants.map((row) => ({
          id: row.id,
          userId: row.userId,
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          createdByUserId: row.createdByUserId ?? null,
          reason: row.reason,
          createdAt: parseRequiredTimestamp(row.createdAt),
        })),
      );
    }

    if (data.auditLogs.length > 0) {
      await insertRowsInBatches(
        tx,
        auditLogs,
        data.auditLogs.map((row) => ({
          id: row.id,
          businessId: row.businessId ?? null,
          actorUserId: row.actorUserId ?? null,
          actorProfileId: row.actorProfileId ?? null,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId ?? null,
          scopeType: row.scopeType ?? null,
          scopeId: row.scopeId ?? null,
          metadata: row.metadata ?? null,
          createdAt: parseRequiredTimestamp(row.createdAt),
        })),
      );
    }

    await resetIdentitySequences(tx);
  });

  const businessId = await findBusinessId(db);

  return {
    businessId,
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
      dateTimes: data.dateTimes.length,
      events: data.events.length,
      eventRooms: data.eventRooms.length,
      eventCoOwners: data.eventCoOwners.length,
      eventAttendees: data.eventAttendees.length,
      eventReminders: data.eventReminders.length,
      eventHourLogs: data.eventHourLogs.length,
      eventZendeskConfirmations: data.eventZendeskConfirmations.length,
      visibilityGrants: data.visibilityGrants.length,
      auditLogs: data.auditLogs.length,
    },
  };
}

export async function writeSnapshotImportAuditLog(options: {
  db: DbClient;
  businessId: number | null;
  action: string;
  actorUserId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  if (!options.businessId) return;

  let actorUserId: number | null = options.actorUserId ?? null;
  if (actorUserId !== null) {
    const actorExists = await options.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actorUserId))
      .limit(1)
      .then((rows) => Boolean(rows[0]));
    if (!actorExists) {
      actorUserId = null;
    }
  }

  await options.db.insert(auditLogs).values({
    businessId: options.businessId,
    actorUserId,
    action: options.action,
    targetType: "snapshot",
    targetId: null,
    scopeType: "business",
    scopeId: options.businessId,
    metadata: options.metadata ?? null,
  });
}
