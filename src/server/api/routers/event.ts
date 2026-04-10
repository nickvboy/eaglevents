import { z } from "zod";
import { and, desc, eq, ilike, inArray, isNull, lt, gt, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from "~/server/api/trpc";
import {
  eventCoOwners,
  eventAttendees,
  eventHourLogs,
  eventRooms,
  eventZendeskConfirmations,
  events,
  buildings,
  profiles,
  rooms,
} from "~/server/db/schema";
import { ensurePrimaryCalendars, getAccessibleCalendarIds, getCalendarAccess } from "~/server/services/calendar";
import {
  createEventDateTimeAliases,
  getBusinessDateSettings,
  getDateTimeId,
  hydrateEventRecord,
  resolveDateTimeIds,
} from "~/server/services/date-time";
import { refreshJoinTableExport } from "~/server/services/join-table-export";
import { refreshHourLogExport } from "~/server/services/hour-log-export";
import {
  eventRequestDetailsSchema,
  normalizeEventRequestDetails,
} from "~/server/event-request-schema";
import {
  cleanZendeskTicketNumber as cleanUpsertZendeskTicketNumber,
  createEventFromInput,
  eventCreateInputSchema,
  eventUpdateInputSchema,
  updateEventFromInput,
} from "~/server/services/event-upsert";
import {
  getOptionalPermissionContext,
  requireSessionUserId,
  getSessionProfileId,
  getVisibleScopes,
} from "~/server/services/permissions";
import type { Session } from "next-auth";
import type { db as dbClient } from "~/server/db";
import {
  formatLegacyEquipmentNeededText,
  type EventRequestDetails,
} from "~/types/event-request";

type DbClient = typeof dbClient;
type StoredEventRow = typeof events.$inferSelect;
type EventRow = StoredEventRow & {
  startDatetime: Date;
  endDatetime: Date;
  eventStartTime: Date | null;
  eventEndTime: Date | null;
  setupTime: Date | null;
};
type HydratedEventSelectRow = {
  event: StoredEventRow;
  startDateTime: { instantUtc: Date };
  endDateTime: { instantUtc: Date };
  eventStartDateTime: { instantUtc: Date } | null;
  eventEndDateTime: { instantUtc: Date } | null;
  setupDateTime: { instantUtc: Date } | null;
};
type ProfileSummary = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
};
type EventWithAssignee = EventRow & { assigneeProfile: ProfileSummary | null };
type HourLogResponse = {
  id: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  durationHours: number;
  loggedByProfileId: number | null;
  loggedByProfile: ProfileSummary | null;
};
type EventWithAssigneeAndLogs = EventWithAssignee & {
  hourLogs: HourLogResponse[];
  totalLoggedMinutes: number;
};
type CoOwnerSummary = {
  profileId: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
};
type EventWithCoOwners = EventWithAssigneeAndLogs & {
  coOwners: CoOwnerSummary[];
};
type AttendeeSummary = {
  profileId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
};
type EventResponse = EventWithCoOwners & {
  assigneeProfile: ProfileSummary | null;
  hourLogs: HourLogResponse[];
  totalLoggedMinutes: number;
  attendees: AttendeeSummary[];
};
type EventLocation = {
  roomId: number;
  roomNumber: string;
  buildingId: number;
  buildingName: string;
  acronym: string;
};
type EventResponseWithLocations = EventResponse & {
  locations: EventLocation[];
};
type ZendeskQueueItem = {
  eventId: number;
  title: string;
  zendeskTicketNumber: string | null;
  startDatetime: Date;
  endDatetime: Date;
  startTimeHms: string;
  endTimeHms: string;
  totalLoggedMinutesForUser: number;
  totalLoggedHoursForUser: number;
  totalLoggedDurationHms: string;
  eventCode: string | null;
  confirmed: boolean;
  needsReconfirm: boolean;
};

const requestCategoryValues = [
  "university_affiliated_request_to_university_business",
  "university_affiliated_nonrequest_to_university_business",
  "fgcu_student_affiliated_event",
  "non_affiliated_or_revenue_generating_event",
] as const;

const requestCategorySchema = z.enum(requestCategoryValues);
const zendeskTicketSchema = z.string().trim().max(64);

