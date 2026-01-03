import { TRPCError } from "@trpc/server";
import { asc, and, count, eq } from "drizzle-orm";
import { z } from "zod";

import type { createTRPCContext } from "~/server/api/trpc";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  departments,
  themePalettes,
  themeProfiles,
} from "~/server/db/schema";
import {
  getPrimaryBusinessId,
  resolvePalette,
  verifyDepartmentBelongsToBusiness,
} from "~/server/services/theme";
import { getSetupStatus } from "~/server/services/setup";
import type { ThemePaletteMode } from "~/types/theme";
import { DEFAULT_THEME_PALETTE, THEME_PALETTE_FIELD_GROUPS } from "~/types/theme";

const colorValueSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Enter a hex color like #0f172a");

const paletteFieldKeys = Array.from(
  new Set(
    THEME_PALETTE_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
  ),
);

const paletteModeSchema = z.object(
  Object.fromEntries(
    paletteFieldKeys.map((key) => [key, colorValueSchema]),
  ) as Record<keyof ThemePaletteMode, z.ZodString>,
);

const paletteTokensSchema = z.object({
  dark: paletteModeSchema,
  light: paletteModeSchema,
});

const upsertPaletteSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  tokens: paletteTokensSchema,
});

const setProfileSchema = z.object({
  scopeType: z.enum(["business", "department"]),
  scopeId: z.number().int().positive().optional(),
  paletteId: z.number().int().positive().nullable(),
});

async function requireBusinessId(db: Parameters<typeof getPrimaryBusinessId>[0]) {
  const businessId = await getPrimaryBusinessId(db);
  if (!businessId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace has not been created yet." });
  }
  return businessId;
}

type TrpcContext = Awaited<ReturnType<typeof createTRPCContext>>;

async function requireThemeWriteAccess(ctx: TrpcContext) {
  if (ctx.session?.user) {
    return;
  }
  const status = await getSetupStatus(ctx.db);
  if (!status.needsSetup) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
}

export const themeRouter = createTRPCRouter({
  settings: publicProcedure.query(async ({ ctx }) => {
    const businessId = await getPrimaryBusinessId(ctx.db);
    if (!businessId) {
      return {
        businessId: null,
        palettes: [],
        profiles: [],
        departments: [],
      };
    }

    const palettes = await ctx.db
      .select({
        id: themePalettes.id,
        name: themePalettes.name,
        description: themePalettes.description,
        tokens: themePalettes.tokens,
        createdAt: themePalettes.createdAt,
      })
      .from(themePalettes)
      .where(eq(themePalettes.businessId, businessId))
      .orderBy(asc(themePalettes.name));

    const profiles = await ctx.db
      .select({
        id: themeProfiles.id,
        scopeType: themeProfiles.scopeType,
        scopeId: themeProfiles.scopeId,
        paletteId: themeProfiles.paletteId,
        label: themeProfiles.label,
        paletteName: themePalettes.name,
      })
      .from(themeProfiles)
      .leftJoin(themePalettes, eq(themeProfiles.paletteId, themePalettes.id))
      .where(eq(themeProfiles.businessId, businessId));

    const deptRows = await ctx.db
      .select({
        id: departments.id,
        name: departments.name,
      })
      .from(departments)
      .where(eq(departments.businessId, businessId))
      .orderBy(asc(departments.name));

    return {
      businessId,
      palettes,
      profiles,
      departments: deptRows,
    };
  }),

  create: publicProcedure.input(upsertPaletteSchema).mutation(async ({ ctx, input }) => {
    await requireThemeWriteAccess(ctx);
    const businessId = await requireBusinessId(ctx.db);
    const [inserted] = await ctx.db
      .insert(themePalettes)
      .values({
        businessId,
        name: input.name,
        description: input.description ?? "",
        tokens: input.tokens,
      })
      .returning({
        id: themePalettes.id,
        name: themePalettes.name,
        description: themePalettes.description,
        tokens: themePalettes.tokens,
      });
    return inserted ?? null;
  }),

  update: publicProcedure
    .input(upsertPaletteSchema.extend({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireThemeWriteAccess(ctx);
      const businessId = await requireBusinessId(ctx.db);
      const [existing] = await ctx.db
        .select({ id: themePalettes.id })
        .from(themePalettes)
        .where(and(eq(themePalettes.id, input.id), eq(themePalettes.businessId, businessId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Palette not found for this workspace." });
      }

      const [updated] = await ctx.db
        .update(themePalettes)
        .set({
          name: input.name,
          description: input.description ?? "",
          tokens: input.tokens,
        })
        .where(eq(themePalettes.id, input.id))
        .returning({
          id: themePalettes.id,
          name: themePalettes.name,
          description: themePalettes.description,
          tokens: themePalettes.tokens,
        });
      return updated ?? null;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireThemeWriteAccess(ctx);
      const businessId = await requireBusinessId(ctx.db);
      const assignmentRows = await ctx.db
        .select({ totalAssignments: count() })
        .from(themeProfiles)
        .where(and(eq(themeProfiles.paletteId, input.id), eq(themeProfiles.businessId, businessId)));
      const totalAssignments = assignmentRows[0]?.totalAssignments ?? 0;
      if (totalAssignments > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unassign this palette from all profiles before deleting it.",
        });
      }
      await ctx.db.delete(themePalettes).where(and(eq(themePalettes.id, input.id), eq(themePalettes.businessId, businessId)));
      return true;
    }),

  setProfile: publicProcedure.input(setProfileSchema).mutation(async ({ ctx, input }) => {
    await requireThemeWriteAccess(ctx);
    const businessId = await requireBusinessId(ctx.db);
    const scopeType = input.scopeType;
    const scopeId = scopeType === "business" ? businessId : input.scopeId;
    if (!scopeId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Scope is required." });
    }

    if (scopeType === "department") {
      const belongs = await verifyDepartmentBelongsToBusiness(ctx.db, businessId, scopeId);
      if (!belongs) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Department does not belong to this workspace." });
      }
    }

    if (input.paletteId === null) {
      await ctx.db
        .delete(themeProfiles)
        .where(and(eq(themeProfiles.businessId, businessId), eq(themeProfiles.scopeType, scopeType), eq(themeProfiles.scopeId, scopeId)));
      return true;
    }

    const [existing] = await ctx.db
      .select({ id: themeProfiles.id })
      .from(themeProfiles)
      .where(and(eq(themeProfiles.businessId, businessId), eq(themeProfiles.scopeType, scopeType), eq(themeProfiles.scopeId, scopeId)))
      .limit(1);

    if (existing) {
      await ctx.db
        .update(themeProfiles)
        .set({
          paletteId: input.paletteId,
          updatedAt: new Date(),
        })
        .where(eq(themeProfiles.id, existing.id));
    } else {
      await ctx.db.insert(themeProfiles).values({
        businessId,
        scopeType,
        scopeId,
        paletteId: input.paletteId,
        label: scopeType === "business" ? "Workspace default" : "",
        description: "",
      });
    }
    return true;
  }),

  current: publicProcedure.query(async ({ ctx }) => {
    const result = await resolvePalette({ userId: null }, ctx.db);
    return result;
  }),

  default: publicProcedure.query(() => DEFAULT_THEME_PALETTE),
});
