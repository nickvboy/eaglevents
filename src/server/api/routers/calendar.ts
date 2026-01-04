import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure, protectedRateLimitedProcedure } from "~/server/api/trpc";
import { calendars, events, businesses } from "~/server/db/schema";
import {
  ensurePrimaryCalendars,
  getCalendarAccess,
  listAccessibleCalendars,
  listManageableCalendars,
  suggestPersonalCalendarName,
} from "~/server/services/calendar";
import { getElevatedScopeOptions, requireSessionUserId, resolvePrimaryScopeForUser } from "~/server/services/permissions";

const colorValueSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Enter a hex color like #0f172a");

export const calendarRouter = createTRPCRouter({
  getBusiness: protectedProcedure.query(async ({ ctx }) => {
    const [business] = await ctx.db.select().from(businesses).orderBy(businesses.id).limit(1);
    return business ? { name: business.name } : null;
  }),

  listAccessible: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireSessionUserId(ctx.session);
    await ensurePrimaryCalendars(ctx.db, userId);
    return listAccessibleCalendars(ctx.db, userId);
  }),
  listManageable: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireSessionUserId(ctx.session);
    await ensurePrimaryCalendars(ctx.db, userId);
    return listManageableCalendars(ctx.db, userId);
  }),

  scopeOptions: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireSessionUserId(ctx.session);
    return getElevatedScopeOptions(ctx.db, userId);
  }),
  suggestPersonalName: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireSessionUserId(ctx.session);
    return { name: await suggestPersonalCalendarName(ctx.db, userId) };
  }),

  create: protectedRateLimitedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        color: colorValueSchema.default("#22c55e"),
        isPersonal: z.boolean().default(true),
        scopeType: z.enum(["business", "department", "division"]).optional(),
        scopeId: z.number().int().positive().optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      const creatingPersonal = input.isPersonal ?? true;

      let scopeType: "business" | "department" | "division";
      let scopeId: number;
      let name = input.name.trim();
      if (creatingPersonal) {
        const scope = await resolvePrimaryScopeForUser(ctx.db, userId);
        if (!scope) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Failed to resolve a calendar scope for this user." });
        }
        scopeType = scope.scopeType;
        scopeId = scope.scopeId;
        if (name.length === 0 || name.toLowerCase() === "calendar") {
          name = await suggestPersonalCalendarName(ctx.db, userId);
        }
      } else {
        if (!input.scopeType || !input.scopeId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Scope is required for shared calendars." });
        }
        const allowed = await getElevatedScopeOptions(ctx.db, userId);
        const match = allowed.find((option) => option.scopeType === input.scopeType && option.scopeId === input.scopeId);
        if (!match) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to create calendars in that scope." });
        }
        scopeType = match.scopeType;
        scopeId = match.scopeId;
      }

      if (creatingPersonal && input.isPrimary) {
        await ctx.db
          .update(calendars)
          .set({ isPrimary: false })
          .where(and(eq(calendars.userId, userId), eq(calendars.isPersonal, true)));
      }

      const [cal] = await ctx.db
        .insert(calendars)
        .values({
          userId,
          name,
          color: input.color,
          isPrimary: creatingPersonal ? Boolean(input.isPrimary) : false,
          isPersonal: creatingPersonal,
          scopeType,
          scopeId,
        })
        .returning();
      return cal;
    }),

  update: protectedRateLimitedProcedure
    .input(
      z
        .object({
          calendarId: z.number().int().positive(),
          name: z.string().min(1).optional(),
          color: colorValueSchema.optional(),
          isPrimary: z.boolean().optional(),
          scopeType: z.enum(["business", "department", "division"]).optional(),
          scopeId: z.number().int().positive().optional(),
        })
        .refine(
          (value) =>
            value.name !== undefined ||
            value.color !== undefined ||
            value.isPrimary !== undefined ||
            value.scopeType !== undefined ||
            value.scopeId !== undefined,
          { message: "No updates provided" },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      const access = await getCalendarAccess(ctx.db, userId, input.calendarId);
      if (!access?.canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to manage this calendar." });
      }

      const isPersonal = access.calendar.isPersonal;
      let nextScopeType = access.calendar.scopeType;
      let nextScopeId = access.calendar.scopeId;

      if (!isPersonal && (input.scopeType || input.scopeId)) {
        if (!input.scopeType || !input.scopeId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Scope type and id must be provided together." });
        }
        const allowed = await getElevatedScopeOptions(ctx.db, userId);
        const match = allowed.find((option) => option.scopeType === input.scopeType && option.scopeId === input.scopeId);
        if (!match) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to assign that scope." });
        }
        nextScopeType = match.scopeType;
        nextScopeId = match.scopeId;
      }

      await ctx.db.transaction(async (tx) => {
        if (isPersonal && input.isPrimary) {
          await tx
            .update(calendars)
            .set({ isPrimary: false })
            .where(and(eq(calendars.userId, access.calendar.userId), eq(calendars.isPersonal, true)));
        }

        await tx
          .update(calendars)
          .set({
            name: input.name?.trim() ?? access.calendar.name,
            color: input.color ?? access.calendar.color,
            isPrimary: isPersonal ? input.isPrimary ?? access.calendar.isPrimary : access.calendar.isPrimary,
            scopeType: nextScopeType,
            scopeId: nextScopeId,
          })
          .where(eq(calendars.id, input.calendarId));

        if (!isPersonal && (nextScopeType !== access.calendar.scopeType || nextScopeId !== access.calendar.scopeId)) {
          await tx
            .update(events)
            .set({ scopeType: nextScopeType, scopeId: nextScopeId })
            .where(eq(events.calendarId, input.calendarId));
        }
      });

      const refreshed = await getCalendarAccess(ctx.db, userId, input.calendarId);
      return refreshed?.calendar ?? null;
    }),

  delete: protectedRateLimitedProcedure
    .input(z.object({ calendarId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      const access = await getCalendarAccess(ctx.db, userId, input.calendarId);
      if (!access?.canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to delete this calendar." });
      }
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(calendars)
          .set({ isArchived: true, isPrimary: false })
          .where(eq(calendars.id, input.calendarId));
        await tx.update(events).set({ isArchived: true }).where(eq(events.calendarId, input.calendarId));
      });
      return { deleted: input.calendarId };
    }),
  restore: protectedRateLimitedProcedure
    .input(z.object({ calendarId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireSessionUserId(ctx.session);
      const access = await getCalendarAccess(ctx.db, userId, input.calendarId, { includeArchived: true });
      if (!access?.canManage) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to restore this calendar." });
      }
      await ctx.db.transaction(async (tx) => {
        await tx.update(calendars).set({ isArchived: false }).where(eq(calendars.id, input.calendarId));
        await tx.update(events).set({ isArchived: false }).where(eq(events.calendarId, input.calendarId));
      });
      return { restored: input.calendarId };
    }),
});
