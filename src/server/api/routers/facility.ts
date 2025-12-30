import { z } from "zod";
import { and, eq, ilike, or } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { buildings, rooms } from "~/server/db/schema";

export const facilityRouter = createTRPCRouter({
  listBuildings: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: buildings.id, name: buildings.name, acronym: buildings.acronym })
      .from(buildings)
      .orderBy(buildings.name);
    return rows;
  }),

  searchRooms: publicProcedure
    .input(
      z.object({
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const limit = input.limit ?? 10;
      const raw = input.query.trim();
      const upper = raw.toUpperCase();

      // Parse potential patterns like "BHG 210", "BHG-210A", "BHG210", just room "210" or just acronym "BHG"
      // Extract leading letters as acronym and trailing alnum as room if present
      let parsedAcronym: string | null = null;
      let parsedRoom: string | null = null;

      const compact = upper.replace(/\s+|-/g, "");
      const matchAcrRoom = /^([A-Z]{1,16})([0-9][A-Z0-9]*)$/.exec(compact);
      if (matchAcrRoom) {
        parsedAcronym = matchAcronymSafe(matchAcrRoom[1] ?? null);
        parsedRoom = matchAcrRoom[2] ?? null;
      } else {
        const m2 = /^\s*([A-Z]{1,16})\s*[- ]?\s*([0-9][A-Z0-9]*)\s*$/.exec(upper);
        if (m2) {
          parsedAcronym = matchAcronymSafe(m2[1] ?? null);
          parsedRoom = m2[2] ?? null;
        } else {
          const onlyAcr = /^\s*([A-Z]{1,16})\s*$/.exec(upper);
          const onlyRoom = /^\s*([0-9][A-Z0-9]*)\s*$/.exec(upper);
          if (onlyAcr) parsedAcronym = matchAcronymSafe(onlyAcr[1] ?? null);
          if (onlyRoom) parsedRoom = onlyRoom[1] ?? null;
        }
      }

      // Build query
      // Results: buildingId, buildingName, acronym, roomNumber
      const baseSelect = ctx.db
        .select({
          buildingId: buildings.id,
          buildingName: buildings.name,
          acronym: buildings.acronym,
          roomNumber: rooms.roomNumber,
        })
        .from(rooms)
        .innerJoin(buildings, eq(rooms.buildingId, buildings.id));

      if (parsedAcronym && parsedRoom) {
        // Strong match: specific building and room (ILIKE to allow partials like 210 vs 210A)
        const rows = await baseSelect
          .where(and(eq(buildings.acronym, parsedAcronym), ilike(rooms.roomNumber, `${parsedRoom}%`)))
          .limit(limit);
        return rows;
      }

      if (parsedAcronym && !parsedRoom) {
        // Only acronym known: return first rooms in that building
        const rows = await baseSelect.where(eq(buildings.acronym, parsedAcronym)).limit(limit);
        return rows;
      }

      if (!parsedAcronym && parsedRoom) {
        // Only room known: search across buildings
        const like = `%${parsedRoom.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        const rows = await baseSelect.where(ilike(rooms.roomNumber, like)).limit(limit);
        return rows;
      }

      // Fallback: search both acronym and room loosely
      const like = `%${upper.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const rows = await baseSelect
        .where(or(ilike(buildings.acronym, like), ilike(rooms.roomNumber, like), ilike(buildings.name, like)))
        .limit(limit);
      return rows;
    }),
});

function matchAcronymSafe(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return null;
  // Prevent overly long or non-alpha acronyms
  if (!/^[A-Z]{1,16}$/.test(trimmed)) return null;
  return trimmed;
}
