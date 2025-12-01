import { z } from "zod";
import { and, desc, eq, ilike, inArray, lt, gt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  calendars,
  eventAttendees,
  eventHourLogs,
  eventZendeskConfirmations,
  events,
  profiles,
  users,
} from "~/server/db/schema";
import bcrypt from "bcryptjs";
import { ensurePrimaryCalendars } from "~/server/services/calendar";
import type { Session } from "next-auth";

type DbClient = typeof import("~/server/db").db;
type UserRow = typeof users.$inferSelect;
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
type AttendeeSummary = {
  profileId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
};
type EventResponse = EventRow & {
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

async function getSessionProfileId(ctx: { session: Session | null; db: DbClient }) {
  const userIdRaw = ctx.session?.user?.id;
  if (!userIdRaw) return null;
  const userId = Number(userIdRaw);
  if (!Number.isFinite(userId)) return null;
  const rows = await ctx.db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function requireSessionProfileId(ctx: { session: Session | null; db: DbClient }) {
  const profileId = await getSessionProfileId(ctx);
  if (profileId === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in to access your tickets." });
  }
  return profileId;
}

async function getOrCreateDemoUser(db: DbClient): Promise<UserRow> {
  const email = "demo@local";
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0]!;
  const [inserted] = await db
    .insert(users)
    .values({ username: "demo", email, displayName: "Demo User", passwordHash: await bcrypt.hash("demo", 10) })
    .returning();
  if (!inserted) throw new Error("Failed to create demo user");
  return inserted;
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

async function attachAttendees(db: DbClient, rows: EventWithAssigneeAndLogs[]): Promise<EventResponse[]> {
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
  return attachAttendees(db, withLogs);
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

export const eventRouter = createTRPCRouter({
  findByIdentifier: publicProcedure
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
            .where(eq(events.id, numericId))
            .limit(1)
            .then((rows) => rows[0]),
        );
      }

      possibilities.push(
        ctx.db
          .select()
          .from(events)
          .where(eq(events.eventCode, trimmed))
          .limit(1)
          .then((rows) => rows[0]),
      );

      const zendesk = cleanZendeskTicketNumber(trimmed);
      if (zendesk) {
        possibilities.push(
          ctx.db
            .select()
            .from(events)
            .where(eq(events.zendeskTicketNumber, zendesk))
            .limit(1)
            .then((rows) => rows[0]),
        );
      }

      let resolved: EventRow | undefined;
      for (const attempt of possibilities) {
        // eslint-disable-next-line no-await-in-loop
        const candidate = await attempt;
        if (candidate) {
          resolved = candidate;
          break;
        }
      }

      if (!resolved) return null;
      const [response] = await buildEventResponses(ctx.db, [resolved]);
      return response ?? null;
    }),

  tickets: publicProcedure
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
      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;

      const conditions: unknown[] = [];
      if (input?.assigned === true) {
        conditions.push(sql`${events.assigneeProfileId} IS NOT NULL`);
      } else if (input?.assigned === false) {
        conditions.push(eq(events.assigneeProfileId, null));
      }

      if (input?.search && input.search.trim().length > 0) {
        const like = `%${input.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
        conditions.push(
          or(
            ilike(events.title, like),
            ilike(events.description, like),
            ilike(events.location, like),
            eq(events.eventCode, input.search.trim()),
          ),
        );
      }

      let query = ctx.db.select().from(events);
      if (conditions.length > 0) {
        let whereCond = conditions[0] as any;
        for (let i = 1; i < conditions.length; i++) whereCond = and(whereCond, conditions[i] as any);
        query = query.where(whereCond);
      }

      const rows = await query.orderBy(desc(events.updatedAt), desc(events.id)).limit(limit).offset(offset);
      return buildEventResponses(ctx.db, rows as EventRow[]);
    }),
  zendeskQueue: publicProcedure.query(async ({ ctx }) => {
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
    let condition: any = eq(events.assigneeProfileId, profileId);
    if (hourEventIds.length > 0) {
      condition = or(condition, inArray(events.id, hourEventIds));
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
      .where(condition)
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
  confirmZendesk: publicProcedure
    .input(z.object({ eventId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const profileId = await requireSessionProfileId(ctx);

      const eventRows = await ctx.db
        .select({
          id: events.id,
          assigneeProfileId: events.assigneeProfileId,
        })
        .from(events)
        .where(eq(events.id, input.eventId))
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
  list: publicProcedure
    .input(
      z.object({
        start: z.coerce.date(),
        end: z.coerce.date(),
        calendarIds: z.array(z.number()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let condition = and(lt(events.startDatetime, input.end), gt(events.endDatetime, input.start));
      if (input.calendarIds && input.calendarIds.length > 0) {
        condition = and(condition, inArray(events.calendarId, input.calendarIds));
      }
      const list = await ctx.db
        .select()
        .from(events)
        .where(condition)
        .orderBy(events.startDatetime);
      return buildEventResponses(ctx.db, list as EventRow[]);
    }),

  create: publicProcedure
    .input(
      z.object({
        calendarId: z.number().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        buildingId: z.number().int().positive().nullable().optional(),
        isAllDay: z.boolean().default(false),
        startDatetime: z.coerce.date(),
        endDatetime: z.coerce.date(),
        recurrenceRule: z.string().nullable().optional(),
        assigneeProfileId: z.number().int().positive().optional(),
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
      let calendarId = input.calendarId;
      if (!calendarId) {
        const user = await getOrCreateDemoUser(ctx.db);
        const list = await ensurePrimaryCalendars(ctx.db, user.id);
        const primary = list.find((cal) => cal.isPrimary) ?? list[0];
        if (!primary) throw new Error("Failed to resolve a primary calendar");
        calendarId = primary.id;
      }

      const eventCode = await getUniqueEventCode(ctx.db);
      const hourLogs = normalizeHourLogs(input.hourLogs ?? []) ?? [];
      let sessionProfileId: number | null = null;
      if (hourLogs.length > 0) {
        sessionProfileId = await getSessionProfileId(ctx);
        if (sessionProfileId === null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be signed in to log hours." });
        }
      }
      const zendeskTicketNumber = cleanZendeskTicketNumber(input.zendeskTicketNumber);

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
            calendarId: calendarId!,
            assigneeProfileId: assignee ?? null,
            eventCode,
            title: input.title,
            description: input.description,
            location: input.location,
            buildingId: input.buildingId ?? null,
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

      const [result] = await buildEventResponses(ctx.db, [created as EventRow]);
      if (!result) throw new Error("Failed to load created event");
      return result;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        calendarId: z.number().optional(),
        title: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        buildingId: z.number().int().positive().nullable().optional(),
        isAllDay: z.boolean(),
        startDatetime: z.coerce.date(),
        endDatetime: z.coerce.date(),
        recurrenceRule: z.string().nullable().optional(),
        assigneeProfileId: z.number().int().positive().nullable().optional(),
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
      const existing = await ctx.db.select().from(events).where(eq(events.id, input.id)).limit(1);
      const current = existing[0];
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      const hourLogs = normalizeHourLogs(input.hourLogs);
      const needsProfileForNewLogs = hourLogs?.some((log) => log.id === undefined) ?? false;
      const sessionProfileIdForNewLogs =
        needsProfileForNewLogs && (hourLogs?.length ?? 0) > 0 ? await getSessionProfileId(ctx) : null;
      if (needsProfileForNewLogs && sessionProfileIdForNewLogs === null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You must be signed in to log hours." });
      }
      const zendeskTicketNumber = cleanZendeskTicketNumber(
        input.zendeskTicketNumber === undefined ? current.zendeskTicketNumber : input.zendeskTicketNumber,
      );

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
            calendarId: input.calendarId ?? current.calendarId,
            assigneeProfileId: nextAssignee ?? null,
            title: input.title,
            description: input.description ?? null,
            location: input.location ?? null,
            buildingId: input.buildingId === undefined ? current.buildingId : input.buildingId,
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

      const [result] = await buildEventResponses(ctx.db, [updated as EventRow]);
      if (!result) throw new Error("Failed to load updated event");
      return result;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(events).where(eq(events.id, input.id));
      return { success: true };
    }),
});

