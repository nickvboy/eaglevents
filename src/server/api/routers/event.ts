import { z } from "zod";
import { and, eq, lt, gt, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { eventHourLogs, events, profiles, users } from "~/server/db/schema";
import bcrypt from "bcryptjs";
import { ensurePrimaryCalendars } from "~/server/services/calendar";

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
type HourLogRow = typeof eventHourLogs.$inferSelect;
type HourLogResponse = {
  id: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  durationHours: number;
};
type EventResponse = EventRow & {
  assigneeProfile: ProfileSummary | null;
  hourLogs: HourLogResponse[];
  totalLoggedMinutes: number;
};

const hourLogInputSchema = z.object({
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
});

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

async function attachHourLogs(db: DbClient, rows: EventWithAssignee[]): Promise<EventResponse[]> {
  if (rows.length === 0) return [];
  const eventIds = rows.map((row) => row.id);
  const logRows = await db
    .select({
      id: eventHourLogs.id,
      eventId: eventHourLogs.eventId,
      startTime: eventHourLogs.startTime,
      endTime: eventHourLogs.endTime,
      durationMinutes: eventHourLogs.durationMinutes,
    })
    .from(eventHourLogs)
    .where(inArray(eventHourLogs.eventId, eventIds))
    .orderBy(eventHourLogs.startTime, eventHourLogs.id);

  const grouped = new Map<number, HourLogResponse[]>();
  for (const log of logRows) {
    const list = grouped.get(log.eventId) ?? [];
    list.push({
      id: log.id,
      startTime: log.startTime,
      endTime: log.endTime,
      durationMinutes: log.durationMinutes,
      durationHours: Math.round((log.durationMinutes / 60) * 100) / 100,
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

async function buildEventResponses(db: DbClient, rows: EventRow[]): Promise<EventResponse[]> {
  const withAssignees = await attachAssignees(db, rows);
  return attachHourLogs(db, withAssignees);
}

function normalizeHourLogs(
  logs: Array<{ startTime: Date; endTime: Date }> | undefined,
): Array<{ startTime: Date; endTime: Date; durationMinutes: number }> | undefined {
  if (logs === undefined) return undefined;
  const normalized: Array<{ startTime: Date; endTime: Date; durationMinutes: number }> = [];
  for (const log of logs) {
    if (!log.startTime || !log.endTime) continue;
    if (log.endTime <= log.startTime) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Hour log end time must be after start time." });
    }
    const durationMinutes = Math.max(1, Math.round((log.endTime.getTime() - log.startTime.getTime()) / 60000));
    normalized.push({
      startTime: log.startTime,
      endTime: log.endTime,
      durationMinutes,
    });
  }
  return normalized;
}

export const eventRouter = createTRPCRouter({
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

      const created = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(events)
          .values({
            calendarId: calendarId!,
            assigneeProfileId: input.assigneeProfileId ?? null,
            title: input.title,
            description: input.description,
            location: input.location,
            isAllDay: input.isAllDay,
            startDatetime: input.startDatetime,
            endDatetime: input.endDatetime,
            recurrenceRule: input.recurrenceRule ?? null,
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
            })),
          );
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.select().from(events).where(eq(events.id, input.id)).limit(1);
      const current = existing[0];
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found." });
      }

      const hourLogs = normalizeHourLogs(input.hourLogs);

      const updated = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(events)
          .set({
            calendarId: input.calendarId ?? current.calendarId,
            assigneeProfileId:
              input.assigneeProfileId === undefined ? current.assigneeProfileId : input.assigneeProfileId,
            title: input.title,
            description: input.description ?? null,
            location: input.location ?? null,
            isAllDay: input.isAllDay,
            startDatetime: input.startDatetime,
            endDatetime: input.endDatetime,
            recurrenceRule: input.recurrenceRule ?? null,
          })
          .where(eq(events.id, input.id))
          .returning();
        if (!row) throw new Error("Failed to update event");

        if (hourLogs !== undefined) {
          await tx.delete(eventHourLogs).where(eq(eventHourLogs.eventId, row.id));
          if (hourLogs.length > 0) {
            await tx.insert(eventHourLogs).values(
              hourLogs.map((log) => ({
                eventId: row.id,
                startTime: log.startTime,
                endTime: log.endTime,
                durationMinutes: log.durationMinutes,
              })),
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
