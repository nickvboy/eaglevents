import { faker } from "@faker-js/faker";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  businesses,
  buildings,
  rooms,
  departments,
  organizationRoles,
  users,
  profiles,
  themePalettes,
  themeProfiles,
} from "~/server/db/schema";
import { getSetupStatus } from "~/server/services/setup";
import { ensurePrimaryCalendars } from "~/server/services/calendar";

const businessTypeValues = ["university", "nonprofit", "corporation", "government", "venue", "other"] as const;
const roleTypeValues = ["admin", "manager", "employee"] as const;
const scopeTypeValues = ["business", "department", "division"] as const;

const buildingInputSchema = z.object({
  name: z.string().min(2).max(255),
  acronym: z.string().min(2).max(16),
  rooms: z.array(z.string().min(1).max(64)).min(1),
});

const departmentInputSchema = z.object({
  name: z.string().min(2).max(255),
  divisions: z.array(z.object({ name: z.string().min(2).max(255) })).optional(),
});

const roleAssignmentSchema = z.object({
  scopeType: z.enum(scopeTypeValues),
  scopeId: z.number().int().positive(),
  roleType: z.enum(roleTypeValues),
});

const userAccountSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email().max(255),
  password: z.string().min(8).max(255),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phoneNumber: z.string().min(10).max(32),
  dateOfBirth: z.string().optional(),
  roleAssignments: z.array(roleAssignmentSchema).min(1),
});

function sanitizePhone(raw: string) {
  return raw.replace(/\D/g, "").slice(0, 15);
}

function requireActiveSetup(status: Awaited<ReturnType<typeof getSetupStatus>>) {
  if (!status.needsSetup) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Setup has already been completed.",
    });
  }
}

