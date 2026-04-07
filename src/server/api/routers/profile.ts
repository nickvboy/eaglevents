import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from "~/server/api/trpc";
import {
  findProfileContactConflicts,
  indexProfile,
  searchProfiles,
} from "~/server/services/profile-search";
import { profiles } from "~/server/db/schema";

const DEFAULT_LIMIT = 8;
const profileAffiliationValues = ["staff", "faculty", "student"] as const;

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
      affiliation: profile.affiliation,
      displayName: [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(" "),
    };
  }),
  getById: protectedProcedure
    .input(
      z.object({
        profileId: z.number().int().positive(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.query.profiles.findFirst({
        where: (row, { eq }) => eq(row.id, input.profileId),
      });
      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profile not found.",
        });
      }

      const profileUserId = profile.userId;
      const linkedUser = profileUserId
        ? await ctx.db.query.users.findFirst({
            where: (user, { eq }) => eq(user.id, profileUserId),
            columns: {
              username: true,
            },
          })
        : null;

      return {
        profileId: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        username: linkedUser?.username ?? null,
        phoneNumber: profile.phoneNumber,
        affiliation: profile.affiliation ?? null,
        displayName: [profile.firstName, profile.lastName]
          .filter(Boolean)
          .join(" "),
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
      const results = await searchProfiles(
        input.query,
        input.limit ?? DEFAULT_LIMIT,
        ctx.db,
      );
      return results.map((profile) => ({
        profileId: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        username: profile.username,
        phoneNumber: profile.phoneNumber,
        affiliation: profile.affiliation ?? null,
        displayName: [profile.firstName, profile.lastName]
          .filter(Boolean)
          .join(" "),
      }));
    }),
  findContactConflicts: protectedProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(255).optional(),
        phoneNumber: z.string().trim().max(32).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conflicts = await findProfileContactConflicts(
        {
          email: input.email?.trim().toLowerCase() ?? "",
          phoneNumber: input.phoneNumber?.trim() ?? "",
        },
        ctx.db,
      );
      return conflicts.map((profile) => ({
        profileId: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        username: profile.username,
        phoneNumber: profile.phoneNumber,
        affiliation: profile.affiliation ?? null,
        matchesEmail: profile.matchesEmail,
        matchesPhoneNumber: profile.matchesPhoneNumber,
        displayName: [profile.firstName, profile.lastName]
          .filter(Boolean)
          .join(" "),
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
          affiliation: z.enum(profileAffiliationValues).optional(),
          ignoreDuplicateContactCheck: z.boolean().optional(),
        })
        .transform((value) => ({
          ...value,
          firstName: value.firstName.trim(),
          lastName: value.lastName.trim(),
          email: value.email.trim().toLowerCase(),
          phoneNumber: value.phoneNumber?.trim() ?? "",
          affiliation: value.affiliation ?? null,
        })),
    )
    .mutation(async ({ ctx, input }) => {
      const phoneDigits = input.phoneNumber.replace(/\D/g, "").slice(0, 32);
      if (!input.ignoreDuplicateContactCheck) {
        const conflicts = await findProfileContactConflicts(
          {
            email: input.email,
            phoneNumber: phoneDigits,
          },
          ctx.db,
        );
        if (conflicts.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A profile with the same email or phone number already exists.",
          });
        }
      }

      const [created] = await ctx.db
        .insert(profiles)
        .values({
          userId: null,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phoneNumber: phoneDigits,
          affiliation: input.affiliation,
        })
        .returning({
          id: profiles.id,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          email: profiles.email,
          phoneNumber: profiles.phoneNumber,
          affiliation: profiles.affiliation,
        });

      if (created) {
        await indexProfile({
          id: created.id,
          firstName: created.firstName,
          lastName: created.lastName,
          email: created.email,
          username: null,
          phoneNumber: created.phoneNumber,
          affiliation: created.affiliation ?? null,
        });
      }

      return {
        profileId: created?.id ?? null,
        firstName: created?.firstName ?? input.firstName,
        lastName: created?.lastName ?? input.lastName,
        email: created?.email ?? input.email,
        phoneNumber: created?.phoneNumber ?? phoneDigits,
        affiliation: created?.affiliation ?? input.affiliation ?? null,
        username: null,
        displayName: [input.firstName, input.lastName]
          .filter(Boolean)
          .join(" "),
      };
    }),
  update: protectedProcedure
    .input(
      z
        .object({
          profileId: z.number().int().positive(),
          firstName: z.string().trim().min(1).max(100),
          lastName: z.string().trim().min(1).max(100),
          email: z.string().trim().email().max(255),
          phoneNumber: z.string().trim().max(32).optional(),
          affiliation: z.enum(profileAffiliationValues).optional(),
        })
        .transform((value) => ({
          ...value,
          firstName: value.firstName.trim(),
          lastName: value.lastName.trim(),
          email: value.email.trim().toLowerCase(),
          phoneNumber: value.phoneNumber?.trim() ?? "",
          affiliation: value.affiliation ?? null,
        })),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.profiles.findFirst({
        where: (profile, { eq }) => eq(profile.id, input.profileId),
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profile not found.",
        });
      }

      const phoneDigits = input.phoneNumber.replace(/\D/g, "").slice(0, 32);
      const conflicts = await findProfileContactConflicts(
        {
          email: input.email,
          phoneNumber: phoneDigits,
          excludeProfileId: input.profileId,
        },
        ctx.db,
      );
      if (conflicts.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A profile with the same email or phone number already exists.",
        });
      }

      const [updated] = await ctx.db
        .update(profiles)
        .set({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phoneNumber: phoneDigits,
          affiliation: input.affiliation,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, input.profileId))
        .returning({
          id: profiles.id,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          email: profiles.email,
          phoneNumber: profiles.phoneNumber,
          affiliation: profiles.affiliation,
          userId: profiles.userId,
        });

      const updatedUserId = updated?.userId ?? null;
      const linkedUser = updatedUserId
        ? await ctx.db.query.users.findFirst({
            where: (user, { eq }) => eq(user.id, updatedUserId),
            columns: {
              username: true,
            },
          })
        : null;
      if (updated) {
        await indexProfile({
          id: updated.id,
          firstName: updated.firstName,
          lastName: updated.lastName,
          email: updated.email,
          username: linkedUser?.username ?? null,
          phoneNumber: updated.phoneNumber,
          affiliation: updated.affiliation ?? null,
        });
      }

      return {
        profileId: updated?.id ?? input.profileId,
        firstName: updated?.firstName ?? input.firstName,
        lastName: updated?.lastName ?? input.lastName,
        email: updated?.email ?? input.email,
        phoneNumber: updated?.phoneNumber ?? phoneDigits,
        affiliation: updated?.affiliation ?? input.affiliation ?? null,
        username: updated?.userId ? (linkedUser?.username ?? null) : null,
        displayName: [input.firstName, input.lastName]
          .filter(Boolean)
          .join(" "),
      };
    }),
});
