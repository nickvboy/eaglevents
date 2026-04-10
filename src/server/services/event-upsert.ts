import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";

import type { db as dbClient } from "~/server/db";
import {
  buildings,
  calendars,
  eventAttendees,
  eventCoOwners,
  eventHourLogs,
  eventRooms,
  events,
  profiles,
  rooms,
} from "~/server/db/schema";
import {
  createEventDateTimeAliases,
  getBusinessDateSettings,
  getDateTimeId,
  hydrateEventRecord,
  resolveDateTimeIds,
} from "~/server/services/date-time";
import {
  ensurePrimaryCalendars,
  getCalendarAccess,
} from "~/server/services/calendar";
import { refreshHourLogExport } from "~/server/services/hour-log-export";
import { refreshJoinTableExport } from "~/server/services/join-table-export";
import {
  eventRequestDetailsSchema,
  normalizeEventRequestDetails,
} from "~/server/event-request-schema";
import {
  getOptionalPermissionContext,
  getSessionProfileId,
  getVisibleScopes,
  requireSessionUserId,
} from "~/server/services/permissions";
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
type EventLocation = {
  roomId: number;
  roomNumber: string;
  buildingId: number;
  buildingName: string;
  acronym: string;
};
type HydratedEventSelectRow = {
  event: StoredEventRow;
  startDateTime: { instantUtc: Date };
  endDateTime: { instantUtc: Date };
  eventStartDateTime: { instantUtc: Date } | null;
  eventEndDateTime: { instantUtc: Date } | null;
  setupDateTime: { instantUtc: Date } | null;
};

const requestCategoryValues = [
  "university_affiliated_request_to_university_business",
  "university_affiliated_nonrequest_to_university_business",
  "fgcu_student_affiliated_event",
  "non_affiliated_or_revenue_generating_event",
] as const;

