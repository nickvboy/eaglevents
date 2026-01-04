import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { calendars, users } from "~/server/db/schema";
import type { db } from "~/server/db";
import { getElevatedVisibleScopes, getVisibleScopes, resolvePrimaryScopeForUser } from "~/server/services/permissions";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;
type CalendarRow = typeof calendars.$inferSelect;

type CalendarAccess = CalendarRow & {
  canManage: boolean;
  canWrite: boolean;
  owner: { id: number; displayName: string; email: string } | null;
};

/**
 * Ensures a user always has at least one calendar and exactly one marked as primary.
 * Returns the refreshed list of calendars for the user.
 */
export async function ensurePrimaryCalendars(dbClient: DbExecutor, userId: number) {
  const existing = await dbClient
    .select()
    .from(calendars)
    .where(and(eq(calendars.userId, userId), eq(calendars.isPersonal, true)));
  if (existing.length === 0) {
    const [userRow] = await dbClient
      .select({ id: users.id, displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Account not found. Please sign in again." });
    }
    const scope = await resolvePrimaryScopeForUser(dbClient as typeof db, userId);
    if (!scope) {
      throw new Error("Failed to resolve a calendar scope for this user.");
    }
    const name = buildPersonalCalendarName(userRow.displayName, userRow.username, 1);
    await dbClient.insert(calendars).values({
      userId,
      name,
      color: "#22c55e",
      isPrimary: true,
      isPersonal: true,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    });
    return await dbClient
      .select()
      .from(calendars)
      .where(and(eq(calendars.userId, userId), eq(calendars.isPersonal, true)));
  }

  const hasPrimary = existing.some((cal) => cal.isPrimary);
  if (!hasPrimary) {
    const primaryId = existing[0]?.id;
    if (primaryId) {
      await dbClient
        .update(calendars)
        .set({ isPrimary: false })
        .where(and(eq(calendars.userId, userId), eq(calendars.isPersonal, true)));
      await dbClient.update(calendars).set({ isPrimary: true }).where(eq(calendars.id, primaryId));
      return await dbClient
        .select()
        .from(calendars)
        .where(and(eq(calendars.userId, userId), eq(calendars.isPersonal, true)));
    }
  }

  return existing;
}

export async function suggestPersonalCalendarName(dbClient: DbExecutor, userId: number) {
  const [userRow] = await dbClient
    .select({ displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!userRow) return "Personal Calendar #1";

  const [countRow] = await dbClient
    .select({ count: sql<number>`count(*)` })
    .from(calendars)
    .where(and(eq(calendars.userId, userId), eq(calendars.isPersonal, true)));
  const count = Number(countRow?.count ?? 0);
  const nextIndex = Number.isFinite(count) ? count + 1 : 1;
  return buildPersonalCalendarName(userRow.displayName, userRow.username, nextIndex);
}

function buildPersonalCalendarName(displayName: string | null, username: string | null, index: number) {
  const raw = (displayName ?? "").trim() || (username ?? "").trim() || "Personal";
  const parts = raw.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "Personal";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const lastInitial = last ? `${last[0]?.toUpperCase() ?? ""}.` : "";
  const prefix = lastInitial ? `${first} ${lastInitial}` : first;
  return `${prefix} Personal Calendar #${index}`;
}

function buildScopeCondition(
  visible: { business: boolean; departmentIds: number[]; divisionIds: number[] },
  scopeTypeColumn: typeof calendars.scopeType,
  scopeIdColumn: typeof calendars.scopeId,
) {
  if (visible.business) return null;
  const conditions: SQL<unknown>[] = [];
  if (visible.departmentIds.length > 0) {
    const departmentCondition = and(eq(scopeTypeColumn, "department"), inArray(scopeIdColumn, visible.departmentIds));
    if (departmentCondition) conditions.push(departmentCondition);
  }
  if (visible.divisionIds.length > 0) {
    const divisionCondition = and(eq(scopeTypeColumn, "division"), inArray(scopeIdColumn, visible.divisionIds));
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
  calendarRow: Pick<CalendarRow, "scopeType" | "scopeId">,
  visible: { business: boolean; departmentIds: number[]; divisionIds: number[] },
) {
  if (visible.business) return true;
  if (calendarRow.scopeType === "department") return visible.departmentIds.includes(calendarRow.scopeId);
  if (calendarRow.scopeType === "division") return visible.divisionIds.includes(calendarRow.scopeId);
  if (calendarRow.scopeType === "business") return visible.business;
  return false;
}

export async function listAccessibleCalendars(dbClient: DbExecutor, userId: number): Promise<CalendarAccess[]> {
  const [visibleScopes, elevatedScopes] = await Promise.all([
    getVisibleScopes(dbClient as typeof db, userId),
    getElevatedVisibleScopes(dbClient as typeof db, userId),
  ]);

  const sharedScopeCondition = buildScopeCondition(visibleScopes, calendars.scopeType, calendars.scopeId);
  const elevatedScopeCondition = buildScopeCondition(elevatedScopes, calendars.scopeType, calendars.scopeId);

  const conditions: SQL<unknown>[] = [];

  const sharedCondition = sharedScopeCondition
    ? and(eq(calendars.isPersonal, false), sharedScopeCondition)
    : eq(calendars.isPersonal, false);
  conditions.push(sharedCondition);

  conditions.push(and(eq(calendars.isPersonal, true), eq(calendars.userId, userId)));

  if (elevatedScopes.business) {
    conditions.push(eq(calendars.isPersonal, true));
  } else if (elevatedScopeCondition) {
    conditions.push(and(eq(calendars.isPersonal, true), elevatedScopeCondition));
  }

  const [first, ...rest] = conditions;
  let whereCondition: SQL<unknown> | null = first ?? null;
  for (const condition of rest) {
    whereCondition = whereCondition ? (or(whereCondition, condition) ?? whereCondition) : condition;
  }

  const rows = await dbClient
    .select({
      calendar: calendars,
      owner: {
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      },
    })
    .from(calendars)
    .leftJoin(users, eq(calendars.userId, users.id))
    .where(whereCondition ?? sql`true`)
    .orderBy(calendars.isPersonal, calendars.name);

  return rows.map((row) => {
    const canManage = row.calendar.isPersonal
      ? row.calendar.userId === userId || isScopeVisible(row.calendar, elevatedScopes)
      : isScopeVisible(row.calendar, elevatedScopes);
    const canWrite = row.calendar.isPersonal
      ? row.calendar.userId === userId || isScopeVisible(row.calendar, elevatedScopes)
      : isScopeVisible(row.calendar, visibleScopes);
    return {
      ...row.calendar,
      canManage,
      canWrite,
      owner: row.owner?.id
        ? {
            id: row.owner.id,
            displayName: row.owner.displayName,
            email: row.owner.email,
          }
        : null,
    };
  });
}

export async function getCalendarAccess(dbClient: DbExecutor, userId: number, calendarId: number) {
  const [visibleScopes, elevatedScopes] = await Promise.all([
    getVisibleScopes(dbClient as typeof db, userId),
    getElevatedVisibleScopes(dbClient as typeof db, userId),
  ]);

  const [row] = await dbClient
    .select({
      calendar: calendars,
    })
    .from(calendars)
    .where(eq(calendars.id, calendarId))
    .limit(1);
  if (!row) return null;
  const calendar = row.calendar;
  const canManage = calendar.isPersonal
    ? calendar.userId === userId || isScopeVisible(calendar, elevatedScopes)
    : isScopeVisible(calendar, elevatedScopes);
  const canWrite = calendar.isPersonal
    ? calendar.userId === userId || isScopeVisible(calendar, elevatedScopes)
    : isScopeVisible(calendar, visibleScopes);
  const canView = calendar.isPersonal
    ? calendar.userId === userId || isScopeVisible(calendar, elevatedScopes)
    : isScopeVisible(calendar, visibleScopes);
  return { calendar, canManage, canWrite, canView };
}

export async function getAccessibleCalendarIds(dbClient: DbExecutor, userId: number) {
  const calendars = await listAccessibleCalendars(dbClient, userId);
  return calendars.map((calendar) => calendar.id);
}
