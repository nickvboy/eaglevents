import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import {
  businesses,
  departments,
  organizationRoles,
  themePalettes,
  themeProfiles,
} from "~/server/db/schema";
import type { ThemePaletteTokens } from "~/types/theme";
import { DEFAULT_THEME_PALETTE } from "~/types/theme";

type DbClient = typeof db;

export type ResolvedPalette =
  | {
      paletteId: number | null;
      tokens: ThemePaletteTokens;
      source: { type: "default"; scopeId: null; paletteName: null };
    }
  | {
      paletteId: number;
      tokens: ThemePaletteTokens;
      source: { type: "business" | "department"; scopeId: number; paletteName: string | null };
    };

export async function getPrimaryBusinessId(database: DbClient = db): Promise<number | null> {
  const [row] = await database.select({ id: businesses.id }).from(businesses).orderBy(businesses.id).limit(1);
  return row?.id ?? null;
}

async function getUserDepartmentId(database: DbClient, userId: number): Promise<number | null> {
  const [role] = await database
    .select({ scopeId: organizationRoles.scopeId })
    .from(organizationRoles)
    .where(and(eq(organizationRoles.userId, userId), eq(organizationRoles.scopeType, "department")))
    .limit(1);
  return role?.scopeId ?? null;
}

async function fetchProfilePalette(
  database: DbClient,
  businessId: number,
  scopeType: "business" | "department",
  scopeId: number,
) {
  const [row] = await database
    .select({
      paletteId: themeProfiles.paletteId,
      paletteTokens: themePalettes.tokens,
      paletteName: themePalettes.name,
      scopeId: themeProfiles.scopeId,
      scopeType: themeProfiles.scopeType,
    })
    .from(themeProfiles)
    .leftJoin(themePalettes, eq(themeProfiles.paletteId, themePalettes.id))
    .where(
      and(
        eq(themeProfiles.businessId, businessId),
        eq(themeProfiles.scopeType, scopeType),
        eq(themeProfiles.scopeId, scopeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function resolvePalette(
  options: { userId?: number | null },
  database: DbClient = db,
): Promise<ResolvedPalette> {
  const businessId = await getPrimaryBusinessId(database);
  if (!businessId) {
    return {
      paletteId: null,
      tokens: DEFAULT_THEME_PALETTE,
      source: { type: "default", scopeId: null, paletteName: null },
    };
  }

  let paletteRow = null;
  if (options.userId) {
    const departmentId = await getUserDepartmentId(database, options.userId);
    if (departmentId) {
      paletteRow = await fetchProfilePalette(database, businessId, "department", departmentId);
    }
  }

  paletteRow ??= await fetchProfilePalette(database, businessId, "business", businessId);

  if (!paletteRow?.paletteId || !paletteRow?.paletteTokens) {
    return {
      paletteId: null,
      tokens: DEFAULT_THEME_PALETTE,
      source: { type: "default", scopeId: null, paletteName: null },
    };
  }

  return {
    paletteId: paletteRow.paletteId,
    tokens: paletteRow.paletteTokens ?? DEFAULT_THEME_PALETTE,
    source: {
      type: paletteRow.scopeType,
      scopeId: paletteRow.scopeId,
      paletteName: paletteRow.paletteName ?? null,
    },
  };
}

export async function verifyDepartmentBelongsToBusiness(database: DbClient, businessId: number, departmentId: number) {
  const [row] = await database
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.businessId, businessId)))
    .limit(1);
  return Boolean(row);
}