export const setupRouter = createTRPCRouter({
  status: publicProcedure.query(async ({ ctx }) => {
    return getSetupStatus(ctx.db);
  }),

  createBusiness: publicProcedure
    .input(z.object({ name: z.string().min(2).max(255), type: z.enum(businessTypeValues) }))
    .mutation(async ({ ctx, input }) => {
      const trimmedName = input.name.trim();
      const status = await getSetupStatus(ctx.db);
      if (!status.databaseClean && !status.business) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Database already contains organizational data. Clean the database before running setup.",
        });
      }
      if (status.business) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Business already exists." });
      }
      await ctx.db.insert(businesses).values({
        name: trimmedName,
        type: input.type,
      });
      return getSetupStatus(ctx.db);
    }),

  createBuildings: publicProcedure
    .input(z.object({ buildings: z.array(buildingInputSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const status = await getSetupStatus(ctx.db);
      requireActiveSetup(status);
      if (!status.business) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Create a business before adding buildings." });
      }
      const businessId = status.business.id;
      const deduped = input.buildings.map((b) => ({
        name: b.name.trim(),
        acronym: b.acronym.trim(),
        rooms: Array.from(new Set(b.rooms.map((room) => room.trim()).filter((room) => room.length > 0))),
      }));

      await ctx.db.transaction(async (tx) => {
        for (const building of deduped) {
          const [inserted] = await tx
            .insert(buildings)
            .values({
              businessId,
              name: building.name,
              acronym: building.acronym,
            })
            .returning();
          if (!inserted) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save building." });
          if (building.rooms.length > 0) {
            await tx.insert(rooms).values(
              building.rooms.map((roomNumber) => ({
                buildingId: inserted.id,
                roomNumber,
              })),
            );
          }
        }
      });

      return getSetupStatus(ctx.db);
    }),

  createDepartments: publicProcedure
    .input(z.object({ departments: z.array(departmentInputSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const status = await getSetupStatus(ctx.db);
      requireActiveSetup(status);
      if (!status.business) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Create a business before adding departments." });
      }

      const businessId = status.business.id;
      await ctx.db.transaction(async (tx) => {
        for (const dept of input.departments) {
          const [departmentRow] = await tx
            .insert(departments)
            .values({ businessId, name: dept.name.trim() })
            .returning();
          if (!departmentRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save department." });
          const divisions = dept.divisions ?? [];
          if (divisions.length > 0) {
            await tx.insert(departments).values(
              divisions.map((division) => ({
                businessId,
                name: division.name.trim(),
                parentDepartmentId: departmentRow.id,
              })),
            );
          }
        }
      });

      return getSetupStatus(ctx.db);
    }),

  createUsersWithRoles: publicProcedure
    .input(z.object({ users: z.array(userAccountSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const status = await getSetupStatus(ctx.db);
      requireActiveSetup(status);
      if (!status.business) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Create business details before adding users." });
      }

      const businessId = status.business.id;
      const departmentLookup = new Map(status.departments.flat.map((dept) => [dept.id, dept]));

      const usernameSet = new Set<string>();
      const emailSet = new Set<string>();
      for (const user of input.users) {
        const username = user.username.trim();
        const emailLower = user.email.toLowerCase();
        if (usernameSet.has(username)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Duplicate username in request: ${username}` });
        }
        if (emailSet.has(emailLower)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Duplicate email in request: ${user.email}` });
        }
        usernameSet.add(username);
        emailSet.add(emailLower);
      }

      const normalizeAssignments = (assignments: typeof input.users[number]["roleAssignments"]) => {
        const seen = new Set<string>();
        const normalized: typeof assignments = [];
        for (const assignment of assignments) {
          const key = `${assignment.scopeType}:${assignment.scopeId}:${assignment.roleType}`;
          if (seen.has(key)) continue;
          seen.add(key);
          normalized.push(assignment);
        }
        return normalized;
      };

      const validateScope = (assignment: z.infer<typeof roleAssignmentSchema>) => {
        if (assignment.scopeType === "business") {
          if (assignment.scopeId !== businessId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Business role must target the current business." });
          }
          return;
        }
        const target = departmentLookup.get(assignment.scopeId);
        if (!target) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Department/division scope not found.",
          });
        }
        const isDivision = target.parentDepartmentId !== null;
        if (assignment.scopeType === "department" && isDivision) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Scope ${target.name} is a division, not a department.` });
        }
        if (assignment.scopeType === "division" && !isDivision) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Scope ${target.name} is a department, not a division.` });
        }
      };

      await ctx.db.transaction(async (tx) => {
        const existingUsers = await tx
          .select({ id: users.id, username: users.username, email: users.email })
          .from(users)
          .where(inArray(users.username, Array.from(usernameSet)));
        if (existingUsers.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Username already exists: ${existingUsers[0]?.username}`,
          });
        }
        const existingEmails = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.email, Array.from(emailSet)));
        if (existingEmails.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Email already exists: ${existingEmails[0]?.email}`,
          });
        }

        for (const user of input.users) {
          const username = user.username.trim();
          const emailLower = user.email.toLowerCase();
          const phoneDigits = sanitizePhone(user.phoneNumber);
          if (phoneDigits.length < 10) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Phone number must contain at least 10 digits for ${username}.` });
          }
          const assignments = normalizeAssignments(user.roleAssignments);
          assignments.forEach(validateScope);

          let dateOfBirth: string | null = null;
          if (user.dateOfBirth) {
            const parsed = new Date(user.dateOfBirth);
            if (Number.isNaN(parsed.getTime())) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date of birth." });
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (parsed > today) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Date of birth cannot be in the future." });
            }
            dateOfBirth = user.dateOfBirth;
          }

          const passwordHash = await bcrypt.hash(user.password, 10);
          const displayName = `${user.firstName.trim()} ${user.lastName.trim()}`.trim();

          const [insertedUser] = await tx
            .insert(users)
            .values({
              username,
              email: emailLower,
              displayName,
              passwordHash,
            })
            .returning();
          if (!insertedUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create user." });

          const [profileRow] = await tx
            .insert(profiles)
            .values({
              userId: insertedUser.id,
              firstName: user.firstName.trim(),
              lastName: user.lastName.trim(),
              email: emailLower,
              phoneNumber: phoneDigits,
              dateOfBirth,
            })
            .returning();
          if (!profileRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create profile." });

          await tx.insert(organizationRoles).values(
            assignments.map((assignment) => ({
              userId: insertedUser.id,
              profileId: profileRow.id,
              roleType: assignment.roleType,
              scopeType: assignment.scopeType,
              scopeId: assignment.scopeId,
            })),
          );

          await ensurePrimaryCalendars(tx, insertedUser.id);
        }
      });

      return getSetupStatus(ctx.db);
    }),

  clearAllAccounts: publicProcedure.mutation(async ({ ctx }) => {
    const status = await getSetupStatus(ctx.db);
    requireActiveSetup(status);

    await ctx.db.transaction(async (tx) => {
      // Delete all users (cascades to organizationRoles, calendars, events, etc.)
      await tx.delete(users);
      // Delete all profiles (they have onDelete: "set null" so won't cascade from users)
      await tx.delete(profiles);
    });

    return getSetupStatus(ctx.db);
  }),

  createDefaultUsers: publicProcedure.mutation(async ({ ctx }) => {
    const status = await getSetupStatus(ctx.db);
    requireActiveSetup(status);
    if (!status.business) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Create business details before adding users." });
    }

    if (status.missingAdmins.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "All scopes already have admin users." });
    }

    const businessId = status.business.id;
    const departmentLookup = new Map(status.departments.flat.map((dept) => [dept.id, dept]));

    // Generate default users for each missing admin scope
    // Track used usernames/emails to ensure uniqueness (in case labels sanitize to same value)
    const usedUsernames = new Set<string>();
    const usedEmails = new Set<string>();
    const generatedUsersSummary: {
      username: string;
      password: string;
      email: string;
      roleType: (typeof roleTypeValues)[number];
      scopeType: (typeof scopeTypeValues)[number];
      scopeId: number;
      scopeLabel: string;
    }[] = [];

    const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const normalizeHandle = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const businessSlug = slugify(status.business.name) || "organization";
    const MAX_USERNAME_LENGTH = 50;
    const roleVariants = [
      { roleType: "admin" as const, prefix: "admin", passwordPrefix: "Admin" },
      { roleType: "manager" as const, prefix: "manager", passwordPrefix: "Manager" },
      { roleType: "employee" as const, prefix: "employee", passwordPrefix: "Employee" },
    ] as const;

    const defaultUsers = status.missingAdmins.flatMap((missing) => {
      const scopeLabel = slugify(missing.label) || "scope";
      const scopeSuffix = String(missing.scopeId).padStart(4, "0").slice(-4);

      return roleVariants.map((variant) => {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const rawHandle = normalizeHandle(faker.internet.username({ firstName, lastName }));
        const scopeIdStr = String(missing.scopeId);
        const fallbackHandle = `${variant.prefix}${scopeSuffix}`;
        const baseHandle = rawHandle || fallbackHandle;
        const maxHandleLength = Math.max(3, MAX_USERNAME_LENGTH - variant.prefix.length - scopeIdStr.length - 2);
        const handle = baseHandle.slice(0, maxHandleLength);
        const username = `${variant.prefix}-${handle}-${scopeIdStr}`;
        const email = `${username}@${businessSlug}.local`;

        if (usedUsernames.has(username)) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Duplicate username generated: ${username}` });
        }
        if (usedEmails.has(email)) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Duplicate email generated: ${email}` });
        }
        usedUsernames.add(username);
        usedEmails.add(email);

        const phoneNumber = faker.string.numeric(10);
        const dateOfBirth = faker.date.birthdate({ min: 22, max: 60, mode: "age" }).toISOString().slice(0, 10);
        const password = `${variant.passwordPrefix}${scopeSuffix}${faker.string.alphanumeric(4)}!`;

        generatedUsersSummary.push({
          username,
          password,
          email,
          roleType: variant.roleType,
          scopeType: missing.scopeType,
          scopeId: missing.scopeId,
          scopeLabel: missing.label,
        });

        return {
          firstName,
          lastName,
          email,
          phoneNumber,
          username,
          password,
          dateOfBirth,
          roleAssignments: [
            {
              scopeType: missing.scopeType,
              scopeId: missing.scopeId,
              roleType: variant.roleType,
            },
          ],
        };
      });
    });

    // Use the existing createUsersWithRoles logic
    const usernameSet = new Set<string>();
    const emailSet = new Set<string>();
    for (const user of defaultUsers) {
      const username = user.username.trim();
      const emailLower = user.email.toLowerCase();
      if (usernameSet.has(username)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Duplicate username in request: ${username}` });
      }
      if (emailSet.has(emailLower)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Duplicate email in request: ${user.email}` });
      }
      usernameSet.add(username);
      emailSet.add(emailLower);
    }

    const normalizeAssignments = (assignments: typeof defaultUsers[number]["roleAssignments"]) => {
      const seen = new Set<string>();
      const normalized: typeof assignments = [];
      for (const assignment of assignments) {
        const key = `${assignment.scopeType}:${assignment.scopeId}:${assignment.roleType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(assignment);
      }
      return normalized;
    };

    const validateScope = (assignment: z.infer<typeof roleAssignmentSchema>) => {
      if (assignment.scopeType === "business") {
        if (assignment.scopeId !== businessId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Business role must target the current business." });
        }
        return;
      }
      const target = departmentLookup.get(assignment.scopeId);
      if (!target) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Department/division scope not found.",
        });
      }
      const isDivision = target.parentDepartmentId !== null;
      if (assignment.scopeType === "department" && isDivision) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Scope ${target.name} is a division, not a department.` });
      }
      if (assignment.scopeType === "division" && !isDivision) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Scope ${target.name} is a department, not a division.` });
      }
    };

    await ctx.db.transaction(async (tx) => {
      const existingUsers = await tx
        .select({ id: users.id, username: users.username, email: users.email })
        .from(users)
        .where(inArray(users.username, Array.from(usernameSet)));
      if (existingUsers.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Username already exists: ${existingUsers[0]?.username}`,
        });
      }
      const existingEmails = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, Array.from(emailSet)));
      if (existingEmails.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Email already exists: ${existingEmails[0]?.email}`,
        });
      }

      for (const user of defaultUsers) {
        const username = user.username.trim();
        const emailLower = user.email.toLowerCase();
        const phoneDigits = sanitizePhone(user.phoneNumber);
        if (phoneDigits.length < 10) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Phone number must contain at least 10 digits for ${username}.` });
        }
        const assignments = normalizeAssignments(user.roleAssignments);
        assignments.forEach(validateScope);

        const passwordHash = await bcrypt.hash(user.password, 10);
        const displayName = `${user.firstName.trim()} ${user.lastName.trim()}`.trim();

        const [insertedUser] = await tx
          .insert(users)
          .values({
            username,
            email: emailLower,
            displayName,
            passwordHash,
          })
          .returning();
        if (!insertedUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create user." });

        const [profileRow] = await tx
          .insert(profiles)
          .values({
            userId: insertedUser.id,
            firstName: user.firstName.trim(),
            lastName: user.lastName.trim(),
            email: emailLower,
            phoneNumber: phoneDigits,
            dateOfBirth: user.dateOfBirth ?? null,
          })
          .returning();
        if (!profileRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create profile." });

        await tx.insert(organizationRoles).values(
          assignments.map((assignment) => ({
            userId: insertedUser.id,
            profileId: profileRow.id,
            roleType: assignment.roleType,
            scopeType: assignment.scopeType,
            scopeId: assignment.scopeId,
          })),
        );

        await ensurePrimaryCalendars(tx, insertedUser.id);
      }
    });

    const latestStatus = await getSetupStatus(ctx.db);
    return {
      status: latestStatus,
      generatedUsers: generatedUsersSummary,
    };
  }),

  completeSetup: publicProcedure
    .input(z.object({ paletteId: z.number().int().positive().nullable().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
    const status = await getSetupStatus(ctx.db);
    requireActiveSetup(status);
    if (!status.business) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No business found to complete setup." });
    }
    if (!status.readyForCompletion) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Complete each step and add a business, buildings, departments, and admins for every scope.",
      });
    }

    const adminUserIds = Array.from(
      new Set(status.roles.filter((role) => role.roleType === "admin").map((role) => role.userId)),
    );

    await ctx.db.transaction(async (tx) => {
      if (input?.paletteId !== undefined) {
        if (input.paletteId === null) {
          await tx
            .delete(themeProfiles)
            .where(
              and(
                eq(themeProfiles.businessId, status.business!.id),
                eq(themeProfiles.scopeType, "business"),
                eq(themeProfiles.scopeId, status.business!.id),
              ),
            );
        } else {
          const [palette] = await tx
            .select({ id: themePalettes.id })
            .from(themePalettes)
            .where(and(eq(themePalettes.id, input.paletteId), eq(themePalettes.businessId, status.business!.id)))
            .limit(1);
          if (!palette) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Selected theme does not belong to this workspace." });
          }

          const [existing] = await tx
            .select({ id: themeProfiles.id })
            .from(themeProfiles)
            .where(
              and(
                eq(themeProfiles.businessId, status.business!.id),
                eq(themeProfiles.scopeType, "business"),
                eq(themeProfiles.scopeId, status.business!.id),
              ),
            )
            .limit(1);

          if (existing) {
            await tx
              .update(themeProfiles)
              .set({
                paletteId: input.paletteId,
                updatedAt: new Date(),
              })
              .where(eq(themeProfiles.id, existing.id));
          } else {
            await tx.insert(themeProfiles).values({
              businessId: status.business!.id,
              scopeType: "business",
              scopeId: status.business!.id,
              paletteId: input.paletteId,
              label: "Workspace default",
              description: "",
            });
          }
        }
      }

      await tx
        .update(businesses)
        .set({ setupCompletedAt: new Date(), updatedAt: new Date() })
        .where(eq(businesses.id, status.business!.id));

      for (const userId of adminUserIds) {
        await ensurePrimaryCalendars(tx, userId);
      }
    });

    return getSetupStatus(ctx.db);
  }),
});