export const requestCategorySchema = z.enum(requestCategoryValues);
export const zendeskTicketSchema = z.string().trim().max(64);
export const hourLogInputSchema = z.object({
  id: z.number().int().positive().optional(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
});

export const eventCreateInputSchema = z.object({
  calendarId: z.number().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  buildingId: z.number().int().positive().nullable().optional(),
  roomIds: z.array(z.number().int().positive()).optional(),
  isVirtual: z.boolean().optional(),
  isAllDay: z.boolean().default(false),
  startDatetime: z.coerce.date(),
  endDatetime: z.coerce.date(),
  recurrenceRule: z.string().nullable().optional(),
  assigneeProfileId: z.number().int().positive().optional(),
  coOwnerProfileIds: z.array(z.number().int().positive()).optional(),
  hourLogs: z.array(hourLogInputSchema).optional(),
  attendeeProfileIds: z.array(z.number().int().positive()).min(1, "At least one attendee is required."),
  participantCount: z.number().int().min(0).max(100000).optional(),
  technicianNeeded: z.boolean().optional(),
  requestCategory: requestCategorySchema.optional(),
  equipmentNeeded: z.string().trim().max(2000).optional(),
  requestDetails: eventRequestDetailsSchema.nullable().optional(),
  eventStartTime: z.coerce.date().optional(),
  eventEndTime: z.coerce.date().optional(),
  setupTime: z.coerce.date().optional(),
  zendeskTicketNumber: zendeskTicketSchema.optional(),
});

export const eventUpdateInputSchema = z.object({
  id: z.number(),
  calendarId: z.number().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  buildingId: z.number().int().positive().nullable().optional(),
  roomIds: z.array(z.number().int().positive()).optional(),
  isVirtual: z.boolean().optional(),
  isAllDay: z.boolean(),
  startDatetime: z.coerce.date(),
  endDatetime: z.coerce.date(),
  recurrenceRule: z.string().nullable().optional(),
  assigneeProfileId: z.number().int().positive().nullable().optional(),
  coOwnerProfileIds: z.array(z.number().int().positive()).optional(),
  hourLogs: z.array(hourLogInputSchema).optional(),
  attendeeProfileIds: z.array(z.number().int().positive()).min(1, "At least one attendee is required."),
  participantCount: z.number().int().min(0).max(100000).nullable().optional(),
  technicianNeeded: z.boolean().optional(),
  requestCategory: requestCategorySchema.nullable().optional(),
  equipmentNeeded: z.string().trim().max(2000).nullable().optional(),
  requestDetails: eventRequestDetailsSchema.nullable().optional(),
  eventStartTime: z.coerce.date().nullable().optional(),
  eventEndTime: z.coerce.date().nullable().optional(),
  setupTime: z.coerce.date().nullable().optional(),
  zendeskTicketNumber: zendeskTicketSchema.nullable().optional(),
});

export type EventCreateInput = z.infer<typeof eventCreateInputSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateInputSchema>;
export type EventUpsertMode = "manual" | "admin_import";

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

export function cleanZendeskTicketNumber(value: string | null | undefined) {
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

async function getUniqueEventCode(db: DbClient) {
  for (let i = 0; i < 5; i += 1) {
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
    const uniqueRooms = Array.from(new Set(group.rooms));
    return uniqueRooms.length === 1
      ? `${group.acronym} ${uniqueRooms[0]}`
      : `${group.acronym} ${uniqueRooms.join(", ")}`;
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

async function selectHydratedEventById(db: DbClient, id: number): Promise<EventRow | null> {
  const aliases = createEventDateTimeAliases("event_upsert_lookup");
  const rows = await db
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
    .where(eq(events.id, id))
    .orderBy(desc(events.updatedAt), desc(events.id))
    .limit(1);

  const row = rows[0] as HydratedEventSelectRow | undefined;
  return row ? hydrateEventRecord(row) : null;
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
  return isScopeVisible(eventRow as EventRow, visible);
}

async function resolveCalendarForCreate(options: {
  db: DbClient;
  session: Session | null;
  requestedCalendarId?: number;
  mode: EventUpsertMode;
}) {
  if (options.mode === "manual") {
    const userId = requireSessionUserId(options.session);
    let calendarId = options.requestedCalendarId;
    if (!calendarId) {
      const list = await ensurePrimaryCalendars(options.db, userId);
      const primary = list.find((cal) => cal.isPrimary) ?? list[0];
      if (!primary) throw new Error("Failed to resolve a primary calendar");
      calendarId = primary.id;
    }

    const calendarAccess = await getCalendarAccess(options.db, userId, calendarId);
    if (!calendarAccess?.canWrite) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to that calendar." });
    }
    return {
      calendarId,
      scopeType: calendarAccess.calendar.scopeType,
      scopeId: calendarAccess.calendar.scopeId,
    };
  }

  if (!options.requestedCalendarId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar is required for bulk import rows." });
  }
  const [calendar] = await options.db
    .select({
      id: calendars.id,
      scopeType: calendars.scopeType,
      scopeId: calendars.scopeId,
    })
    .from(calendars)
    .where(eq(calendars.id, options.requestedCalendarId))
    .limit(1);

  if (!calendar) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar not found." });
  }

  return {
    calendarId: calendar.id,
    scopeType: calendar.scopeType,
    scopeId: calendar.scopeId,
  };
}

async function maybeRefreshExports(db: DbClient, refreshExports: boolean) {
  if (!refreshExports) return;
  void refreshJoinTableExport(db, true).catch((error) => {
    console.error("[join-table-export] event upsert refresh failed", error);
  });
  void refreshHourLogExport(db, true).catch((error) => {
    console.error("[hour-log-export] event upsert refresh failed", error);
  });
}

export async function createEventFromInput(options: {
  db: DbClient;
  session: Session | null;
  input: EventCreateInput;
  mode: EventUpsertMode;
  refreshExports?: boolean;
}) {
  const input = eventCreateInputSchema.parse(options.input);
  const refreshExports = options.refreshExports ?? true;
  const calendar = await resolveCalendarForCreate({
    db: options.db,
    session: options.session,
    requestedCalendarId: input.calendarId,
    mode: options.mode,
  });

  const permissionContext = await getOptionalPermissionContext(options.db, options.session);
  const isVirtual = input.isVirtual ?? false;
  const roomIds = Array.from(new Set(input.roomIds ?? [])).filter((id) => Number.isFinite(id));
  const resolvedRooms = await resolveRoomSelection(options.db, roomIds, permissionContext?.businessId ?? null);
  const primaryBuildingId = resolvedRooms[0]?.buildingId ?? null;
  const resolvedBuildingId = roomIds.length > 0 ? primaryBuildingId : input.buildingId ?? null;
  if (!isVirtual && resolvedBuildingId === null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select a building or mark the event as virtual." });
  }
  const resolvedLocation = roomIds.length > 0 ? formatLocationSummary(resolvedRooms) : input.location ?? null;
  const eventCode = await getUniqueEventCode(options.db);
  const hourLogs = normalizeHourLogs(input.hourLogs ?? []) ?? [];
  let sessionProfileId: number | null = null;
  if (hourLogs.length > 0) {
    sessionProfileId = await getSessionProfileId(options.db, options.session);
    if (sessionProfileId === null) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You must be signed in to log hours." });
    }
  }
  const ownerProfileId = await getSessionProfileId(options.db, options.session);
  const zendeskTicketNumber = cleanZendeskTicketNumber(input.zendeskTicketNumber);
  const eventRequest = resolveEventRequestDetails({
    requestDetails: input.requestDetails,
    equipmentNeeded: input.equipmentNeeded,
  });
  const coOwnerIds = Array.from(new Set(input.coOwnerProfileIds ?? []))
    .filter((id) => Number.isFinite(id))
    .filter((id) => (ownerProfileId ? id !== ownerProfileId : true));
  assertValidEventTimestamps({
    startDatetime: input.startDatetime,
    endDatetime: input.endDatetime,
    eventStartTime: input.eventStartTime,
    eventEndTime: input.eventEndTime,
    setupTime: input.setupTime,
  });

  const created = await options.db.transaction(async (tx) => {
    const dateSettings = await getBusinessDateSettings(tx, permissionContext?.businessId ?? null);
    const resolvedDateTimes = await resolveDateTimeIds(tx, dateSettings, [
      input.startDatetime,
      input.endDatetime,
      input.eventStartTime,
      input.eventEndTime,
      input.setupTime,
    ]);

    let assignee: number | null | undefined = input.assigneeProfileId;
    if ((assignee ?? null) === null && hourLogs.length > 0) {
      assignee = sessionProfileId;
    }

    const [row] = await tx
      .insert(events)
      .values({
        calendarId: calendar.calendarId,
        assigneeProfileId: assignee ?? null,
        ownerProfileId,
        scopeType: calendar.scopeType,
        scopeId: calendar.scopeId,
        eventCode,
        title: input.title,
        description: input.description,
        location: resolvedLocation,
        buildingId: resolvedBuildingId,
        isVirtual,
        isAllDay: input.isAllDay,
        startDateTimeId: requireResolvedDateTimeId(resolvedDateTimes, input.startDatetime, "start"),
        endDateTimeId: requireResolvedDateTimeId(resolvedDateTimes, input.endDatetime, "end"),
        recurrenceRule: input.recurrenceRule ?? null,
        participantCount: input.participantCount ?? null,
        technicianNeeded: input.technicianNeeded ?? false,
        requestCategory: input.requestCategory ?? null,
        equipmentNeeded: eventRequest.equipmentNeeded,
        requestDetails: eventRequest.requestDetails,
        eventStartDateTimeId: getDateTimeId(resolvedDateTimes, input.eventStartTime ?? null),
        eventEndDateTimeId: getDateTimeId(resolvedDateTimes, input.eventEndTime ?? null),
        setupDateTimeId: getDateTimeId(resolvedDateTimes, input.setupTime ?? null),
        zendeskTicketNumber,
      } satisfies typeof events.$inferInsert)
      .returning();
    if (!row) throw new Error("Failed to create event");

    if (roomIds.length > 0) {
      await tx.insert(eventRooms).values(
        roomIds.map((roomId) => ({
          eventId: row.id,
          roomId,
        })),
      );
    }

    if (coOwnerIds.length > 0) {
      await tx.insert(eventCoOwners).values(
        coOwnerIds.map((profileId) => ({
          eventId: row.id,
          profileId,
        })),
      );
    }

    if (hourLogs.length > 0) {
      await tx.insert(eventHourLogs).values(
        hourLogs.map((log) => ({
          eventId: row.id,
          startTime: log.startTime,
          endTime: log.endTime,
          durationMinutes: log.durationMinutes,
          loggedByProfileId: sessionProfileId,
        })),
      );
    }

    const attendeeIds = Array.from(new Set(input.attendeeProfileIds ?? [])).filter((id) => Number.isFinite(id));
    if (attendeeIds.length > 0) {
      const attendeeProfiles = await tx
        .select({
          id: profiles.id,
          email: profiles.email,
        })
        .from(profiles)
        .where(inArray(profiles.id, attendeeIds));
      if (attendeeProfiles.length > 0) {
        await tx.insert(eventAttendees).values(
          attendeeProfiles.map((profile) => ({
            eventId: row.id,
            profileId: profile.id,
            email: profile.email,
          })),
        );
      }
    }

    return row;
  });

  await maybeRefreshExports(options.db, refreshExports);
  return created;
}

export async function updateEventFromInput(options: {
  db: DbClient;
  session: Session | null;
  input: EventUpdateInput;
  mode: EventUpsertMode;
  refreshExports?: boolean;
}) {
  const input = eventUpdateInputSchema.parse(options.input);
  const refreshExports = options.refreshExports ?? true;
  const current = await selectHydratedEventById(options.db, input.id);
  if (!current || current.isArchived) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
  }
  if (options.mode === "manual") {
    const canEdit = await canEditEvent(options.db, options.session, current);
    if (!canEdit) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this event." });
    }
  }

  const hourLogs = normalizeHourLogs(input.hourLogs);
  const needsProfileForNewLogs = hourLogs?.some((log) => log.id === undefined) ?? false;
  const sessionProfileIdForNewLogs =
    needsProfileForNewLogs && (hourLogs?.length ?? 0) > 0 ? await getSessionProfileId(options.db, options.session) : null;
  if (needsProfileForNewLogs && sessionProfileIdForNewLogs === null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You must be signed in to log hours." });
  }
  const zendeskTicketNumber = cleanZendeskTicketNumber(
    input.zendeskTicketNumber === undefined ? current.zendeskTicketNumber : input.zendeskTicketNumber,
  );
  const eventRequest =
    input.requestDetails === undefined && input.equipmentNeeded === undefined
      ? {
          requestDetails: current.requestDetails ?? null,
          equipmentNeeded: current.equipmentNeeded ?? null,
        }
      : resolveEventRequestDetails({
          requestDetails:
            input.requestDetails === undefined
              ? (current.requestDetails ?? null)
              : input.requestDetails,
          equipmentNeeded:
            input.equipmentNeeded === undefined
              ? (current.equipmentNeeded ?? null)
              : input.equipmentNeeded,
        });

  const targetCalendarId = input.calendarId ?? current.calendarId;
  let targetCalendar: { calendarId: number; scopeType: EventRow["scopeType"]; scopeId: number };
  if (options.mode === "manual") {
    const userId = requireSessionUserId(options.session);
    const calendarAccess = await getCalendarAccess(options.db, userId, targetCalendarId);
    if (!calendarAccess?.canWrite) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to that calendar." });
    }
    targetCalendar = {
      calendarId: targetCalendarId,
      scopeType: calendarAccess.calendar.scopeType,
      scopeId: calendarAccess.calendar.scopeId,
    };
  } else {
    const [calendar] = await options.db
      .select({
        id: calendars.id,
        scopeType: calendars.scopeType,
        scopeId: calendars.scopeId,
      })
      .from(calendars)
      .where(eq(calendars.id, targetCalendarId))
      .limit(1);
    if (!calendar) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Calendar not found." });
    }
    targetCalendar = {
      calendarId: calendar.id,
      scopeType: calendar.scopeType,
      scopeId: calendar.scopeId,
    };
  }

  const permissionContext = await getOptionalPermissionContext(options.db, options.session);
  const nextIsVirtual = input.isVirtual ?? current.isVirtual;
  const roomIds =
    input.roomIds === undefined
      ? null
      : Array.from(new Set(input.roomIds)).filter((id) => Number.isFinite(id));
  const resolvedRooms =
    roomIds === null ? null : await resolveRoomSelection(options.db, roomIds, permissionContext?.businessId ?? null);
  const primaryBuildingId = resolvedRooms?.[0]?.buildingId ?? null;
  const resolvedBuildingId =
    roomIds && roomIds.length > 0
      ? primaryBuildingId
      : input.buildingId === undefined
        ? current.buildingId
        : input.buildingId;
  if (!nextIsVirtual && resolvedBuildingId === null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select a building or mark the event as virtual." });
  }
  const resolvedLocation =
    resolvedRooms && resolvedRooms.length > 0
      ? formatLocationSummary(resolvedRooms)
      : input.location === undefined
        ? current.location
        : input.location;
  const coOwnerIds = Array.from(new Set(input.coOwnerProfileIds ?? []))
    .filter((id) => Number.isFinite(id))
    .filter((id) => (current.ownerProfileId ? id !== current.ownerProfileId : true));
  const nextEventStartTime = input.eventStartTime === undefined ? current.eventStartTime : input.eventStartTime;
  const nextEventEndTime = input.eventEndTime === undefined ? current.eventEndTime : input.eventEndTime;
  const nextSetupTime = input.setupTime === undefined ? current.setupTime : input.setupTime;
  assertValidEventTimestamps({
    startDatetime: input.startDatetime,
    endDatetime: input.endDatetime,
    eventStartTime: nextEventStartTime,
    eventEndTime: nextEventEndTime,
    setupTime: nextSetupTime,
  });

  const updated = await options.db.transaction(async (tx) => {
    const dateSettings = await getBusinessDateSettings(tx, permissionContext?.businessId ?? null);
    const resolvedDateTimes = await resolveDateTimeIds(tx, dateSettings, [
      input.startDatetime,
      input.endDatetime,
      nextEventStartTime,
      nextEventEndTime,
      nextSetupTime,
    ]);

    let nextAssignee: number | null | undefined =
      input.assigneeProfileId === undefined ? current.assigneeProfileId : input.assigneeProfileId;

    if ((nextAssignee ?? null) === null && (hourLogs?.some((log) => log.id === undefined) ?? false)) {
      const existingLogCountRows = await tx
        .select({ count: sql<number>`count(*)` })
        .from(eventHourLogs)
        .where(eq(eventHourLogs.eventId, current.id))
        .limit(1);
      const existingLogCount = existingLogCountRows[0]?.count ?? 0;
      if (existingLogCount === 0 && sessionProfileIdForNewLogs !== null) {
        nextAssignee = sessionProfileIdForNewLogs;
      }
    }

    const [row] = await tx
      .update(events)
      .set({
        calendarId: targetCalendar.calendarId,
        assigneeProfileId: nextAssignee ?? null,
        scopeType: targetCalendar.scopeType,
        scopeId: targetCalendar.scopeId,
        title: input.title,
        description: input.description ?? null,
        location: resolvedLocation ?? null,
        buildingId: resolvedBuildingId,
        isVirtual: nextIsVirtual,
        isAllDay: input.isAllDay,
        startDateTimeId: requireResolvedDateTimeId(resolvedDateTimes, input.startDatetime, "start"),
        endDateTimeId: requireResolvedDateTimeId(resolvedDateTimes, input.endDatetime, "end"),
        recurrenceRule: input.recurrenceRule ?? null,
        participantCount: input.participantCount === undefined ? current.participantCount : input.participantCount,
        technicianNeeded: input.technicianNeeded ?? current.technicianNeeded,
        requestCategory: input.requestCategory === undefined ? current.requestCategory : input.requestCategory,
        equipmentNeeded: eventRequest.equipmentNeeded,
        requestDetails: eventRequest.requestDetails,
        eventStartDateTimeId: getDateTimeId(resolvedDateTimes, nextEventStartTime),
        eventEndDateTimeId: getDateTimeId(resolvedDateTimes, nextEventEndTime),
        setupDateTimeId: getDateTimeId(resolvedDateTimes, nextSetupTime),
        zendeskTicketNumber,
      })
      .where(eq(events.id, input.id))
      .returning();
    if (!row) throw new Error("Failed to update event");

    if (roomIds !== null) {
      await tx.delete(eventRooms).where(eq(eventRooms.eventId, row.id));
      if (roomIds.length > 0) {
        await tx.insert(eventRooms).values(
          roomIds.map((roomId) => ({
            eventId: row.id,
            roomId,
          })),
        );
      }
    }

    if (input.coOwnerProfileIds) {
      await tx.delete(eventCoOwners).where(eq(eventCoOwners.eventId, current.id));
      if (coOwnerIds.length > 0) {
        await tx.insert(eventCoOwners).values(
          coOwnerIds.map((profileId) => ({
            eventId: current.id,
            profileId,
          })),
        );
      }
    }

    if (hourLogs !== undefined) {
      const existingLogProfiles = new Map<number, number | null>();
      if (hourLogs.some((log) => log.id !== undefined)) {
        const existingRows = await tx
          .select({
            id: eventHourLogs.id,
            loggedByProfileId: eventHourLogs.loggedByProfileId,
          })
          .from(eventHourLogs)
          .where(eq(eventHourLogs.eventId, row.id));
        for (const existing of existingRows) existingLogProfiles.set(existing.id, existing.loggedByProfileId ?? null);
      }
      await tx.delete(eventHourLogs).where(eq(eventHourLogs.eventId, row.id));
      if (hourLogs.length > 0) {
        await tx.insert(eventHourLogs).values(
          hourLogs.map((log) => {
            const existingProfileId = log.id !== undefined ? existingLogProfiles.get(log.id) ?? null : null;
            const loggedByProfileId =
              log.id !== undefined ? existingProfileId : sessionProfileIdForNewLogs;
            return {
              eventId: row.id,
              startTime: log.startTime,
              endTime: log.endTime,
              durationMinutes: log.durationMinutes,
              loggedByProfileId: loggedByProfileId ?? null,
            };
          }),
        );
      }
    }

    if (input.attendeeProfileIds !== undefined) {
      await tx.delete(eventAttendees).where(eq(eventAttendees.eventId, row.id));
      const attendeeIds = Array.from(new Set(input.attendeeProfileIds)).filter((id) => Number.isFinite(id));
      if (attendeeIds.length > 0) {
        const attendeeProfiles = await tx
          .select({
            id: profiles.id,
            email: profiles.email,
          })
          .from(profiles)
          .where(inArray(profiles.id, attendeeIds));
        if (attendeeProfiles.length > 0) {
          await tx.insert(eventAttendees).values(
            attendeeProfiles.map((profile) => ({
              eventId: row.id,
              profileId: profile.id,
              email: profile.email,
            })),
          );
        }
      }
    }

    return row;
  });

  await maybeRefreshExports(options.db, refreshExports);
  return updated;
}
