import { z } from "zod";
import { and, eq, lt, gt, inArray } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { events, calendars, users } from "~/server/db/schema";
import bcrypt from "bcryptjs";

type DbClient = typeof import("~/server/db").db;
type UserRow = typeof users.$inferSelect;
type CalendarRow = typeof calendars.$inferSelect;
type EventRow = typeof events.$inferSelect;

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
      return list;
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let calendarId = input.calendarId;
      if (!calendarId) {
        const user = await getOrCreateDemoUser(ctx.db);
        const primary = await ctx.db
          .select()
          .from(calendars)
          .where(and(eq(calendars.userId, user.id), eq(calendars.isPrimary, true)))
          .limit(1);
        const primaryCalendar = primary[0];
        if (primaryCalendar) calendarId = primaryCalendar.id;
        else {
          const [cal] = await ctx.db
            .insert(calendars)
            .values({ userId: user.id, name: "Calendar", color: "#22c55e", isPrimary: true })
            .returning();
          if (!cal) throw new Error("Failed to create default calendar");
          calendarId = cal.id;
        }
      }

      const [row] = await ctx.db
        .insert(events)
        .values({
          calendarId: calendarId!,
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

      return row as EventRow;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(events).where(eq(events.id, input.id));
      return { success: true };
    }),
});
