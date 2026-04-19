import { z } from "zod";
import { and, eq, ilike, or } from "drizzle-orm";

import { TRPCError } from "@trpc/server";

import { normalizeRoomNumber } from "~/lib/room-number";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { buildings, rooms } from "~/server/db/schema";
import { getPermissionContext } from "~/server/services/permissions";

export const facilityRouter = createTRPCRouter({
  listBuildings: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ id: buildings.id, name: buildings.name, acronym: buildings.acronym })
      .from(buildings)
      .orderBy(buildings.name);
    return rows;
    }),

  createRoom: protectedProcedure
    .input(
      z.object({
        buildingId: z.number().int().positive(),
        roomNumber: z.string().trim().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const context = await getPermissionContext(ctx.db, ctx.session);
      const role = context.primaryRole;
      if (!role) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to add rooms." });
      }
      const [buildingRow] = await ctx.db
        .select({ id: buildings.id, businessId: buildings.businessId })
        .from(buildings)
        .where(eq(buildings.id, input.buildingId))
        .limit(1);
      if (!buildingRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Building not found." });
      }
      if (context.businessId && buildingRow.businessId !== context.businessId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Building does not belong to this business." });
      }
      const roomNumber = normalizeRoomNumber(input.roomNumber);
      const [existing] = await ctx.db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.buildingId, input.buildingId), eq(rooms.roomNumber, roomNumber)))
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That room already exists for this building." });
      }
      const [roomRow] = await ctx.db
        .insert(rooms)
        .values({ buildingId: input.buildingId, roomNumber })
        .returning({ id: rooms.id });
      if (!roomRow) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create room." });
      }
      return { id: roomRow.id };
    }),

  searchRooms: publicProcedure
    .input(
      z.object({
        query: z.string().trim().min(1),
        buildingId: z.number().int().positive().optional(),
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
      // Results: roomId, buildingId, buildingName, acronym, roomNumber
      const baseSelect = ctx.db
        .select({
          roomId: rooms.id,
          buildingId: buildings.id,
          buildingName: buildings.name,
          acronym: buildings.acronym,
          roomNumber: rooms.roomNumber,
        })
        .from(rooms)
        .innerJoin(buildings, eq(rooms.buildingId, buildings.id));
      const buildingFilter = input.buildingId ? eq(buildings.id, input.buildingId) : undefined;
      const matchAny = (value: string) =>
        or(ilike(buildings.acronym, value), ilike(rooms.roomNumber, value), ilike(buildings.name, value));
      const matchBuilding = (value: string) => or(ilike(buildings.acronym, value), ilike(buildings.name, value));
      const tokens = raw
        .split(/[\s-]+/)
        .map((token) => token.trim())
        .filter(Boolean);
      const tokenConditions = tokens.map((token) => matchAny(`%${escapeLike(token)}%`));

      if (parsedAcronym && parsedRoom) {
        const acronymLike = `%${escapeLike(parsedAcronym)}%`;
        const roomLike = `%${escapeLike(parsedRoom)}%`;
        const rows = await baseSelect.where(
          and(
            buildingFilter,
            input.buildingId ? undefined : matchBuilding(acronymLike),
            ilike(rooms.roomNumber, roomLike),
          ),
        ).limit(limit);
        return rows;
      }

      if (parsedAcronym && !parsedRoom) {
        const acronymLike = `%${escapeLike(parsedAcronym)}%`;
        const rows = await baseSelect
          .where(and(buildingFilter, matchAny(acronymLike)))
          .limit(limit);
        return rows;
      }

      if (!parsedAcronym && parsedRoom) {
        // Room-only searches remain flexible for values like 210A while honoring the building filter.
        const like = `%${parsedRoom.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        const rows = await baseSelect.where(and(buildingFilter, ilike(rooms.roomNumber, like))).limit(limit);
        return rows;
      }

      // Fallback: every token can match acronym, room number, or building name.
      const like = `%${escapeLike(upper)}%`;
      const tokenMatch = tokenConditions.length > 0 ? and(...tokenConditions) : undefined;
      const rows = await baseSelect
        .where(
          and(
            buildingFilter,
            tokenMatch ?? matchAny(like),
          ),
        )
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

function escapeLike(input: string): string {
  return input.replace(/[%_]/g, (match) => `\\${match}`);
}
