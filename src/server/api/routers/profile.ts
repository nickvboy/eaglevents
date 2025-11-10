import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { searchProfiles } from "~/server/services/profile-search";

const DEFAULT_LIMIT = 8;

export const profileRouter = createTRPCRouter({
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(25).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const results = await searchProfiles(input.query, input.limit ?? DEFAULT_LIMIT, ctx.db);
      return results.map((profile) => ({
        profileId: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        username: profile.username,
        displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
      }));
    }),
});
