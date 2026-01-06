import { z } from "zod";
import { and, desc, eq, gt, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { withDbTablePrefix } from "~/config/app";
import {
  auditLogs,
  buildings,
  businesses,
  calendars,
  departments,
  eventCoOwners,
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
  visibilityGrants,
} from "~/server/db/schema";
import {
  bucketizeByMonth,
  calculateTrendDelta,
  startOfMonth,
  sumSeries,
} from "~/server/services/admin";
import { ensurePrimaryCalendars } from "~/server/services/calendar";
import {
  ensureJoinTableExportScheduler,
  getJoinTableExportStatus,
  refreshJoinTableExport,
} from "~/server/services/join-table-export";
import {
  ensureHourLogExportScheduler,
  getHourLogExportStatus,
  refreshHourLogExport,
} from "~/server/services/hour-log-export";
import { getDefaultEventCount, runSeed } from "~/server/services/seed";
import { getSetupStatus } from "~/server/services/setup";
import {
  canAssignRole,
  getPermissionContext,
  getUsersInScopes,
  getVisibleScopes,
  requireAdminCapability,
} from "~/server/services/permissions";
import bcrypt from "bcryptjs";
import type { db as dbClient } from "~/server/db";

type DbClient = typeof dbClient;
type DbReader = Pick<DbClient, "select">;
type DbExecutor = Pick<DbClient, "execute">;

const SNAPSHOT_VERSION = 2;
const businessTypeValues = ["university", "nonprofit", "corporation", "government", "venue", "other"] as const;
const organizationRoleValues = ["admin", "co_admin", "manager", "employee"] as const;
const organizationScopeTypeValues = ["business", "department", "division"] as const;
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
        scopeType: z.enum(organizationScopeTypeValues).optional(),
        scopeId: z.number().int().positive().optional(),
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
        ownerProfileId: z.number().int().positive().nullable(),
        scopeType: z.enum(organizationScopeTypeValues),
        scopeId: z.number().int().positive(),
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
        requestCategory: z.enum(eventRequestCategoryValues).nullable(),
        equipmentNeeded: z.string().nullable(),
        eventStartTime: nullableTimestampSchema,
        eventEndTime: nullableTimestampSchema,
        setupTime: nullableTimestampSchema,
        zendeskTicketNumber: z.string().nullable(),
        createdAt: timestampSchema,
        updatedAt: nullableTimestampSchema,
      }),
    ),
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

ensureJoinTableExportScheduler();
ensureHourLogExportScheduler();

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
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  primaryRole: "admin" | "co_admin" | "manager" | "employee" | null;
  roles: Array<{
    roleType: "admin" | "co_admin" | "manager" | "employee";
    scopeType: "business" | "department" | "division";
    scopeId: number;
    scopeLabel: string;
  }>;
  visibilityGrants: Array<{
    id: number;
    scopeType: "business" | "department" | "division";
    scopeId: number;
    scopeLabel: string;
    reason: string;
  }>;
  profile: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    dateOfBirth: string | null;
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

function sanitizePhone(raw: string) {
  return raw.replace(/\D/g, "").slice(0, 15);
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

function buildDatabaseEventFilters(input?: { search?: string; start?: Date; end?: Date }) {
  const conditions: SQL<unknown>[] = [];
  if (input?.start && input?.end) {
    const overlapCondition = and(lt(events.startDatetime, input.end), gt(events.endDatetime, input.start));
    if (overlapCondition) {
      conditions.push(overlapCondition);
    }
  } else {
    if (input?.start) {
      conditions.push(gte(events.startDatetime, input.start));
    }
    if (input?.end) {
      conditions.push(lt(events.startDatetime, input.end));
    }
  }
  if (input?.search) {
    const trimmed = input.search.trim();
    if (trimmed.length > 0) {
      const like = `%${trimmed.replace(/[%_]/g, (match) => `\\${match}`)}%`;
      const numericId = Number(trimmed);
      const idCondition = Number.isInteger(numericId) && numericId > 0 ? eq(events.id, numericId) : null;
      const searchCondition = or(
        ilike(events.title, like),
        ilike(events.location, like),
        eq(events.eventCode, trimmed),
        eq(events.zendeskTicketNumber, trimmed),
        ...(idCondition ? [idCondition] : []),
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }
  }

  if (conditions.length === 0) return null;
  return and(...conditions) ?? null;
}

function deriveUpdatedEventLocation(options: {
  location: string | null;
  oldAcronym: string;
  nextAcronym: string;
  oldName: string;
  nextName: string;
}) {
  const { location, oldAcronym, nextAcronym, oldName, nextName } = options;
  if (!location) return null;
  const trimmed = location.trim();
  if (!trimmed) return null;

  const oldAcr = oldAcronym.trim();
  const newAcr = nextAcronym.trim();
  if (oldAcr && newAcr && oldAcr.toUpperCase() !== newAcr.toUpperCase()) {
    const compact = trimmed.toUpperCase().replace(/\s+|-/g, "");
    const oldCompact = oldAcr.toUpperCase();
    if (compact.startsWith(oldCompact)) {
      const remainder = compact.slice(oldCompact.length);
      if (!remainder) return newAcr;
      if (/^[0-9][A-Z0-9]*$/.test(remainder)) {
        return `${newAcr} ${remainder}`;
      }
    }
  }

  const oldLabel = oldName.trim();
  const newLabel = nextName.trim();
  if (oldLabel && newLabel && oldLabel.toUpperCase() !== newLabel.toUpperCase()) {
    if (trimmed.toUpperCase() === oldLabel.toUpperCase()) {
      return newLabel;
    }
  }

  return null;
}


async function findBusinessId(db: DbReader): Promise<number | null> {
  const [business] = await db.select({ id: businesses.id }).from(businesses).orderBy(businesses.id).limit(1);
  return business?.id ?? null;
}

async function findDefaultDepartmentScope(db: DbReader, businessId: number) {
  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.businessId, businessId))
    .orderBy(departments.id)
    .limit(1);
  if (!department) return null;
  return { scopeType: "department" as const, scopeId: department.id };
}

function wouldCreateDepartmentCycle(
  targetId: number,
  newParentId: number | null,
  parentMap: Map<number, number | null>,
) {
  let current = newParentId;
  while (current !== null && current !== undefined) {
    if (current === targetId) return true;
    current = parentMap.get(current) ?? null;
  }
  return false;
}

