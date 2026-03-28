import { z } from "zod";

import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";
import { indexProfile, searchProfiles } from "~/server/services/profile-search";
import { profiles } from "~/server/db/schema";

const DEFAULT_LIMIT = 8;

export const profileRouter = createTRPCRouter({
  me: protectedProcedure.query(async ({ ctx }) => {
    const userId = Number(ctx.session.user.id);
    if (!Number.isFinite(userId)) {
      throw new Error("Invalid session user id.");
    }

    const profile = await ctx.db.query.profiles.findFirst({
      where: (profile, { eq }) => eq(profile.userId, userId),
    });

    if (!profile) return null;

    return {
      profileId: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      username: ctx.session.user.name ?? null,
      phoneNumber: profile.phoneNumber,
      displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
    };
  }),
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
        phoneNumber: profile.phoneNumber,
        displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
      }));
    }),
  create: protectedProcedure
    .input(
      z
        .object({
          firstName: z.string().trim().min(1).max(100),
          lastName: z.string().trim().min(1).max(100),
          email: z.string().trim().email().max(255),
          phoneNumber: z.string().trim().max(32).optional(),
        })
        .transform((value) => ({
          ...value,
          firstName: value.firstName.trim(),
          lastName: value.lastName.trim(),
          email: value.email.trim().toLowerCase(),
          phoneNumber: value.phoneNumber?.trim() ?? "",
        })),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.profiles.findFirst({
        where: (profile, { eq }) => eq(profile.email, input.email),
      });
      const phoneDigits = input.phoneNumber.replace(/\D/g, "").slice(0, 32);
      if (existing) {
        return {
          profileId: existing.id,
          firstName: existing.firstName,
          lastName: existing.lastName,
          email: existing.email,
          phoneNumber: existing.phoneNumber,
          username: null,
          displayName: [existing.firstName, existing.lastName].filter(Boolean).join(" "),
        };
      }

      const [created] = await ctx.db
        .insert(profiles)
        .values({
          userId: null,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phoneNumber: phoneDigits,
        })
        .returning({
          id: profiles.id,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          email: profiles.email,
          phoneNumber: profiles.phoneNumber,
        });

      if (created) {
        await indexProfile({
          id: created.id,
          firstName: created.firstName,
          lastName: created.lastName,
          email: created.email,
          username: null,
          phoneNumber: created.phoneNumber,
        });
      }

      return {
        profileId: created?.id ?? null,
        firstName: created?.firstName ?? input.firstName,
        lastName: created?.lastName ?? input.lastName,
        email: created?.email ?? input.email,
        phoneNumber: created?.phoneNumber ?? phoneDigits,
        username: null,
        displayName: [input.firstName, input.lastName].filter(Boolean).join(" "),
      };
    }),
});
