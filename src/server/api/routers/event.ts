import { z } from "zod";
import { and, desc, eq, ilike, inArray, isNull, lt, gt, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from "~/server/api/trpc";
import {
  eventCoOwners,
  eventAttendees,
  eventHourLogs,
  eventZendeskConfirmations,
  events,
  profiles,
} from "~/server/db/schema";
import { ensurePrimaryCalendars, getAccessibleCalendarIds, getCalendarAccess } from "~/server/services/calendar";
import { refreshJoinTableExport } from "~/server/services/join-table-export";
import { refreshHourLogExport } from "~/server/services/hour-log-export";
import {
  getOptionalPermissionContext,
  requireSessionUserId,
  getSessionProfileId,
  getVisibleScopes,
} from "~/server/services/permissions";
import type { Session } from "next-auth";
import type { db as dbClient } from "~/server/db";

type DbClient = typeof dbClient;
type EventRow = typeof events.$inferSelect;
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

async function buildEventResponses(db: DbClient, rows: EventRow[]): Promise<EventResponse[]> {
  const withAssignees = await attachAssignees(db, rows);
  const withLogs = await attachHourLogs(db, withAssignees);
  const withCoOwners = await attachCoOwners(db, withLogs);
  return attachAttendees(db, withCoOwners);
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

async function canEditEvent(dbClient: DbClient, session: Session | null, eventRow: EventRow) {
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
      const possibilities: Array<Promise<EventRow | undefined>> = [];
      const numericId = Number(trimmed);
      if (Number.isInteger(numericId) && numericId > 0) {
        possibilities.push(
          ctx.db
            .select()
            .from(events)
            .where(and(eq(events.id, numericId), eq(events.isArchived, false)))
            .limit(1)
            .then((rows) => rows[0]),
        );
      }

      possibilities.push(
        ctx.db
          .select()
          .from(events)
          .where(and(eq(events.eventCode, trimmed), eq(events.isArchived, false)))
          .limit(1)
          .then((rows) => rows[0]),
      );

      const zendesk = cleanZendeskTicketNumber(trimmed);
      if (zendesk) {
        possibilities.push(
          ctx.db
            .select()
            .from(events)
            .where(and(eq(events.zendeskTicketNumber, zendesk), eq(events.isArchived, false)))
            .limit(1)
            .then((rows) => rows[0]),
        );
      }

      let resolved: EventRow | undefined;
      for (const attempt of possibilities) {
        const candidate = await attempt;
        if (candidate) {
          resolved = candidate;
          break;
        }
      }

      if (!resolved) return null;
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
        const like = `%${input.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
        const searchCondition = or(
          ilike(events.title, like),
          ilike(events.description, like),
          ilike(events.location, like),
          eq(events.eventCode, input.search.trim()),
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      const baseQuery = ctx.db.select().from(events);
      const whereCond = conditions.length > 0 ? and(...conditions) : null;
      const rows = await (whereCond ? baseQuery.where(whereCond) : baseQuery)
        .orderBy(desc(events.updatedAt), desc(events.id))
        .limit(limit)
        .offset(offset);
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

    const eventRows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        startDatetime: events.startDatetime,
        endDatetime: events.endDatetime,
        zendeskTicketNumber: events.zendeskTicketNumber,
        assigneeProfileId: events.assigneeProfileId,
        eventCode: events.eventCode,
      })
      .from(events)
      .where(and(condition, eq(events.isArchived, false)))
      .orderBy(desc(events.startDatetime));

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
      let condition = and(lt(events.startDatetime, input.end), gt(events.endDatetime, input.start));
      condition = and(condition, eq(events.isArchived, false));
      const accessibleCalendarIds = await getAccessibleCalendarIds(ctx.db, userId);
      if (accessibleCalendarIds.length === 0) return [];
      const visibleCalendarIds =
        input.calendarIds && input.calendarIds.length > 0
          ? input.calendarIds.filter((id) => accessibleCalendarIds.includes(id))
          : accessibleCalendarIds;
      condition = and(condition, inArray(events.calendarId, visibleCalendarIds));

      const context = await getOptionalPermissionContext(ctx.db, ctx.session);
      if (!context) return [];
      const visible = await getVisibleScopes(ctx.db, context.userId);
      const scopeCondition = buildScopeCondition(visible);
      if (scopeCondition) {
        condition = and(condition, scopeCondition);
      }
      const list = await ctx.db
        .select()
        .from(events)
        .where(condition)
        .orderBy(events.startDatetime);
      return buildEventResponses(ctx.db, list);
    }),

  create: protectedRateLimitedProcedure
    .input(
      z.object({
        calendarId: z.number().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        buildingId: z.number().int().positive().nullable().optional(),
        isVirtual: z.boolean().optional(),
        isAllDay: z.boolean().default(false),
        startDatetime: z.coerce.date(),
        endDatetime: z.coerce.date(),
        recurrenceRule: z.string().nullable().optional(),
        assigneeProfileId: z.number().int().positive().optional(),
        coOwnerProfileIds: z.array(z.number().int().positive()).optional(),
        hourLogs: z.array(hourLogInputSchema).optional(),
        attendeeProfileIds: z.array(z.number().int().positive()).optional(),
        participantCount: z.number().int().min(0).max(100000).optional(),
        technicianNeeded: z.boolean().optional(),
        requestCategory: requestCategorySchema.optional(),
        equipmentNeeded: z.string().trim().max(2000).optional(),
        eventStartTime: z.coerce.date().optional(),
        eventEndTime: z.coerce.date().optional(),
        setupTime: z.coerce.date().optional(),
        zendeskTicketNumber: zendeskTicketSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      let calendarId = input.calendarId;
      if (!calendarId) {
        const list = await ensurePrimaryCalendars(ctx.db, userId);
        const primary = list.find((cal) => cal.isPrimary) ?? list[0];
        if (!primary) throw new Error("Failed to resolve a primary calendar");
        calendarId = primary.id;
      }

      const calendarAccess = await getCalendarAccess(ctx.db, userId, calendarId);
      if (!calendarAccess?.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to that calendar." });
      }
      const isVirtual = input.isVirtual ?? false;
      const resolvedBuildingId = input.buildingId ?? null;
      if (!isVirtual && resolvedBuildingId === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select a building or mark the event as virtual." });
      }
      const scope = {
        scopeType: calendarAccess.calendar.scopeType,
        scopeId: calendarAccess.calendar.scopeId,
      };
      const eventCode = await getUniqueEventCode(ctx.db);
      const hourLogs = normalizeHourLogs(input.hourLogs ?? []) ?? [];
      let sessionProfileId: number | null = null;
      if (hourLogs.length > 0) {
        sessionProfileId = await getSessionProfileId(ctx.db, ctx.session);
        if (sessionProfileId === null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be signed in to log hours." });
        }
      }
      const ownerProfileId = await getSessionProfileId(ctx.db, ctx.session);
      const zendeskTicketNumber = cleanZendeskTicketNumber(input.zendeskTicketNumber);
      const coOwnerIds = Array.from(new Set(input.coOwnerProfileIds ?? []))
        .filter((id) => Number.isFinite(id))
        .filter((id) => (ownerProfileId ? id !== ownerProfileId : true));

      const created = await ctx.db.transaction(async (tx) => {
        // Assign to the first user who logs hours (on create),
        // but do not override an explicit assignee provided by the client.
        let assignee: number | null | undefined = input.assigneeProfileId;
        if ((assignee ?? null) === null && hourLogs.length > 0) {
          // When creating with hour logs and no explicit assignee, the event belongs
          // to the user logging these first hours.
          assignee = sessionProfileId;
        }

        const [row] = await tx
          .insert(events)
          .values({
            calendarId,
            assigneeProfileId: assignee ?? null,
            ownerProfileId,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            eventCode,
            title: input.title,
            description: input.description,
            location: input.location,
            buildingId: resolvedBuildingId,
            isVirtual,
            isAllDay: input.isAllDay,
            startDatetime: input.startDatetime,
            endDatetime: input.endDatetime,
            recurrenceRule: input.recurrenceRule ?? null,
            participantCount: input.participantCount ?? null,
            technicianNeeded: input.technicianNeeded ?? false,
            requestCategory: input.requestCategory ?? null,
            equipmentNeeded: input.equipmentNeeded ?? null,
            eventStartTime: input.eventStartTime ?? null,
            eventEndTime: input.eventEndTime ?? null,
            setupTime: input.setupTime ?? null,
            zendeskTicketNumber,
          })
          .returning();
        if (!row) throw new Error("Failed to create event");

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

      const [result] = await buildEventResponses(ctx.db, [created]);
      if (!result) throw new Error("Failed to load created event");
      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] event create refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] event create refresh failed", error);
      });
      return result;
    }),

  update: protectedRateLimitedProcedure
    .input(
      z.object({
        id: z.number(),
        calendarId: z.number().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        buildingId: z.number().int().positive().nullable().optional(),
        isVirtual: z.boolean().optional(),
        isAllDay: z.boolean(),
        startDatetime: z.coerce.date(),
        endDatetime: z.coerce.date(),
        recurrenceRule: z.string().nullable().optional(),
        assigneeProfileId: z.number().int().positive().nullable().optional(),
        coOwnerProfileIds: z.array(z.number().int().positive()).optional(),
        hourLogs: z.array(hourLogInputSchema).optional(),
        attendeeProfileIds: z.array(z.number().int().positive()).optional(),
        participantCount: z.number().int().min(0).max(100000).nullable().optional(),
        technicianNeeded: z.boolean().optional(),
        requestCategory: requestCategorySchema.nullable().optional(),
        equipmentNeeded: z.string().trim().max(2000).nullable().optional(),
        eventStartTime: z.coerce.date().nullable().optional(),
        eventEndTime: z.coerce.date().nullable().optional(),
        setupTime: z.coerce.date().nullable().optional(),
        zendeskTicketNumber: zendeskTicketSchema.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      const existing = await ctx.db
        .select()
        .from(events)
        .where(and(eq(events.id, input.id), eq(events.isArchived, false)))
        .limit(1);
      const current = existing[0];
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }
      const canEdit = await canEditEvent(ctx.db, ctx.session, current);
      if (!canEdit) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to edit this event." });
      }

      const hourLogs = normalizeHourLogs(input.hourLogs);
      const needsProfileForNewLogs = hourLogs?.some((log) => log.id === undefined) ?? false;
      const sessionProfileIdForNewLogs =
        needsProfileForNewLogs && (hourLogs?.length ?? 0) > 0 ? await getSessionProfileId(ctx.db, ctx.session) : null;
      if (needsProfileForNewLogs && sessionProfileIdForNewLogs === null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You must be signed in to log hours." });
      }
      const zendeskTicketNumber = cleanZendeskTicketNumber(
        input.zendeskTicketNumber === undefined ? current.zendeskTicketNumber : input.zendeskTicketNumber,
      );
      const targetCalendarId = input.calendarId ?? current.calendarId;
      const calendarAccess = await getCalendarAccess(ctx.db, userId, targetCalendarId);
      if (!calendarAccess?.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to that calendar." });
      }
      const nextIsVirtual = input.isVirtual ?? current.isVirtual;
      const resolvedBuildingId = input.buildingId === undefined ? current.buildingId : input.buildingId;
      if (!nextIsVirtual && resolvedBuildingId === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select a building or mark the event as virtual." });
      }
      const nextScope = {
        scopeType: calendarAccess.calendar.scopeType,
        scopeId: calendarAccess.calendar.scopeId,
      };
      const coOwnerIds = Array.from(new Set(input.coOwnerProfileIds ?? []))
        .filter((id) => Number.isFinite(id))
        .filter((id) => (current.ownerProfileId ? id !== current.ownerProfileId : true));

  const updated = await ctx.db.transaction(async (tx) => {
        // Determine next assignee
        let nextAssignee: number | null | undefined =
          input.assigneeProfileId === undefined ? current.assigneeProfileId : input.assigneeProfileId;

        // If there are no prior hour logs and this update is introducing
        // the first logs, assign the event to the logging user. Once set,
        // never auto-overwrite the assignee.
        if ((nextAssignee ?? null) === null && (hourLogs?.some((l) => l.id === undefined) ?? false)) {
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
            calendarId: targetCalendarId,
            assigneeProfileId: nextAssignee ?? null,
            scopeType: nextScope.scopeType,
            scopeId: nextScope.scopeId,
            title: input.title,
            description: input.description ?? null,
            location: input.location ?? null,
            buildingId: resolvedBuildingId,
            isVirtual: nextIsVirtual,
            isAllDay: input.isAllDay,
            startDatetime: input.startDatetime,
            endDatetime: input.endDatetime,
            recurrenceRule: input.recurrenceRule ?? null,
            participantCount: input.participantCount === undefined ? current.participantCount : input.participantCount,
            technicianNeeded: input.technicianNeeded ?? current.technicianNeeded,
            requestCategory: input.requestCategory === undefined ? current.requestCategory : input.requestCategory,
            equipmentNeeded: input.equipmentNeeded === undefined ? current.equipmentNeeded : input.equipmentNeeded,
            eventStartTime: input.eventStartTime === undefined ? current.eventStartTime : input.eventStartTime,
            eventEndTime: input.eventEndTime === undefined ? current.eventEndTime : input.eventEndTime,
            setupTime: input.setupTime === undefined ? current.setupTime : input.setupTime,
            zendeskTicketNumber: zendeskTicketNumber,
          })
          .where(eq(events.id, input.id))
          .returning();
        if (!row) throw new Error("Failed to update event");

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

        return row;
      });

      const [result] = await buildEventResponses(ctx.db, [updated]);
      if (!result) throw new Error("Failed to load updated event");
      void refreshJoinTableExport(ctx.db, true).catch((error) => {
        console.error("[join-table-export] event update refresh failed", error);
      });
      void refreshHourLogExport(ctx.db, true).catch((error) => {
        console.error("[hour-log-export] event update refresh failed", error);
      });
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