async function fetchUsers(db: DbReader, ids?: number[]): Promise<UserSummary[]> {
  const baseQuery = db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
      deactivatedAt: users.deactivatedAt,
      createdAt: users.createdAt,
    })
    .from(users);

  const filteredQuery = ids && ids.length > 0 ? baseQuery.where(inArray(users.id, ids)) : baseQuery;
  const userRows = await filteredQuery.orderBy(desc(users.createdAt), users.id);
  if (userRows.length === 0) return [];

  const userIds = userRows.map((row) => row.id);

  const [profileRows, activityRows, roleRows, grantRows] = await Promise.all([
    db
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
      .where(inArray(profiles.userId, userIds)),
    db
      .select({
        userId: calendars.userId,
        lastActivity: sql<Date | null>`max(${events.startDatetime})`,
        totalEvents: sql<number>`count(${events.id})::int`,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(inArray(calendars.userId, userIds))
      .groupBy(calendars.userId),
    db
      .select({
        userId: organizationRoles.userId,
        roleType: organizationRoles.roleType,
        scopeType: organizationRoles.scopeType,
        scopeId: organizationRoles.scopeId,
      })
      .from(organizationRoles)
      .where(inArray(organizationRoles.userId, userIds)),
    db
      .select({
        id: visibilityGrants.id,
        userId: visibilityGrants.userId,
        scopeType: visibilityGrants.scopeType,
        scopeId: visibilityGrants.scopeId,
        reason: visibilityGrants.reason,
      })
      .from(visibilityGrants)
      .where(inArray(visibilityGrants.userId, userIds)),
  ]);

  const profileMap = new Map<number, (typeof profileRows)[number]>();
  for (const profile of profileRows) {
    if (profile.userId !== null) profileMap.set(profile.userId, profile);
  }

  const activityMap = new Map<number, { lastActivity: Date | null; totalEvents: number }>();
  for (const activity of activityRows) {
    activityMap.set(activity.userId, {
      lastActivity: activity.lastActivity,
      totalEvents: activity.totalEvents ?? 0,
    });
  }

  const businessId = await findBusinessId(db);
  const businessRow =
    businessId !== null
      ? await db
          .select({ id: businesses.id, name: businesses.name })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;

  const departmentRows =
    businessId !== null
      ? await db
          .select({ id: departments.id, name: departments.name, parentDepartmentId: departments.parentDepartmentId })
          .from(departments)
          .where(eq(departments.businessId, businessId))
      : [];

  const departmentMap = new Map<number, { name: string; parentDepartmentId: number | null }>();
  for (const dept of departmentRows) {
    departmentMap.set(dept.id, { name: dept.name, parentDepartmentId: dept.parentDepartmentId ?? null });
  }

  const scopeLabel = (scopeType: "business" | "department" | "division", scopeId: number) => {
    if (scopeType === "business") {
      return `${businessRow?.name ?? "Business"} (Business)`;
    }
    const dept = departmentMap.get(scopeId);
    const suffix = scopeType === "division" ? "Division" : "Department";
    return `${dept?.name ?? "Unknown"} (${suffix})`;
  };

  const priority = new Map<"admin" | "co_admin" | "manager" | "employee", number>([
    ["admin", 4],
    ["co_admin", 3],
    ["manager", 2],
    ["employee", 1],
  ]);
  const roleMap = new Map<number, "admin" | "co_admin" | "manager" | "employee">();
  const rolesByUser = new Map<number, UserSummary["roles"]>();
  for (const role of roleRows) {
    const existing = roleMap.get(role.userId);
    if (!existing || (priority.get(role.roleType) ?? 0) > (priority.get(existing) ?? 0)) {
      roleMap.set(role.userId, role.roleType);
    }
    const list = rolesByUser.get(role.userId) ?? [];
    list.push({
      roleType: role.roleType,
      scopeType: role.scopeType,
      scopeId: role.scopeId,
      scopeLabel: scopeLabel(role.scopeType, role.scopeId),
    });
    rolesByUser.set(role.userId, list);
  }

  const grantsByUser = new Map<number, UserSummary["visibilityGrants"]>();
  for (const grant of grantRows) {
    const list = grantsByUser.get(grant.userId) ?? [];
    list.push({
      id: grant.id,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      scopeLabel: scopeLabel(grant.scopeType, grant.scopeId),
      reason: grant.reason,
    });
    grantsByUser.set(grant.userId, list);
  }

  return userRows.map((user) => {
    const profile = profileMap.get(user.id) ?? null;
    const activity = activityMap.get(user.id);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      deactivatedAt: user.deactivatedAt ?? null,
      createdAt: user.createdAt,
      primaryRole: roleMap.get(user.id) ?? null,
      roles: rolesByUser.get(user.id) ?? [],
      visibilityGrants: grantsByUser.get(user.id) ?? [],
      profile: profile
        ? {
            id: profile.id,
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            phoneNumber: profile.phoneNumber,
            dateOfBirth: parseDateOnly(profile.dateOfBirth ?? null),
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
    eventCoOwnerRows,
    attendeeRows,
    reminderRows,
    hourLogRows,
    confirmationRows,
    visibilityGrantRows,
    auditLogRows,
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
    db.select().from(eventCoOwners).orderBy(eventCoOwners.id),
    db.select().from(eventAttendees).orderBy(eventAttendees.id),
    db.select().from(eventReminders).orderBy(eventReminders.id),
    db.select().from(eventHourLogs).orderBy(eventHourLogs.id),
    db.select().from(eventZendeskConfirmations).orderBy(eventZendeskConfirmations.id),
    db.select().from(visibilityGrants).orderBy(visibilityGrants.id),
    db.select().from(auditLogs).orderBy(auditLogs.id),
  ]);

  return {
    users: userRows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      isActive: row.isActive,
      deactivatedAt: serializeTimestamp(row.deactivatedAt),
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
      isPersonal: row.isPersonal,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    events: eventRows.map((row) => ({
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
    eventCoOwners: eventCoOwnerRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      profileId: row.profileId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
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
    visibilityGrants: visibilityGrantRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      createdByUserId: row.createdByUserId ?? null,
      reason: row.reason,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
    auditLogs: auditLogRows.map((row) => ({
      id: row.id,
      businessId: row.businessId ?? null,
      actorUserId: row.actorUserId ?? null,
      actorProfileId: row.actorProfileId ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      scopeType: row.scopeType ?? null,
      scopeId: row.scopeId ?? null,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
  };
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
    "event",
    "event_co_owner",
    "event_attendee",
    "event_reminder",
    "event_hour_log",
    "event_zendesk_confirmation",
    "visibility_grant",
    "audit_log",
  ].map(withDbTablePrefix);

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
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    await requireAdminCapability(ctx.db, ctx.session, "dashboard:view");
    const now = new Date();
    const trendRangeStart = startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_IN_TREND - 1), 1)));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_IN_DAY);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * MS_IN_DAY);
    const fourteenDaysAhead = new Date(now.getTime() + 14 * MS_IN_DAY);

    const userCountRows = await ctx.db.select({ totalUsers: sql<number>`count(${users.id})::int` }).from(users);
    const totalUsers = userCountRows[0]?.totalUsers ?? 0;

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

  reports: protectedProcedure.query(async ({ ctx }) => {
    const context = await requireAdminCapability(ctx.db, ctx.session, "reports:view");
    const now = new Date();
    const windowStart = new Date(now.getTime() - REPORT_WINDOW_DAYS * MS_IN_DAY);

    let scopeCondition = and(gte(events.startDatetime, windowStart), lt(events.startDatetime, now));
    const visibleScopes = await getVisibleScopes(ctx.db, context.userId);
    if (!visibleScopes.business) {
      const scopeFilters: SQL<unknown>[] = [];
      if (visibleScopes.departmentIds.length > 0) {
        const departmentCondition = and(
          eq(events.scopeType, "department"),
          inArray(events.scopeId, visibleScopes.departmentIds),
        );
        if (departmentCondition !== undefined) scopeFilters.push(departmentCondition);
      }
      if (visibleScopes.divisionIds.length > 0) {
        const divisionCondition = and(
          eq(events.scopeType, "division"),
          inArray(events.scopeId, visibleScopes.divisionIds),
        );
        if (divisionCondition !== undefined) scopeFilters.push(divisionCondition);
      }
      if (scopeFilters.length === 0) {
        scopeCondition = and(scopeCondition, sql`false`);
      } else {
        const [first, ...rest] = scopeFilters;
        let scopeCombined = first;
        for (const filter of rest) {
          scopeCombined = or(scopeCombined, filter) ?? scopeCombined;
        }
        scopeCondition = and(scopeCondition, scopeCombined) ?? scopeCondition;
      }
    }

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
      .where(scopeCondition)
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
      .map(({ hasConfirmation: _hasConfirmation, ...rest }) => rest);

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

  joinTableExportStatus: protectedProcedure.query(async ({ ctx }) => {
    await requireAdminCapability(ctx.db, ctx.session, "import_export:manage");
    return getJoinTableExportStatus();
  }),

  refreshJoinTableExport: protectedProcedure
    .input(
      z
        .object({
          force: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "import_export:manage");
      const result = await refreshJoinTableExport(ctx.db, input?.force ?? true);
      return {
        refreshed: Boolean(result),
        result,
        status: await getJoinTableExportStatus(),
      };
  }),

  hourLogExportStatus: protectedProcedure.query(async ({ ctx }) => {
    await requireAdminCapability(ctx.db, ctx.session, "import_export:manage");
    return getHourLogExportStatus();
  }),

  refreshHourLogExport: protectedProcedure
    .input(
      z
        .object({
          force: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "import_export:manage");
      const result = await refreshHourLogExport(ctx.db, input?.force ?? true);
      return {
        refreshed: Boolean(result),
        result,
        status: await getHourLogExportStatus(),
      };
    }),

  exportSnapshot: protectedProcedure
    .input(z.object({ note: z.string().max(500).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "import_export:manage");
      const userIdRaw = ctx.session?.user?.id ?? null;
    const userId = userIdRaw ? Number(userIdRaw) : null;
    const user =
      userId && Number.isFinite(userId)
        ? (
            await ctx.db
              .select({
                id: users.id,
                email: users.email,
                displayName: users.displayName,
              })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1)
          )[0]
        : null;

    const data = await loadSnapshotData(ctx.db);
    const note = input?.note?.trim() ? input.note.trim() : undefined;
    const businessId = await findBusinessId(ctx.db);
    if (businessId) {
      await ctx.db.insert(auditLogs).values({
        businessId,
        actorUserId: user?.id ?? null,
        action: "snapshot.export",
        targetType: "snapshot",
        targetId: null,
        scopeType: "business",
        scopeId: businessId,
        metadata: { note },
      });
    }
    return {
      version: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      metadata: {
        app: "eaglevents",
        note,
      },
      exportedBy: {
        userId: user?.id ?? (Number.isFinite(userId) ? userId : null),
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
      },
      data,
    };
  }),

  importIcsEvents: protectedProcedure
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
              zendeskTicketNumber: z.string().trim().max(64).nullable().optional(),
            }),
          )
          .min(1)
          .max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "import_export:manage");
      const [calendar] = await ctx.db
        .select({
          id: calendars.id,
          userId: calendars.userId,
          scopeType: calendars.scopeType,
          scopeId: calendars.scopeId,
        })
        .from(calendars)
        .where(eq(calendars.id, input.calendarId))
        .limit(1);
      if (!calendar) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar not found." });
      }

      const businessId = await findBusinessId(ctx.db);
      if (!businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }

      const [ownerProfile] = await ctx.db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.userId, calendar.userId))
        .limit(1);

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
          ownerProfileId: ownerProfile?.id ?? null,
          scopeType: calendar.scopeType,
          scopeId: calendar.scopeId,
          eventCode: codes[index] ?? generateEventCode(),
          title: event.title,
          isAllDay: event.isAllDay,
          startDatetime: start,
          endDatetime: end,
          zendeskTicketNumber: event.zendeskTicketNumber ?? null,
          createdAt: now,
          updatedAt: now,
        };
      });

      await ctx.db.insert(events).values(values);
      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] importIcsEvents refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] importIcsEvents refresh failed", error);
      });
      return { inserted: values.length };
    }),

  importSnapshot: protectedProcedure
    .input(snapshotSchema)
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "import_export:manage");
      if (input.version !== SNAPSHOT_VERSION) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported snapshot version." });
      }

      const data = input.data;

      await ctx.db.transaction(async (tx) => {
        await tx.delete(eventZendeskConfirmations);
        await tx.delete(eventHourLogs);
        await tx.delete(eventReminders);
        await tx.delete(eventAttendees);
        await tx.delete(eventCoOwners);
        await tx.delete(events);
        await tx.delete(calendars);
        await tx.delete(organizationRoles);
        await tx.delete(visibilityGrants);
        await tx.delete(auditLogs);
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
                isActive: row.isActive ?? true,
                deactivatedAt: parseTimestamp(row.deactivatedAt ?? null),
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

        const fallbackBusinessId = data.businesses[0]?.id ?? null;

        if (data.calendars.length > 0) {
          await tx.insert(calendars).values(
            data.calendars.map((row) => ({
              id: row.id,
              userId: row.userId,
              name: row.name,
              color: row.color,
              isPrimary: row.isPrimary,
              isPersonal: row.isPersonal ?? true,
              scopeType: row.scopeType ?? "business",
              scopeId: row.scopeId ?? fallbackBusinessId ?? row.id,
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
              ownerProfileId: row.ownerProfileId ?? null,
              scopeType: row.scopeType,
              scopeId: row.scopeId,
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

        if (data.eventCoOwners.length > 0) {
          await tx.insert(eventCoOwners).values(
            data.eventCoOwners.map((row) => ({
              id: row.id,
              eventId: row.eventId,
              profileId: row.profileId,
              createdAt: parseRequiredTimestamp(row.createdAt),
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

        if (data.visibilityGrants.length > 0) {
          await tx.insert(visibilityGrants).values(
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
          await tx.insert(auditLogs).values(
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

      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] importSnapshot refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] importSnapshot refresh failed", error);
      });

      const businessId = await findBusinessId(ctx.db);
      if (businessId) {
        const actorUserIdRaw = ctx.session?.user?.id ?? null;
        const actorUserId = actorUserIdRaw ? Number(actorUserIdRaw) : null;
        await ctx.db.insert(auditLogs).values({
          businessId,
          actorUserId: Number.isFinite(actorUserId ?? NaN) ? actorUserId : null,
          action: "snapshot.import",
          targetType: "snapshot",
          targetId: null,
          scopeType: "business",
          scopeId: businessId,
        });
      }

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
          eventCoOwners: data.eventCoOwners.length,
          eventAttendees: data.eventAttendees.length,
          eventReminders: data.eventReminders.length,
          eventHourLogs: data.eventHourLogs.length,
          eventZendeskConfirmations: data.eventZendeskConfirmations.length,
          visibilityGrants: data.visibilityGrants.length,
          auditLogs: data.auditLogs.length,
        },
      };
  }),

  databaseSummary: protectedProcedure.query(async ({ ctx }) => {
    await requireAdminCapability(ctx.db, ctx.session, "database:manage");
    const [
      eventsCount,
      eventCoOwnerCount,
      attendeeCount,
      reminderCount,
      hourLogCount,
      confirmationCount,
      calendarCount,
      businessCount,
      buildingCount,
      roomCount,
      departmentCount,
      paletteCount,
      themeProfileCount,
      postCount,
      visibilityGrantCount,
      auditLogCount,
    ] = await Promise.all([
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(events),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(eventCoOwners),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(eventAttendees),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(eventReminders),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(eventHourLogs),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(eventZendeskConfirmations),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(calendars),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(businesses),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(buildings),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(rooms),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(departments),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(themePalettes),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(themeProfiles),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(posts),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(visibilityGrants),
      ctx.db.select({ count: sql<number>`count(*)::int` }).from(auditLogs),
    ]);

    return {
      updatedAt: new Date(),
      counts: {
        events: eventsCount[0]?.count ?? 0,
        eventCoOwners: eventCoOwnerCount[0]?.count ?? 0,
        eventAttendees: attendeeCount[0]?.count ?? 0,
        eventReminders: reminderCount[0]?.count ?? 0,
        eventHourLogs: hourLogCount[0]?.count ?? 0,
        eventZendeskConfirmations: confirmationCount[0]?.count ?? 0,
        calendars: calendarCount[0]?.count ?? 0,
        businesses: businessCount[0]?.count ?? 0,
        buildings: buildingCount[0]?.count ?? 0,
        rooms: roomCount[0]?.count ?? 0,
        departments: departmentCount[0]?.count ?? 0,
        themePalettes: paletteCount[0]?.count ?? 0,
        themeProfiles: themeProfileCount[0]?.count ?? 0,
        posts: postCount[0]?.count ?? 0,
        visibilityGrants: visibilityGrantCount[0]?.count ?? 0,
        auditLogs: auditLogCount[0]?.count ?? 0,
      },
    };
  }),

  seedDatabase: protectedProcedure
    .input(
      z.object({
        mode: z.enum(["workspace", "events", "full", "revert"]),
        eventCount: z.number().int().min(0).max(10000).optional(),
        fakerSeed: z.number().int().optional().nullable(),
        departmentEventTargets: z
          .array(
            z.object({
              scopeType: z.enum(["department", "division"]),
              scopeId: z.number().int().positive(),
              eventCount: z.number().int().min(0).max(10000),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "database:manage");
      const mode = input.mode;
      const eventCount = input.eventCount ?? getDefaultEventCount(mode);
      const logs: string[] = [];
      const log = (message: string) => {
        logs.push(message);
      };

      const [{ appRouter }, { createTRPCContext }, { ensurePrimaryCalendars }] = await Promise.all([
        import("~/server/api/root"),
        import("~/server/api/trpc"),
        import("~/server/services/calendar"),
      ]);

      const buildHeaders = () => {
        const headers = new Headers();
        headers.set("x-trpc-source", "admin-seed");
        headers.set("x-seed-mode", mode);
        return headers;
      };

      const createCallerForSession = async (session?: Session | null) => {
        const context = await createTRPCContext({
          headers: buildHeaders(),
          session: session ?? null,
        });
        return appRouter.createCaller(context);
      };

      const ensureCalendarId = async (userId: number) => {
        const calendars = await ensurePrimaryCalendars(ctx.db, userId);
        const primary = calendars.find((cal) => cal.isPrimary) ?? calendars[0];
        if (!primary) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to resolve calendar for user ${userId}`,
          });
        }
        return primary.id;
      };

      const result = await runSeed(
        {
          mode,
          eventCount,
          fakerSeed: input.fakerSeed ?? null,
          departmentEventTargets: input.departmentEventTargets ?? [],
        },
        {
          db: ctx.db,
          createCallerForSession,
          ensureCalendarId,
          log,
        },
      );

      return {
        ...result,
        logs,
      };
    }),

  databaseEvents: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().min(1).optional(),
          start: z.coerce.date().optional(),
          end: z.coerce.date().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "database:manage");
      const limit = input?.limit ?? 50;
      const whereClause = buildDatabaseEventFilters(input);

      const baseQuery = ctx.db
        .select({
          id: events.id,
          title: events.title,
          eventCode: events.eventCode,
          startDatetime: events.startDatetime,
          endDatetime: events.endDatetime,
          calendarId: events.calendarId,
          buildingId: events.buildingId,
          assigneeProfileId: events.assigneeProfileId,
          zendeskTicketNumber: events.zendeskTicketNumber,
          updatedAt: events.updatedAt,
        })
        .from(events);
      const eventRows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
        .orderBy(desc(events.startDatetime), desc(events.id))
        .limit(limit);

      const totalRowsQuery = ctx.db.select({ count: sql<number>`count(*)::int` }).from(events);
      const totalRows = whereClause ? await totalRowsQuery.where(whereClause) : await totalRowsQuery;
      const total = totalRows[0]?.count ?? 0;

      const eventIds = eventRows.map((row) => row.id);
      if (eventIds.length === 0) {
        return { events: [], total };
      }

      const [attendeeRows, reminderRows, hourLogRows, confirmationRows] = await Promise.all([
        ctx.db
          .select({ eventId: eventAttendees.eventId, count: sql<number>`count(*)::int` })
          .from(eventAttendees)
          .where(inArray(eventAttendees.eventId, eventIds))
          .groupBy(eventAttendees.eventId),
        ctx.db
          .select({ eventId: eventReminders.eventId, count: sql<number>`count(*)::int` })
          .from(eventReminders)
          .where(inArray(eventReminders.eventId, eventIds))
          .groupBy(eventReminders.eventId),
        ctx.db
          .select({ eventId: eventHourLogs.eventId, count: sql<number>`count(*)::int` })
          .from(eventHourLogs)
          .where(inArray(eventHourLogs.eventId, eventIds))
          .groupBy(eventHourLogs.eventId),
        ctx.db
          .select({ eventId: eventZendeskConfirmations.eventId, count: sql<number>`count(*)::int` })
          .from(eventZendeskConfirmations)
          .where(inArray(eventZendeskConfirmations.eventId, eventIds))
          .groupBy(eventZendeskConfirmations.eventId),
      ]);

      const attendeeMap = new Map(attendeeRows.map((row) => [row.eventId, row.count]));
      const reminderMap = new Map(reminderRows.map((row) => [row.eventId, row.count]));
      const hourLogMap = new Map(hourLogRows.map((row) => [row.eventId, row.count]));
      const confirmationMap = new Map(confirmationRows.map((row) => [row.eventId, row.count]));

      return {
        total,
        events: eventRows.map((row) => ({
          ...row,
          counts: {
            attendees: attendeeMap.get(row.id) ?? 0,
            reminders: reminderMap.get(row.id) ?? 0,
            hourLogs: hourLogMap.get(row.id) ?? 0,
            confirmations: confirmationMap.get(row.id) ?? 0,
          },
        })),
      };
    }),

  databaseEventCount: protectedProcedure
    .input(
      z.object({
        start: z.coerce.date(),
        end: z.coerce.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "database:manage");
      const [row] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(events)
        .where(and(lt(events.startDatetime, input.end), gt(events.endDatetime, input.start)));
      return { count: row?.count ?? 0 };
    }),

  deleteEvent: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "database:manage");
      const [existing] = await ctx.db.select({ id: events.id }).from(events).where(eq(events.id, input.id)).limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      await ctx.db.delete(events).where(eq(events.id, input.id));

      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] admin deleteEvent refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] admin deleteEvent refresh failed", error);
      });

      return { deleted: input.id };
    }),

  deleteEventsByRange: protectedProcedure
    .input(
      z
        .object({
          start: z.coerce.date(),
          end: z.coerce.date(),
        })
        .refine((value) => value.end > value.start, { message: "End date must be after the start date." }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "database:manage");
      const eventRows = await ctx.db
        .select({ id: events.id })
        .from(events)
        .where(and(lt(events.startDatetime, input.end), gt(events.endDatetime, input.start)));
      const eventIds = eventRows.map((row) => row.id);
      if (eventIds.length === 0) return { deleted: 0 };

      await ctx.db.delete(events).where(inArray(events.id, eventIds));

      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] admin deleteEventsByRange refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] admin deleteEventsByRange refresh failed", error);
      });

      return { deleted: eventIds.length };
    }),

  deleteAllEvents: protectedProcedure.mutation(async ({ ctx }) => {
    await requireAdminCapability(ctx.db, ctx.session, "database:manage");
    const [countRow] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(events);
    const total = countRow?.count ?? 0;
    if (total === 0) return { deleted: 0 };

    await ctx.db.delete(events).where(sql`true`);

    void refreshJoinTableExport(ctx.db, true).catch((error) => {
      console.error("[join-table-export] admin deleteAllEvents refresh failed", error);
    });
    void refreshHourLogExport(ctx.db, true).catch((error) => {
      console.error("[hour-log-export] admin deleteAllEvents refresh failed", error);
    });

    return { deleted: total };
  }),

  companyOverview: protectedProcedure.query(async ({ ctx }) => {
    await requireAdminCapability(ctx.db, ctx.session, "company:manage");
    const status = await getSetupStatus(ctx.db);
    return {
      business: status.business,
      buildings: status.buildings,
      departments: status.departments,
    };
  }),

  updateBusiness: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(255), type: z.enum(businessTypeValues) }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const status = await getSetupStatus(ctx.db);
      if (!status.business) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }
      const name = input.name.trim();
      await ctx.db
        .update(businesses)
        .set({ name, type: input.type, updatedAt: new Date() })
        .where(eq(businesses.id, status.business.id));
      return { id: status.business.id };
    }),

  createBuilding: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        acronym: z.string().min(2).max(16),
        rooms: z.array(z.string().min(1).max(64)).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const businessId = await findBusinessId(ctx.db);
      if (!businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }
      const dedupedRooms = Array.from(new Set(input.rooms.map((room) => room.trim()).filter(Boolean)));
      if (dedupedRooms.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one valid room number." });
      }
      const [buildingRow] = await ctx.db
        .insert(buildings)
        .values({
          businessId,
          name: input.name.trim(),
          acronym: input.acronym.trim(),
        })
        .returning({ id: buildings.id });
      if (!buildingRow) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create building." });
      }
      if (dedupedRooms.length > 0) {
        await ctx.db.insert(rooms).values(
          dedupedRooms.map((roomNumber) => ({
            buildingId: buildingRow.id,
            roomNumber,
          })),
        );
      }
      return { id: buildingRow.id };
    }),

  updateBuilding: protectedProcedure
    .input(
      z
        .object({
          buildingId: z.number().int().positive(),
          name: z.string().min(2).max(255).optional(),
          acronym: z.string().min(2).max(16).optional(),
        })
        .refine((value) => value.name !== undefined || value.acronym !== undefined, { message: "No updates provided" }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const [buildingRow] = await ctx.db
        .select({
          id: buildings.id,
          businessId: buildings.businessId,
          name: buildings.name,
          acronym: buildings.acronym,
        })
        .from(buildings)
        .where(eq(buildings.id, input.buildingId))
        .limit(1);
      if (!buildingRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Building not found." });
      }
      const businessId = await findBusinessId(ctx.db);
      if (businessId && buildingRow.businessId !== businessId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Building does not belong to this business." });
      }
      const nextName = input.name?.trim() ?? buildingRow.name;
      const nextAcronym = input.acronym?.trim() ?? buildingRow.acronym;
      const nameChanged = nextName !== buildingRow.name;
      const acronymChanged = nextAcronym !== buildingRow.acronym;

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(buildings)
          .set({
            name: input.name?.trim(),
            acronym: input.acronym?.trim(),
            updatedAt: new Date(),
          })
          .where(eq(buildings.id, input.buildingId));

        if (!nameChanged && !acronymChanged) return;

        const eventRows = await tx
          .select({ id: events.id, location: events.location })
          .from(events)
          .where(eq(events.buildingId, input.buildingId));

        for (const eventRow of eventRows) {
          const nextLocation = deriveUpdatedEventLocation({
            location: eventRow.location,
            oldAcronym: buildingRow.acronym,
            nextAcronym,
            oldName: buildingRow.name,
            nextName,
          });
          if (!nextLocation || nextLocation === eventRow.location) continue;
          await tx
            .update(events)
            .set({ location: nextLocation, updatedAt: new Date() })
            .where(eq(events.id, eventRow.id));
        }
      });
      return { id: input.buildingId };
    }),

  deleteBuilding: protectedProcedure
    .input(z.object({ buildingId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const [buildingRow] = await ctx.db
        .select({ id: buildings.id, businessId: buildings.businessId })
        .from(buildings)
        .where(eq(buildings.id, input.buildingId))
        .limit(1);
      if (!buildingRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Building not found." });
      }
      const businessId = await findBusinessId(ctx.db);
      if (businessId && buildingRow.businessId !== businessId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Building does not belong to this business." });
      }
      await ctx.db.delete(buildings).where(eq(buildings.id, input.buildingId));
      return { deleted: input.buildingId };
    }),

  createRoom: protectedProcedure
    .input(z.object({ buildingId: z.number().int().positive(), roomNumber: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const roomNumber = input.roomNumber.trim();
      if (!roomNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Room number is required." });
      }
      const [buildingRow] = await ctx.db
        .select({ id: buildings.id, businessId: buildings.businessId })
        .from(buildings)
        .where(eq(buildings.id, input.buildingId))
        .limit(1);
      if (!buildingRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Building not found." });
      }
      const businessId = await findBusinessId(ctx.db);
      if (businessId && buildingRow.businessId !== businessId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Building does not belong to this business." });
      }
      const [roomRow] = await ctx.db
        .insert(rooms)
        .values({ buildingId: input.buildingId, roomNumber })
        .returning({ id: rooms.id });
      if (!roomRow) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create room." });
      }
      return { id: roomRow.id };
    }),

  updateRoom: protectedProcedure
    .input(z.object({ roomId: z.number().int().positive(), roomNumber: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const roomNumber = input.roomNumber.trim();
      if (!roomNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Room number is required." });
      }
      const [roomRow] = await ctx.db
        .select({
          id: rooms.id,
          buildingId: rooms.buildingId,
          businessId: buildings.businessId,
        })
        .from(rooms)
        .innerJoin(buildings, eq(rooms.buildingId, buildings.id))
        .where(eq(rooms.id, input.roomId))
        .limit(1);
      if (!roomRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
      }
      const businessId = await findBusinessId(ctx.db);
      if (businessId && roomRow.businessId !== businessId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Room does not belong to this business." });
      }
      await ctx.db
        .update(rooms)
        .set({ roomNumber, updatedAt: new Date() })
        .where(eq(rooms.id, input.roomId));
      return { id: input.roomId };
    }),

  deleteRoom: protectedProcedure
    .input(z.object({ roomId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const [roomRow] = await ctx.db
        .select({
          id: rooms.id,
          buildingId: rooms.buildingId,
          businessId: buildings.businessId,
        })
        .from(rooms)
        .innerJoin(buildings, eq(rooms.buildingId, buildings.id))
        .where(eq(rooms.id, input.roomId))
        .limit(1);
      if (!roomRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found." });
      }
      const businessId = await findBusinessId(ctx.db);
      if (businessId && roomRow.businessId !== businessId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Room does not belong to this business." });
      }
      await ctx.db.delete(rooms).where(eq(rooms.id, input.roomId));
      return { deleted: input.roomId };
    }),

  createDepartment: protectedProcedure
    .input(z.object({ name: z.string().min(2).max(255), parentDepartmentId: z.number().int().positive().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const businessId = await findBusinessId(ctx.db);
      if (!businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }
      const parentId = input.parentDepartmentId ?? null;
      if (parentId !== null) {
        const [parentRow] = await ctx.db
          .select({ id: departments.id, businessId: departments.businessId })
          .from(departments)
          .where(eq(departments.id, parentId))
          .limit(1);
        if (parentRow?.businessId !== businessId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Parent department not found." });
        }
      }
      const [departmentRow] = await ctx.db
        .insert(departments)
        .values({ businessId, name: input.name.trim(), parentDepartmentId: parentId })
        .returning({ id: departments.id });
      if (!departmentRow) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create department." });
      }
      return { id: departmentRow.id };
    }),

  updateDepartment: protectedProcedure
    .input(
      z
        .object({
          departmentId: z.number().int().positive(),
          name: z.string().min(2).max(255).optional(),
          parentDepartmentId: z.number().int().positive().nullable().optional(),
        })
        .refine((value) => value.name !== undefined || value.parentDepartmentId !== undefined, { message: "No updates provided" }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const businessId = await findBusinessId(ctx.db);
      if (!businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }
      const [departmentRow] = await ctx.db
        .select({ id: departments.id, businessId: departments.businessId })
        .from(departments)
        .where(eq(departments.id, input.departmentId))
        .limit(1);
      if (departmentRow?.businessId !== businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Department not found." });
      }

      const updates: Partial<typeof departments.$inferInsert> = {};
      if (input.name !== undefined) {
        updates.name = input.name.trim();
      }

      if (input.parentDepartmentId !== undefined) {
        if (input.parentDepartmentId === input.departmentId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Department cannot be its own parent." });
        }
        const parentId = input.parentDepartmentId;
        if (parentId !== null) {
          const [parentRow] = await ctx.db
            .select({ id: departments.id, businessId: departments.businessId })
            .from(departments)
            .where(eq(departments.id, parentId))
            .limit(1);
          if (parentRow?.businessId !== businessId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Parent department not found." });
          }
        }

        const departmentRows = await ctx.db
          .select({ id: departments.id, parentDepartmentId: departments.parentDepartmentId })
          .from(departments)
          .where(eq(departments.businessId, businessId));
        const parentMap = new Map(departmentRows.map((row) => [row.id, row.parentDepartmentId ?? null]));
        if (wouldCreateDepartmentCycle(input.departmentId, parentId, parentMap)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Department hierarchy cannot contain cycles." });
        }
        updates.parentDepartmentId = parentId;
      }

      await ctx.db.update(departments).set({ ...updates, updatedAt: new Date() }).where(eq(departments.id, input.departmentId));
      return { id: input.departmentId };
    }),

  deleteDepartment: protectedProcedure
    .input(z.object({ departmentId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminCapability(ctx.db, ctx.session, "company:manage");
      const businessId = await findBusinessId(ctx.db);
      if (!businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }
      const [departmentRow] = await ctx.db
        .select({ id: departments.id, businessId: departments.businessId })
        .from(departments)
        .where(eq(departments.id, input.departmentId))
        .limit(1);
      if (departmentRow?.businessId !== businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Department not found." });
      }
      await ctx.db.delete(departments).where(eq(departments.id, input.departmentId));
      return { deleted: input.departmentId };
    }),

  permissions: protectedProcedure.query(async ({ ctx }) => {
    const context = await getPermissionContext(ctx.db, ctx.session);
    return {
      primaryRole: context.primaryRole,
      capabilities: context.capabilities,
      roles: context.roles,
    };
  }),

  users: protectedProcedure.query(async ({ ctx }) => {
    const context = await requireAdminCapability(ctx.db, ctx.session, "users:manage");
    const hasBusinessAdmin = context.roles.some((role) => role.scopeType === "business");
    if (hasBusinessAdmin) {
      return { users: await fetchUsers(ctx.db) };
    }

    const visibleScopes = await getVisibleScopes(ctx.db, context.userId);
    if (visibleScopes.business) {
      return { users: await fetchUsers(ctx.db) };
    }

    const scopedUserIds = await getUsersInScopes(ctx.db, {
      departmentIds: visibleScopes.departmentIds,
      divisionIds: visibleScopes.divisionIds,
    });
    if (scopedUserIds.length === 0) {
      return { users: [] };
    }
    return { users: await fetchUsers(ctx.db, scopedUserIds) };
  }),

  addVisibilityGrant: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        scopeType: z.enum(["business", "department", "division"]),
        scopeId: z.number().int().positive(),
        reason: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const context = await requireAdminCapability(ctx.db, ctx.session, "visibility_grants:manage");
      const businessId = await findBusinessId(ctx.db);
      if (!businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }

      const [userRow] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!userRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }

      if (input.scopeType === "business") {
        if (input.scopeId !== businessId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Business grant must target the current business." });
        }
      } else {
        const [departmentRow] = await ctx.db
          .select({ id: departments.id, parentDepartmentId: departments.parentDepartmentId, businessId: departments.businessId })
          .from(departments)
          .where(eq(departments.id, input.scopeId))
          .limit(1);
        if (departmentRow?.businessId !== businessId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Department scope not found." });
        }
        const isDivision = departmentRow.parentDepartmentId !== null;
        if (input.scopeType === "department" && isDivision) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Scope is a division, not a department." });
        }
        if (input.scopeType === "division" && !isDivision) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Scope is a department, not a division." });
        }
      }

      const [existing] = await ctx.db
        .select({ id: visibilityGrants.id })
        .from(visibilityGrants)
        .where(
          and(
            eq(visibilityGrants.userId, input.userId),
            eq(visibilityGrants.scopeType, input.scopeType),
            eq(visibilityGrants.scopeId, input.scopeId),
          ),
        )
        .limit(1);
      if (existing) {
        return { id: existing.id, created: false };
      }

      const [grantRow] = await ctx.db
        .insert(visibilityGrants)
        .values({
          userId: input.userId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          createdByUserId: context.userId,
          reason: input.reason?.trim() ?? "",
        })
        .returning({ id: visibilityGrants.id });

      await ctx.db.insert(auditLogs).values({
        businessId,
        actorUserId: context.userId,
        action: "visibility_grant.add",
        targetType: "user",
        targetId: input.userId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        metadata: { reason: input.reason?.trim() ?? "" },
      });

      return { id: grantRow?.id ?? null, created: true };
    }),

  removeVisibilityGrant: protectedProcedure
    .input(z.object({ grantId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const context = await requireAdminCapability(ctx.db, ctx.session, "visibility_grants:manage");
      const [grantRow] = await ctx.db
        .select({
          id: visibilityGrants.id,
          userId: visibilityGrants.userId,
          scopeType: visibilityGrants.scopeType,
          scopeId: visibilityGrants.scopeId,
        })
        .from(visibilityGrants)
        .where(eq(visibilityGrants.id, input.grantId))
        .limit(1);
      if (!grantRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Visibility grant not found." });
      }

      await ctx.db.delete(visibilityGrants).where(eq(visibilityGrants.id, input.grantId));

      const businessId = await findBusinessId(ctx.db);
      if (businessId) {
        await ctx.db.insert(auditLogs).values({
          businessId,
          actorUserId: context.userId,
          action: "visibility_grant.remove",
          targetType: "user",
          targetId: grantRow.userId,
          scopeType: grantRow.scopeType,
          scopeId: grantRow.scopeId,
        });
      }

      return { deleted: input.grantId };
    }),

  updateUser: protectedProcedure
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
              dateOfBirth: z.string().optional().nullable(),
            })
            .optional(),
          primaryRole: z.enum(["admin", "co_admin", "manager", "employee"]).optional(),
        })
        .refine((value) => value.displayName !== undefined || value.profile !== undefined || value.primaryRole !== undefined, {
          message: "No updates provided",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const context = await requireAdminCapability(ctx.db, ctx.session, "users:manage");
      const isBusinessAdmin = context.roles.some((role) => role.roleType === "admin" && role.scopeType === "business");
      const isBusinessCoAdmin = context.roles.some((role) => role.roleType === "co_admin" && role.scopeType === "business");
      const isManagerOnly = !isBusinessAdmin && !isBusinessCoAdmin;

      if (isManagerOnly) {
        if (input.primaryRole) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Managers cannot change user roles." });
        }
        const visibleScopes = await getVisibleScopes(ctx.db, context.userId);
        if (!visibleScopes.business) {
          const scopedUserIds = await getUsersInScopes(ctx.db, {
            departmentIds: visibleScopes.departmentIds,
            divisionIds: visibleScopes.divisionIds,
          });
          if (!scopedUserIds.includes(input.userId)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can only manage users in your scope." });
          }
        }
      }

      if (input.primaryRole) {
        const allowed = await canAssignRole(ctx.db, ctx.session, input.primaryRole);
        if (!allowed) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to assign that role." });
        }
      }

      return ctx.db.transaction(async (tx) => {
        if (input.displayName !== undefined) {
          await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, input.userId));
        }

        let profileId: number | null = null;
        let existingProfileRecord: { id: number } | undefined;

        if (input.profile) {
          let dateOfBirth: string | null = null;
          if (input.profile.dateOfBirth) {
            const parsed = new Date(input.profile.dateOfBirth);
            if (Number.isNaN(parsed.getTime())) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date of birth." });
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (parsed > today) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Date of birth cannot be in the future." });
            }
            dateOfBirth = input.profile.dateOfBirth;
          }

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
                dateOfBirth,
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
                dateOfBirth,
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
          if (profileId === null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Profile is required to assign roles." });
          }

          const existingScopes = await tx
            .select({
              scopeType: organizationRoles.scopeType,
              scopeId: organizationRoles.scopeId,
            })
            .from(organizationRoles)
            .where(eq(organizationRoles.userId, input.userId));

          const scopesByKey = new Map<string, { scopeType: "business" | "department" | "division"; scopeId: number }>();
          for (const scope of existingScopes) {
            const key = `${scope.scopeType}:${scope.scopeId}`;
            if (!scopesByKey.has(key)) {
              scopesByKey.set(key, { scopeType: scope.scopeType, scopeId: scope.scopeId });
            }
          }

          await tx.delete(organizationRoles).where(eq(organizationRoles.userId, input.userId));

          const businessId = await findBusinessId(tx);
          const roleType = input.primaryRole;
          const scopesToAssign: Array<{ scopeType: "business" | "department" | "division"; scopeId: number }> = [];

          if (roleType === "admin" || roleType === "co_admin") {
            if (businessId === null) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
            }
            scopesToAssign.push({ scopeType: "business", scopeId: businessId });
          } else {
            for (const scope of scopesByKey.values()) {
              if (scope.scopeType === "department" || scope.scopeType === "division") {
                scopesToAssign.push(scope);
              }
            }
            if (scopesToAssign.length === 0 && businessId !== null) {
              const fallback = await findDefaultDepartmentScope(tx, businessId);
              if (fallback) {
                scopesToAssign.push(fallback);
              } else {
                scopesToAssign.push({ scopeType: "business", scopeId: businessId });
              }
            }
          }

          if (scopesToAssign.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No valid scope available for role assignment." });
          }

          await tx.insert(organizationRoles).values(
            scopesToAssign.map((scope) => ({
              userId: input.userId,
              profileId,
              roleType,
              scopeType: scope.scopeType,
              scopeId: scope.scopeId,
            })),
          );

          if (businessId) {
            const auditScope = scopesToAssign[0];
            await tx.insert(auditLogs).values({
              businessId,
              actorUserId: context.userId,
              action: "user.role.update",
              targetType: "user",
              targetId: input.userId,
              scopeType: auditScope?.scopeType ?? "business",
              scopeId: auditScope?.scopeId ?? businessId,
              metadata: { role: input.primaryRole },
            });
          }
        }

        const [updatedUser] = await fetchUsers(tx, [input.userId]);
        if (!updatedUser) {
          throw new Error("User not found after update");
        }

        return updatedUser;
      });
    }),

  createUser: protectedProcedure
    .input(
      z.object({
        username: z.string().min(3).max(50),
        email: z.string().email().max(255),
        password: z.string().min(8).max(255),
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        phoneNumber: z.string().min(10).max(32),
        dateOfBirth: z.string().optional(),
        primaryRole: z.enum(["admin", "co_admin", "manager", "employee"]),
        scopes: z
          .array(
            z.object({
              scopeType: z.enum(["business", "department", "division"]),
              scopeId: z.number().int().positive(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const context = await requireAdminCapability(ctx.db, ctx.session, "users:manage");
      const isBusinessAdmin = context.roles.some((role) => role.roleType === "admin" && role.scopeType === "business");
      const isBusinessCoAdmin = context.roles.some((role) => role.roleType === "co_admin" && role.scopeType === "business");
      const isManager = context.roles.some((role) => role.roleType === "manager");
      const isAdminOrCoAdmin = isBusinessAdmin || isBusinessCoAdmin;
      if (!isAdminOrCoAdmin && !isManager) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to create accounts." });
      }

      if (isManager && input.primaryRole !== "employee") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Managers can only create employee accounts." });
      }

      if (isAdminOrCoAdmin) {
        const allowed = await canAssignRole(ctx.db, ctx.session, input.primaryRole);
        if (!allowed) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to assign that role." });
        }
      }

      const businessId = await findBusinessId(ctx.db);
      if (!businessId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business not found." });
      }

      const username = input.username.trim();
      const emailLower = input.email.trim().toLowerCase();
      const phoneDigits = sanitizePhone(input.phoneNumber);
      if (phoneDigits.length < 10) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phone number must contain at least 10 digits." });
      }

      let dateOfBirth: string | null = null;
      if (input.dateOfBirth) {
        const parsed = new Date(input.dateOfBirth);
        if (Number.isNaN(parsed.getTime())) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date of birth." });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsed > today) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Date of birth cannot be in the future." });
        }
        dateOfBirth = input.dateOfBirth;
      }

      const managerVisibleScopes = isManager ? await getVisibleScopes(ctx.db, context.userId) : null;

      if (input.scopes && input.scopes.length > 0) {
        const allowedDepartments = new Set(managerVisibleScopes?.departmentIds ?? []);
        const allowedDivisions = new Set(managerVisibleScopes?.divisionIds ?? []);
        const seen = new Set<string>();

        for (const scope of input.scopes) {
          const scopeKey = `${scope.scopeType}:${scope.scopeId}`;
          if (seen.has(scopeKey)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate scopes are not allowed." });
          }
          seen.add(scopeKey);

          if (scope.scopeType === "business") {
            if (scope.scopeId !== businessId) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Business scope must match the current business." });
            }
            if (isManager) {
              throw new TRPCError({ code: "FORBIDDEN", message: "Managers cannot assign business-wide scope." });
            }
            continue;
          }

          const [departmentRow] = await ctx.db
            .select({ id: departments.id, parentDepartmentId: departments.parentDepartmentId, businessId: departments.businessId })
            .from(departments)
            .where(eq(departments.id, scope.scopeId))
            .limit(1);
          if (departmentRow?.businessId !== businessId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Department scope not found." });
          }
          const isDivision = departmentRow.parentDepartmentId !== null;
          if (scope.scopeType === "department" && isDivision) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Scope is a division, not a department." });
          }
          if (scope.scopeType === "division" && !isDivision) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Scope is a department, not a division." });
          }

          if (isManager) {
            if (scope.scopeType === "department" && !allowedDepartments.has(scope.scopeId)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "You cannot assign users outside your departments." });
            }
            if (scope.scopeType === "division" && !allowedDivisions.has(scope.scopeId)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "You cannot assign users outside your divisions." });
            }
          }
        }
      }

      return ctx.db.transaction(async (tx) => {
        const [existingUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(or(eq(users.username, username), eq(users.email, emailLower)))
          .limit(1);
        if (existingUser) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Username or email already exists." });
        }

        const passwordHash = await bcrypt.hash(input.password, 10);
        const displayName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

        const [insertedUser] = await tx
          .insert(users)
          .values({
            username,
            email: emailLower,
            displayName,
            passwordHash,
          })
          .returning({ id: users.id });
        if (!insertedUser) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create user." });
        }

        const [profileRow] = await tx
          .insert(profiles)
          .values({
            userId: insertedUser.id,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            email: emailLower,
            phoneNumber: phoneDigits,
            dateOfBirth,
          })
          .returning({ id: profiles.id });
        if (!profileRow) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create profile." });
        }

        const scopesToAssign: Array<{ scopeType: "business" | "department" | "division"; scopeId: number }> = [];
        if (input.scopes && input.scopes.length > 0) {
          if (input.primaryRole === "admin" || input.primaryRole === "co_admin") {
            scopesToAssign.push({ scopeType: "business", scopeId: businessId });
          } else {
            scopesToAssign.push(...input.scopes);
          }
        } else if (isManager) {
          const departmentIds = Array.from(new Set(managerVisibleScopes?.departmentIds ?? [])).sort((a, b) => a - b);
          const divisionIds = Array.from(new Set(managerVisibleScopes?.divisionIds ?? [])).sort((a, b) => a - b);
          for (const id of departmentIds) {
            scopesToAssign.push({ scopeType: "department", scopeId: id });
          }
          for (const id of divisionIds) {
            scopesToAssign.push({ scopeType: "division", scopeId: id });
          }
          if (scopesToAssign.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Managers must be assigned to at least one department or division before creating users.",
            });
          }
        } else if (input.primaryRole === "admin" || input.primaryRole === "co_admin") {
          scopesToAssign.push({ scopeType: "business", scopeId: businessId });
        } else {
          const fallback = await findDefaultDepartmentScope(tx, businessId);
          if (fallback) {
            scopesToAssign.push(fallback);
          } else {
            scopesToAssign.push({ scopeType: "business", scopeId: businessId });
          }
        }

        await tx.insert(organizationRoles).values(
          scopesToAssign.map((scope) => ({
            userId: insertedUser.id,
            profileId: profileRow.id,
            roleType: input.primaryRole,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          })),
        );

        const auditScope = scopesToAssign[0];
        await tx.insert(auditLogs).values({
          businessId,
          actorUserId: context.userId,
          action: "user.create",
          targetType: "user",
          targetId: insertedUser.id,
          scopeType: auditScope?.scopeType ?? "business",
          scopeId: auditScope?.scopeId ?? businessId,
          metadata: { role: input.primaryRole },
        });

        await ensurePrimaryCalendars(tx, insertedUser.id);

        const [createdUser] = await fetchUsers(tx, [insertedUser.id]);
        if (!createdUser) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load created user." });
        }
        return createdUser;
      });
    }),

  deleteUser: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const context = await requireAdminCapability(ctx.db, ctx.session, "users:manage");
      const isBusinessAdmin = context.roles.some((role) => role.roleType === "admin" && role.scopeType === "business");
      const isBusinessCoAdmin = context.roles.some((role) => role.roleType === "co_admin" && role.scopeType === "business");
      const isManager = context.roles.some((role) => role.roleType === "manager");
      const isManagerOnly = !isBusinessAdmin && !isBusinessCoAdmin && isManager;
      const sessionUserId = context.userId;

      if (isManagerOnly) {
        const visibleScopes = await getVisibleScopes(ctx.db, context.userId);
        const scopedUserIds = await getUsersInScopes(ctx.db, {
          departmentIds: visibleScopes.departmentIds,
          divisionIds: visibleScopes.divisionIds,
        });
        if (!scopedUserIds.includes(input.userId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only manage users in your scope." });
        }
      }
      if (sessionUserId === input.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account." });
      }

      const [existingUser] = await ctx.db
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!existingUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      }
      if (!existingUser.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User is already deactivated." });
      }

      await ctx.db
        .update(users)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(eq(users.id, input.userId));

      const businessId = await findBusinessId(ctx.db);
      if (businessId) {
        await ctx.db.insert(auditLogs).values({
          businessId,
          actorUserId: context.userId,
          action: "user.deactivate",
          targetType: "user",
          targetId: input.userId,
          scopeType: "business",
          scopeId: businessId,
        });
      }

      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] admin deactivateUser refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] admin deactivateUser refresh failed", error);
      });

      return { deactivated: input.userId };
    }),
});
