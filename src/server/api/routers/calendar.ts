import { z } from "zod";
import { eq } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { calendars, users } from "~/server/db/schema";
import bcrypt from "bcryptjs";

type DbClient = typeof import("~/server/db").db;
type UserRow = typeof users.$inferSelect;
type CalendarRow = typeof calendars.$inferSelect;

async function getOrCreateDemoUser(db: DbClient): Promise<UserRow> {
  // In absence of authentication, ensure a demo user exists so the app works out-of-the-box
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

async function ensurePrimaryCalendar(db: DbClient, userId: number): Promise<CalendarRow[]> {
  const list = await db.select().from(calendars).where(eq(calendars.userId, userId));
  if (list.length > 0) return list;
  await db.insert(calendars).values({ userId, name: "Calendar", color: "#22c55e", isPrimary: true });
  return await db.select().from(calendars).where(eq(calendars.userId, userId));
}

export const calendarRouter = createTRPCRouter({
  listMine: publicProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const user = await getOrCreateDemoUser(ctx.db);
      const list = await ensurePrimaryCalendar(ctx.db, user.id);
      return list;
    }),

  create: publicProcedure
    .input(
      z.object({ name: z.string().min(1), color: z.string().min(1).default("#22c55e"), isPrimary: z.boolean().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await getOrCreateDemoUser(ctx.db);
      if (input.isPrimary) {
        // make others non-primary
        await ctx.db.update(calendars).set({ isPrimary: false }).where(eq(calendars.userId, user.id));
      }
      const [cal] = await ctx.db
        .insert(calendars)
        .values({ userId: user.id, name: input.name, color: input.color, isPrimary: input.isPrimary ?? false })
        .returning();
      return cal;
    }),
});
