import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { db as dbClient } from "~/server/db";
import { profiles } from "~/server/db/schema";
import {
  findProfileContactConflicts,
  indexProfile,
} from "~/server/services/profile-search";

type DbClient = typeof dbClient;

export const profileAffiliationValues = ["staff", "faculty", "student"] as const;
export const profileAffiliationSchema = z.enum(profileAffiliationValues);

export const createProfileInputSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(255),
    phoneNumber: z.string().trim().max(32).optional(),
    affiliation: profileAffiliationSchema.optional(),
    ignoreDuplicateContactCheck: z.boolean().optional(),
  });

export type CreateProfileInput = z.input<typeof createProfileInputSchema>;

export async function createProfileFromInput(options: {
  db: DbClient;
  input: CreateProfileInput;
}) {
  const parsed = createProfileInputSchema.parse(options.input);
  const input = {
    ...parsed,
    firstName: parsed.firstName.trim(),
    lastName: parsed.lastName.trim(),
    email: parsed.email.trim().toLowerCase(),
    phoneNumber: parsed.phoneNumber?.trim() ?? "",
    affiliation: parsed.affiliation ?? null,
    ignoreDuplicateContactCheck: parsed.ignoreDuplicateContactCheck ?? false,
  };
  const phoneDigits = input.phoneNumber.replace(/\D/g, "").slice(0, 32);

  if (!input.ignoreDuplicateContactCheck) {
    const conflicts = await findProfileContactConflicts(
      {
        email: input.email,
        phoneNumber: phoneDigits,
      },
      options.db,
    );
    if (conflicts.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A profile with the same email or phone number already exists.",
      });
    }
  }

  const [created] = await options.db
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
    displayName: [input.firstName, input.lastName].filter(Boolean).join(" "),
  };
}
