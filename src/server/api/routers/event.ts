import { z } from "zod";
import { and, desc, eq, ilike, inArray, lt, gt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { calendars, eventAttendees, eventHourLogs, events, profiles, users } from "~/server/db/schema";
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

export const eventRouter = createTRPCRouter({
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
        conditions.push(or(ilike(events.title, like), ilike(events.description, like), ilike(events.location, like)));
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
        // Auto-assign to calendar owner's profile when logs are present and no explicit assignee provided
        let assignee: number | null | undefined = input.assigneeProfileId;
        if ((assignee ?? null) === null && hourLogs.length > 0) {
          const [cal] = await tx
            .select({ userId: calendars.userId })
            .from(calendars)
            .where(eq(calendars.id, calendarId!))
            .limit(1);
          const userId = cal?.userId ?? null;
          if (userId !== null) {
            const [profile] = await tx
              .select({ id: profiles.id })
              .from(profiles)
              .where(eq(profiles.userId, userId))
              .limit(1);
            if (profile?.id) assignee = profile.id;
          }
        }

        const [row] = await tx
          .insert(events)
          .values({
            calendarId: calendarId!,
            assigneeProfileId: assignee ?? null,
            title: input.title,
            description: input.description,
            location: input.location,
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
        const hasAnyLogs = (hourLogs?.length ?? 0) > 0;
        const timesChanged =
          input.startDatetime.getTime() !== new Date(current.startDatetime).getTime() ||
          input.endDatetime.getTime() !== new Date(current.endDatetime).getTime();
        if ((nextAssignee ?? null) === null && (hasAnyLogs || timesChanged)) {
          const effectiveCalendarId = input.calendarId ?? current.calendarId;
          const [cal] = await tx
            .select({ userId: calendars.userId })
            .from(calendars)
            .where(eq(calendars.id, effectiveCalendarId))
            .limit(1);
          const userId = cal?.userId ?? null;
          if (userId !== null) {
            const [profile] = await tx
              .select({ id: profiles.id })
              .from(profiles)
              .where(eq(profiles.userId, userId))
              .limit(1);
            if (profile?.id) nextAssignee = profile.id;
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
