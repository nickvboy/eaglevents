import { eq } from "drizzle-orm";

import { calendars } from "~/server/db/schema";
import type { db } from "~/server/db";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;

/**
 * Ensures a user always has at least one calendar and exactly one marked as primary.
 * Returns the refreshed list of calendars for the user.
 */
export async function ensurePrimaryCalendars(dbClient: DbExecutor, userId: number) {
  const existing = await dbClient.select().from(calendars).where(eq(calendars.userId, userId));
  if (existing.length === 0) {
    await dbClient.insert(calendars).values({
      userId,
      name: "Calendar",
      color: "#22c55e",
      isPrimary: true,
    });
    return await dbClient.select().from(calendars).where(eq(calendars.userId, userId));
  }

  const hasPrimary = existing.some((cal) => cal.isPrimary);
  if (!hasPrimary) {
    const primaryId = existing[0]?.id;
    if (primaryId) {
      await dbClient
        .update(calendars)
        .set({ isPrimary: false })
        .where(eq(calendars.userId, userId));
      await dbClient.update(calendars).set({ isPrimary: true }).where(eq(calendars.id, primaryId));
      return await dbClient.select().from(calendars).where(eq(calendars.userId, userId));
    }
  }

  return existing;
}