const hourLogInputSchema = z.object({
  id: z.number().int().positive().optional(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
});

function cleanZendeskTicketNumber(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function resolveEventRequestDetails(input: {
  requestDetails?: EventRequestDetails | null;
  equipmentNeeded?: string | null;
}) {
  const normalizedRequestDetails = normalizeEventRequestDetails(
    input.requestDetails,
  );
  if (normalizedRequestDetails) {
    return {
      requestDetails: normalizedRequestDetails,
      equipmentNeeded: formatLegacyEquipmentNeededText(normalizedRequestDetails),
    };
  }

  const legacyText = input.equipmentNeeded?.trim();
  if (!legacyText) {
    return {
      requestDetails: null,
      equipmentNeeded: null,
    };
  }

  return {
    requestDetails: {
      version: 1,
      equipmentNeededText: legacyText,
    } satisfies EventRequestDetails,
    equipmentNeeded: formatLegacyEquipmentNeededText(legacyText),
  };
}

async function requireSessionProfileId(ctx: { session: Session | null; db: DbClient }) {
  const profileId = await getSessionProfileId(ctx.db, ctx.session);
  if (profileId === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in to access your tickets." });
  }
  return profileId;
}

async function attachAssignees(db: DbClient, rows: EventRow[]): Promise<EventWithAssignee[]> {
  if (rows.length === 0) return [];
  const assigneeIds = Array.from(
    new Set(
      rows
        .map((row) => row.assigneeProfileId)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ),
  );
  let assigneeMap = new Map<number, ProfileSummary>();
  if (assigneeIds.length > 0) {
    const assigneeRows = await db
      .select({
        id: profiles.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
      })
      .from(profiles)
      .where(inArray(profiles.id, assigneeIds));
    assigneeMap = new Map(assigneeRows.map((row) => [row.id, row]));
  }
  return rows.map((row) => ({
    ...row,
    assigneeProfile: row.assigneeProfileId ? assigneeMap.get(row.assigneeProfileId) ?? null : null,
  }));
}

async function attachHourLogs(db: DbClient, rows: EventWithAssignee[]): Promise<EventWithAssigneeAndLogs[]> {
  if (rows.length === 0) return [];
  const eventIds = rows.map((row) => row.id);
  const logRows = await db
    .select({
      log: {
        id: eventHourLogs.id,
        eventId: eventHourLogs.eventId,
        startTime: eventHourLogs.startTime,
        endTime: eventHourLogs.endTime,
        durationMinutes: eventHourLogs.durationMinutes,
        loggedByProfileId: eventHourLogs.loggedByProfileId,
      },
      profile: {
        id: profiles.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
      },
    })
    .from(eventHourLogs)
    .leftJoin(profiles, eq(eventHourLogs.loggedByProfileId, profiles.id))
    .where(inArray(eventHourLogs.eventId, eventIds))
    .orderBy(eventHourLogs.startTime, eventHourLogs.id);

  const grouped = new Map<number, HourLogResponse[]>();
  for (const row of logRows) {
    const { log, profile } = row;
    const list = grouped.get(log.eventId) ?? [];
    list.push({
      id: log.id,
      startTime: log.startTime,
      endTime: log.endTime,
      durationMinutes: log.durationMinutes,
      durationHours: Math.round((log.durationMinutes / 60) * 100) / 100,
      loggedByProfileId: log.loggedByProfileId ?? null,
      loggedByProfile:
        profile?.id != null
          ? {
              id: profile.id,
              firstName: profile.firstName,
              lastName: profile.lastName,
              email: profile.email,
            }
          : null,
    });
    grouped.set(log.eventId, list);
  }

  return rows.map((row) => {
    const hourLogs = grouped.get(row.id) ?? [];
    const totalLoggedMinutes = hourLogs.reduce((sum, log) => sum + log.durationMinutes, 0);
    return {
      ...row,
      hourLogs,
      totalLoggedMinutes,
    };
  });
}

async function attachCoOwners(db: DbClient, rows: EventWithAssigneeAndLogs[]): Promise<EventWithCoOwners[]> {
  if (rows.length === 0) return [];
  const eventIds = rows.map((row) => row.id);
  const coOwnerRows = await db
    .select({
      coOwner: {
        eventId: eventCoOwners.eventId,
        profileId: eventCoOwners.profileId,
      },
      profile: {
        id: profiles.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
      },
    })
    .from(eventCoOwners)
    .innerJoin(profiles, eq(eventCoOwners.profileId, profiles.id))
    .where(inArray(eventCoOwners.eventId, eventIds));

  const grouped = new Map<number, CoOwnerSummary[]>();
  for (const row of coOwnerRows) {
    const list = grouped.get(row.coOwner.eventId) ?? [];
    list.push({
      profileId: row.coOwner.profileId,
      firstName: row.profile.firstName,
      lastName: row.profile.lastName,
      email: row.profile.email,
    });
    grouped.set(row.coOwner.eventId, list);
  }

  return rows.map((row) => ({
    ...row,
    coOwners: grouped.get(row.id) ?? [],
  }));
}

async function attachAttendees(db: DbClient, rows: EventWithCoOwners[]): Promise<EventResponse[]> {
  if (rows.length === 0) return [];
  const eventIds = rows.map((row) => row.id);
  const attendeeRows = await db
    .select({
      attendee: {
        eventId: eventAttendees.eventId,
        profileId: eventAttendees.profileId,
        email: eventAttendees.email,
      },
      profile: {
        id: profiles.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
      },
    })
    .from(eventAttendees)
    .leftJoin(profiles, eq(eventAttendees.profileId, profiles.id))
    .where(inArray(eventAttendees.eventId, eventIds));

  const grouped = new Map<number, AttendeeSummary[]>();
  for (const row of attendeeRows) {
    const { attendee, profile } = row;
    const list = grouped.get(attendee.eventId) ?? [];
    list.push({
      profileId: attendee.profileId ?? profile?.id ?? null,
      firstName: profile?.firstName ?? null,
      lastName: profile?.lastName ?? null,
      email: profile?.email ?? attendee.email,
    });
    grouped.set(attendee.eventId, list);
  }

  return rows.map((row) => ({
    ...row,
    attendees: grouped.get(row.id) ?? [],
  }));
}

async function attachLocations(db: DbClient, rows: EventResponse[]): Promise<EventResponseWithLocations[]> {
  if (rows.length === 0) return [];
  const eventIds = rows.map((row) => row.id);
  const locationRows = await db
    .select({
      eventId: eventRooms.eventId,
      roomId: rooms.id,
      roomNumber: rooms.roomNumber,
      buildingId: buildings.id,
      buildingName: buildings.name,
      acronym: buildings.acronym,
    })
    .from(eventRooms)
    .innerJoin(rooms, eq(eventRooms.roomId, rooms.id))
    .innerJoin(buildings, eq(rooms.buildingId, buildings.id))
    .where(inArray(eventRooms.eventId, eventIds))
    .orderBy(buildings.acronym, rooms.roomNumber);

  const grouped = new Map<number, EventLocation[]>();
  for (const row of locationRows) {
    const list = grouped.get(row.eventId) ?? [];
    list.push({
      roomId: row.roomId,
      roomNumber: row.roomNumber,
      buildingId: row.buildingId,
      buildingName: row.buildingName,
      acronym: row.acronym,
    });
    grouped.set(row.eventId, list);
  }

  return rows.map((row) => ({
    ...row,
    locations: grouped.get(row.id) ?? [],
  }));
}

async function buildEventResponses(db: DbClient, rows: EventRow[]): Promise<EventResponseWithLocations[]> {
  const withAssignees = await attachAssignees(db, rows);
  const withLogs = await attachHourLogs(db, withAssignees);
  const withCoOwners = await attachCoOwners(db, withLogs);
  const withAttendees = await attachAttendees(db, withCoOwners);
  return attachLocations(db, withAttendees);
}

function requireResolvedDateTimeId(
  resolved: Awaited<ReturnType<typeof resolveDateTimeIds>>,
  value: Date,
  fieldName: string,
) {
  const id = getDateTimeId(resolved, value);
  if (!id) {
    throw new Error(`Failed to resolve ${fieldName} date-time.`);
  }
  return id;
}

async function selectHydratedEventsByCondition(
  db: DbClient,
  condition?: SQL<unknown>,
  options?: {
    limit?: number;
    offset?: number;
  },
) {
  const aliases = createEventDateTimeAliases("event_lookup");
  const baseQuery = db
    .select({
      event: events,
      startDateTime: {
        instantUtc: aliases.start.instantUtc,
      },
      endDateTime: {
        instantUtc: aliases.end.instantUtc,
      },
      eventStartDateTime: {
        instantUtc: aliases.eventStart.instantUtc,
      },
      eventEndDateTime: {
        instantUtc: aliases.eventEnd.instantUtc,
      },
      setupDateTime: {
        instantUtc: aliases.setup.instantUtc,
      },
    })
    .from(events)
    .innerJoin(aliases.start, eq(events.startDateTimeId, aliases.start.id))
    .innerJoin(aliases.end, eq(events.endDateTimeId, aliases.end.id))
    .leftJoin(aliases.eventStart, eq(events.eventStartDateTimeId, aliases.eventStart.id))
    .leftJoin(aliases.eventEnd, eq(events.eventEndDateTimeId, aliases.eventEnd.id))
    .leftJoin(aliases.setup, eq(events.setupDateTimeId, aliases.setup.id));

  const filteredQuery = condition ? baseQuery.where(condition) : baseQuery;
  const orderedQuery = filteredQuery.orderBy(desc(events.updatedAt), desc(events.id));
  const limitedQuery = typeof options?.limit === "number" ? orderedQuery.limit(options.limit) : orderedQuery;
  const pagedQuery =
    typeof options?.offset === "number" && options.offset > 0 ? limitedQuery.offset(options.offset) : limitedQuery;

  const rows = (await pagedQuery) as HydratedEventSelectRow[];
  return rows.map((row) => hydrateEventRecord(row));
}

async function selectHydratedEventById(db: DbClient, id: number) {
  const rows = await selectHydratedEventsByCondition(db, eq(events.id, id), {
    limit: 1,
  });
  return rows[0] ?? null;
}

function normalizeHourLogs(
  logs: Array<{ id?: number; startTime: Date; endTime: Date }> | undefined,
): Array<{ id?: number; startTime: Date; endTime: Date; durationMinutes: number }> | undefined {
  if (logs === undefined) return undefined;
  const normalized: Array<{ id?: number; startTime: Date; endTime: Date; durationMinutes: number }> = [];
  for (const log of logs) {
    if (!log.startTime || !log.endTime) continue;
    if (log.endTime <= log.startTime) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Hour log end time must be after start time." });
    }
    const durationMinutes = Math.max(1, Math.round((log.endTime.getTime() - log.startTime.getTime()) / 60000));
    normalized.push({
      id: log.id,
      startTime: log.startTime,
      endTime: log.endTime,
      durationMinutes,
    });
  }
  return normalized;
}

function assertReasonableDate(date: Date, fieldName: string) {
  const timestamp = date.getTime();
  const year = date.getUTCFullYear();
  if (Number.isNaN(timestamp) || year < 1900 || year > 2100) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be a valid date between January 1, 1900 and December 31, 2100.`,
    });
  }
}

function assertValidEventTimestamps(input: {
  startDatetime: Date;
  endDatetime: Date;
  eventStartTime?: Date | null | undefined;
  eventEndTime?: Date | null | undefined;
  setupTime?: Date | null | undefined;
}) {
  assertReasonableDate(input.startDatetime, "Start date");
  assertReasonableDate(input.endDatetime, "End date");
  if (input.endDatetime <= input.startDatetime) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Event end time must be after the start time." });
  }
  if (input.eventStartTime) assertReasonableDate(input.eventStartTime, "Event info start time");
  if (input.eventEndTime) assertReasonableDate(input.eventEndTime, "Event info end time");
  if (input.setupTime) assertReasonableDate(input.setupTime, "Setup time");
}

function generateEventCode() {
  return String(Math.floor(1000000 + Math.random() * 9000000));
}

function formatTimeHms(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMinutesToHms(totalMinutes: number) {
  const totalSeconds = Math.round(totalMinutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

async function getUniqueEventCode(db: DbClient) {
  for (let i = 0; i < 5; i++) {
    const candidate = generateEventCode();
    const existing = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.eventCode, candidate))
      .limit(1);
    if (!existing[0]) return candidate;
  }
  throw new Error("Failed to generate a unique event code");
}

function formatLocationSummary(locations: EventLocation[]) {
  if (locations.length === 0) return null;
  const grouped = new Map<number, { acronym: string; rooms: string[] }>();
  for (const entry of locations) {
    const key = entry.buildingId;
    const existing = grouped.get(key);
    if (existing) {
      existing.rooms.push(entry.roomNumber);
    } else {
      grouped.set(key, { acronym: entry.acronym, rooms: [entry.roomNumber] });
    }
  }
  const segments = Array.from(grouped.values()).map((group) => {
    const rooms = Array.from(new Set(group.rooms));
    return rooms.length === 1 ? `${group.acronym} ${rooms[0]}` : `${group.acronym} ${rooms.join(", ")}`;
  });
  return segments.join("; ");
}

async function resolveRoomSelection(
  dbClient: DbClient,
  roomIds: number[],
  businessId: number | null | undefined,
): Promise<EventLocation[]> {
  if (roomIds.length === 0) return [];
  const rows = await dbClient
    .select({
      roomId: rooms.id,
      roomNumber: rooms.roomNumber,
      buildingId: buildings.id,
      buildingName: buildings.name,
      acronym: buildings.acronym,
      businessId: buildings.businessId,
    })
    .from(rooms)
    .innerJoin(buildings, eq(rooms.buildingId, buildings.id))
    .where(inArray(rooms.id, roomIds));

  if (rows.length !== roomIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "One or more rooms could not be found." });
  }
  if (businessId) {
    for (const row of rows) {
      if (row.businessId !== businessId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Room does not belong to this business." });
      }
    }
  }
  return rows.map((row) => ({
    roomId: row.roomId,
    roomNumber: row.roomNumber,
    buildingId: row.buildingId,
    buildingName: row.buildingName,
    acronym: row.acronym,
  }));
}

function buildScopeCondition(visible: { business: boolean; departmentIds: number[]; divisionIds: number[] }) {
  if (visible.business) return null;
  const conditions: SQL<unknown>[] = [];
  if (visible.departmentIds.length > 0) {
    const departmentCondition = and(
      eq(events.scopeType, "department"),
      inArray(events.scopeId, visible.departmentIds),
    );
    if (departmentCondition) conditions.push(departmentCondition);
  }
  if (visible.divisionIds.length > 0) {
    const divisionCondition = and(
      eq(events.scopeType, "division"),
      inArray(events.scopeId, visible.divisionIds),
    );
    if (divisionCondition) conditions.push(divisionCondition);
  }
  if (conditions.length === 0) return sql`false`;
  const [first, ...rest] = conditions;
  let combined = first;
  for (const condition of rest) {
    combined = or(combined, condition) ?? combined;
  }
  return combined;
}

function isScopeVisible(
  eventRow: Pick<EventRow, "scopeType" | "scopeId">,
  visible: { business: boolean; departmentIds: number[]; divisionIds: number[] },
) {
  if (visible.business) return true;
  if (eventRow.scopeType === "department") return visible.departmentIds.includes(eventRow.scopeId);
  if (eventRow.scopeType === "division") return visible.divisionIds.includes(eventRow.scopeId);
  if (eventRow.scopeType === "business") return visible.business;
  return false;
}

async function canEditEvent(
  dbClient: DbClient,
  session: Session | null,
  eventRow: Pick<StoredEventRow, "id" | "calendarId" | "ownerProfileId" | "assigneeProfileId" | "scopeType" | "scopeId">,
) {
  const context = await getOptionalPermissionContext(dbClient, session);
  if (!context) return false;
  const calendarAccess = await getCalendarAccess(dbClient, context.userId, eventRow.calendarId);
  if (!calendarAccess?.canWrite) return false;

  if (context.profileId) {
    if (eventRow.ownerProfileId && eventRow.ownerProfileId === context.profileId) return true;
    if (eventRow.assigneeProfileId && eventRow.assigneeProfileId === context.profileId) return true;
    const [coOwner] = await dbClient
      .select({ id: eventCoOwners.id })
      .from(eventCoOwners)
      .where(and(eq(eventCoOwners.eventId, eventRow.id), eq(eventCoOwners.profileId, context.profileId)))
      .limit(1);
    if (coOwner) return true;
  }

  const visible = await getVisibleScopes(dbClient, context.userId);
  return isScopeVisible(eventRow, visible);
}

export const eventRouter = createTRPCRouter({
  findByIdentifier: protectedProcedure
    .input(z.object({ identifier: z.string().trim().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const trimmed = input.identifier.trim();
      const possibilities: Array<Promise<number | undefined>> = [];
      const numericId = Number(trimmed);
      if (Number.isInteger(numericId) && numericId > 0) {
        possibilities.push(
          ctx.db
            .select({ id: events.id })
            .from(events)
            .where(and(eq(events.id, numericId), eq(events.isArchived, false)))
            .limit(1)
            .then((rows) => rows[0]?.id),
        );
      }

      possibilities.push(
        ctx.db
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.eventCode, trimmed), eq(events.isArchived, false)))
          .limit(1)
          .then((rows) => rows[0]?.id),
      );

      const zendesk = cleanZendeskTicketNumber(trimmed);
      if (zendesk) {
        possibilities.push(
          ctx.db
            .select({ id: events.id })
            .from(events)
            .where(and(eq(events.zendeskTicketNumber, zendesk), eq(events.isArchived, false)))
            .limit(1)
            .then((rows) => rows[0]?.id),
        );
      }

      let resolvedId: number | undefined;
      for (const attempt of possibilities) {
        const candidate = await attempt;
        if (candidate) {
          resolvedId = candidate;
          break;
        }
      }

      if (!resolvedId) return null;
      const resolved = await selectHydratedEventById(ctx.db, resolvedId);
      if (!resolved || resolved.isArchived) return null;
      const context = await getOptionalPermissionContext(ctx.db, ctx.session);
      if (!context) return null;
      const calendarAccess = await getCalendarAccess(ctx.db, context.userId, resolved.calendarId);
      if (!calendarAccess?.canView) {
        return null;
      }
      const visible = await getVisibleScopes(ctx.db, context.userId);
      if (!isScopeVisible(resolved, visible)) {
        return null;
      }
      const [response] = await buildEventResponses(ctx.db, [resolved]);
      return response ?? null;
    }),

  tickets: protectedProcedure
    .input(
      z
        .object({
          assigned: z.boolean().optional(),
          search: z.string().trim().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;

      const conditions: SQL<unknown>[] = [];
      const context = await getOptionalPermissionContext(ctx.db, ctx.session);
      if (!context) return [];
      const accessibleCalendarIds = await getAccessibleCalendarIds(ctx.db, userId);
      if (accessibleCalendarIds.length === 0) return [];
      conditions.push(inArray(events.calendarId, accessibleCalendarIds));
      conditions.push(eq(events.isArchived, false));

      const visible = await getVisibleScopes(ctx.db, context.userId);
      const scopeCondition = buildScopeCondition(visible);
      if (scopeCondition) {
        conditions.push(scopeCondition);
      }
      if (input?.assigned === true) {
        conditions.push(sql`${events.assigneeProfileId} IS NOT NULL`);
      } else if (input?.assigned === false) {
        conditions.push(isNull(events.assigneeProfileId));
      }

      if (input?.search && input.search.trim().length > 0) {
        const trimmedSearch = input.search.trim();
        const like = `%${trimmedSearch.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        const zendeskSearch = cleanZendeskTicketNumber(trimmedSearch);
        const zendeskLike = zendeskSearch
          ? `%${zendeskSearch.replace(/[%_]/g, (m) => `\\${m}`)}%`
          : null;
        const searchCondition = or(
          ilike(events.title, like),
          ilike(events.description, like),
          ilike(events.location, like),
          eq(events.eventCode, trimmedSearch),
          zendeskLike ? ilike(events.zendeskTicketNumber, zendeskLike) : undefined,
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      const whereCond = conditions.length > 0 ? and(...conditions) : null;
      const rows = await selectHydratedEventsByCondition(ctx.db, whereCond ?? undefined, {
        limit,
        offset,
      });
      return buildEventResponses(ctx.db, rows);
    }),
  zendeskQueue: protectedProcedure.query(async ({ ctx }) => {
    const profileId = await requireSessionProfileId(ctx);

    const hourLogs = await ctx.db
      .select({
        eventId: eventHourLogs.eventId,
        durationMinutes: eventHourLogs.durationMinutes,
        endTime: eventHourLogs.endTime,
        createdAt: eventHourLogs.createdAt,
      })
      .from(eventHourLogs)
      .where(eq(eventHourLogs.loggedByProfileId, profileId));

    const totals = new Map<number, number>();
    const latestLogTime = new Map<number, Date>();
    for (const log of hourLogs) {
      const existing = totals.get(log.eventId) ?? 0;
      totals.set(log.eventId, existing + log.durationMinutes);
      const newestInstant = log.createdAt ?? log.endTime;
      if (newestInstant) {
        const prev = latestLogTime.get(log.eventId)?.getTime() ?? -Infinity;
        const next = newestInstant.getTime();
        if (next > prev) latestLogTime.set(log.eventId, newestInstant);
      }
    }

    const hourEventIds = Array.from(totals.keys());
    let condition = eq(events.assigneeProfileId, profileId);
    if (hourEventIds.length > 0) {
      condition = or(condition, inArray(events.id, hourEventIds)) ?? condition;
    }

    const eventRows = await selectHydratedEventsByCondition(
      ctx.db,
      and(condition, eq(events.isArchived, false)),
    );

    const confirmationRows = await ctx.db
      .select({
        eventId: eventZendeskConfirmations.eventId,
        confirmedAt: eventZendeskConfirmations.confirmedAt,
      })
      .from(eventZendeskConfirmations)
      .where(eq(eventZendeskConfirmations.profileId, profileId));
    const confirmedAtMap = new Map<number, Date>();
    for (const row of confirmationRows) {
      if (row.confirmedAt) confirmedAtMap.set(row.eventId, row.confirmedAt);
    }

    const ready: ZendeskQueueItem[] = [];
    const needsLogging: Array<
      ZendeskQueueItem & { status: "no_hours_logged" | "hours_not_confirmed" | "new_hours_unconfirmed" }
    > = [];

    for (const row of eventRows) {
      const totalMinutes = totals.get(row.id) ?? 0;
      const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
      const confirmationAt = confirmedAtMap.get(row.id) ?? null;
      const latestLog = latestLogTime.get(row.id) ?? null;
      const needsReconfirm = confirmationAt && latestLog ? latestLog.getTime() > confirmationAt.getTime() : false;
      const confirmed = confirmationAt !== null && !needsReconfirm;
      const item: ZendeskQueueItem = {
        eventId: row.id,
        title: row.title,
        zendeskTicketNumber: row.zendeskTicketNumber ?? null,
        startDatetime: row.startDatetime,
        endDatetime: row.endDatetime,
        startTimeHms: formatTimeHms(row.startDatetime),
        endTimeHms: formatTimeHms(row.endDatetime),
        totalLoggedMinutesForUser: totalMinutes,
        totalLoggedHoursForUser: totalHours,
        totalLoggedDurationHms: formatMinutesToHms(totalMinutes),
        eventCode: row.eventCode ?? null,
        confirmed,
        needsReconfirm,
      };
      const hasHours = totalMinutes > 0;
      if (!confirmed && hasHours) {
        ready.push(item);
      }
      if (!confirmed || !hasHours) {
        needsLogging.push({
          ...item,
          status: !hasHours ? "no_hours_logged" : needsReconfirm ? "new_hours_unconfirmed" : "hours_not_confirmed",
        });
      }
    }

    ready.sort((a, b) => b.startDatetime.getTime() - a.startDatetime.getTime());
    needsLogging.sort((a, b) => b.startDatetime.getTime() - a.startDatetime.getTime());

    return { ready, needsLogging };
  }),
  confirmZendesk: protectedProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const profileId = await requireSessionProfileId(ctx);

      const eventRows = await ctx.db
        .select({
          id: events.id,
          assigneeProfileId: events.assigneeProfileId,
        })
        .from(events)
        .where(and(eq(events.id, input.eventId), eq(events.isArchived, false)))
        .limit(1);
      const eventRow = eventRows[0];
      if (!eventRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found." });
      }

      const logCountRows = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(eventHourLogs)
        .where(and(eq(eventHourLogs.eventId, input.eventId), eq(eventHourLogs.loggedByProfileId, profileId)))
        .limit(1);
      const logCount = logCountRows[0]?.count ?? 0;

      const canConfirm = eventRow.assigneeProfileId === profileId || logCount > 0;
      if (!canConfirm) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only confirm tickets you have logged or that are assigned to you." });
      }

      const now = new Date();
      await ctx.db
        .insert(eventZendeskConfirmations)
        .values({
          eventId: input.eventId,
          profileId,
          confirmedAt: now,
        })
        .onConflictDoUpdate({
          target: [eventZendeskConfirmations.eventId, eventZendeskConfirmations.profileId],
          set: { confirmedAt: sql`CURRENT_TIMESTAMP` },
        });

      return { success: true, confirmedAt: now };
    }),
  list: protectedProcedure
    .input(
      z.object({
        start: z.coerce.date(),
        end: z.coerce.date(),
        calendarIds: z.array(z.number()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      const accessibleCalendarIds = await getAccessibleCalendarIds(ctx.db, userId);
      if (accessibleCalendarIds.length === 0) return [];
      const visibleCalendarIds =
        input.calendarIds && input.calendarIds.length > 0
          ? input.calendarIds.filter((id) => accessibleCalendarIds.includes(id))
          : accessibleCalendarIds;
      const aliases = createEventDateTimeAliases("event_list");
      let queryCondition: SQL<unknown> | undefined = and(
        lt(aliases.start.instantUtc, input.end),
        gt(aliases.end.instantUtc, input.start),
        eq(events.isArchived, false),
        inArray(events.calendarId, visibleCalendarIds),
      );

      const context = await getOptionalPermissionContext(ctx.db, ctx.session);
      if (!context) return [];
      const visible = await getVisibleScopes(ctx.db, context.userId);
      const scopeCondition = buildScopeCondition(visible);
      if (scopeCondition) {
        queryCondition = and(queryCondition, scopeCondition) ?? queryCondition;
      }
      const listRows = await ctx.db
        .select({
          event: events,
          startDateTime: {
            instantUtc: aliases.start.instantUtc,
          },
          endDateTime: {
            instantUtc: aliases.end.instantUtc,
          },
          eventStartDateTime: {
            instantUtc: aliases.eventStart.instantUtc,
          },
          eventEndDateTime: {
            instantUtc: aliases.eventEnd.instantUtc,
          },
          setupDateTime: {
            instantUtc: aliases.setup.instantUtc,
          },
        })
        .from(events)
        .innerJoin(aliases.start, eq(events.startDateTimeId, aliases.start.id))
        .innerJoin(aliases.end, eq(events.endDateTimeId, aliases.end.id))
        .leftJoin(aliases.eventStart, eq(events.eventStartDateTimeId, aliases.eventStart.id))
        .leftJoin(aliases.eventEnd, eq(events.eventEndDateTimeId, aliases.eventEnd.id))
        .leftJoin(aliases.setup, eq(events.setupDateTimeId, aliases.setup.id))
        .where(queryCondition)
        .orderBy(aliases.start.instantUtc);
      const list = listRows.map(hydrateEventRecord);
      return buildEventResponses(ctx.db, list);
    }),

  create: protectedRateLimitedProcedure
    .input(eventCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await createEventFromInput({
        db: ctx.db,
        session: ctx.session,
        input,
        mode: "manual",
        refreshExports: true,
      });

      const result = await selectHydratedEventById(ctx.db, created.id);
      if (!result) throw new Error("Failed to load created event");
      return result;
    }),

  update: protectedRateLimitedProcedure
    .input(eventUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const updated = await updateEventFromInput({
        db: ctx.db,
        session: ctx.session,
        input,
        mode: "manual",
        refreshExports: true,
      });

      const result = await selectHydratedEventById(ctx.db, updated.id);
      if (!result) throw new Error("Failed to load updated event");
      return result;
    }),

  delete: protectedRateLimitedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(events)
        .where(and(eq(events.id, input.id), eq(events.isArchived, false)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }
      const canEdit = await canEditEvent(ctx.db, ctx.session, existing);
      if (!canEdit) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to delete this event." });
      }
      await ctx.db.delete(events).where(eq(events.id, input.id));
      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] event delete refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] event delete refresh failed", error);
      });
      return { success: true };
    }),
});

