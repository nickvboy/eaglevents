import { z } from "zod";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  businesses,
  calendars,
  events,
  organizationRoles,
  profiles,
  users,
} from "~/server/db/schema";
import {
  bucketizeByMonth,
  calculateTrendDelta,
  startOfMonth,
  sumSeries,
} from "~/server/services/admin";

type DbClient = typeof import("~/server/db").db;

const MONTHS_IN_TREND = 6;
const MS_IN_DAY = 24 * 60 * 60 * 1000;

type UserSummary = {
  id: number;
  username: string;
  email: string;
  displayName: string;
  createdAt: Date;
  primaryRole: "admin" | "manager" | "employee" | null;
  profile: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    dateOfBirth: Date | null;
  } | null;
  lastActivity: Date | null;
  totalEvents: number;
};

async function findBusinessId(db: DbClient): Promise<number | null> {
  const [business] = await db.select({ id: businesses.id }).from(businesses).orderBy(businesses.id).limit(1);
  return business?.id ?? null;
}

async function fetchUsers(db: DbClient, ids?: number[]): Promise<UserSummary[]> {
  let userQuery = db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt), users.id);

  if (ids && ids.length > 0) {
    userQuery = userQuery.where(inArray(users.id, ids));
  }

  const userRows = await userQuery;
  if (userRows.length === 0) return [];

  const userIds = userRows.map((row) => row.id);

  const profileRows = await db
    .select({
      id: profiles.id,
      userId: profiles.userId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      email: profiles.email,
      phoneNumber: profiles.phoneNumber,
      dateOfBirth: profiles.dateOfBirth,
    })
    .from(profiles)
    .where(inArray(profiles.userId, userIds));

  const profileMap = new Map<number, (typeof profileRows)[number]>();
  for (const profile of profileRows) {
    if (profile.userId !== null) profileMap.set(profile.userId, profile);
  }

  const activityRows = await db
    .select({
      userId: calendars.userId,
      lastActivity: sql<Date | null>`max(${events.startDatetime})`,
      totalEvents: sql<number>`count(${events.id})::int`,
    })
    .from(events)
    .innerJoin(calendars, eq(events.calendarId, calendars.id))
    .where(inArray(calendars.userId, userIds))
    .groupBy(calendars.userId);

  const activityMap = new Map<number, { lastActivity: Date | null; totalEvents: number }>();
  for (const activity of activityRows) {
    activityMap.set(activity.userId, {
      lastActivity: activity.lastActivity,
      totalEvents: activity.totalEvents ?? 0,
    });
  }

  const roleRows = await db
    .select({
      userId: organizationRoles.userId,
      roleType: organizationRoles.roleType,
    })
    .from(organizationRoles)
    .where(
      and(
        inArray(organizationRoles.userId, userIds),
        eq(organizationRoles.scopeType, "business"),
      ),
    );

  const priority = new Map<"admin" | "manager" | "employee", number>([
    ["admin", 3],
    ["manager", 2],
    ["employee", 1],
  ]);
  const roleMap = new Map<number, "admin" | "manager" | "employee">();
  for (const role of roleRows) {
    const existing = roleMap.get(role.userId);
    if (!existing || (priority.get(role.roleType) ?? 0) > (priority.get(existing) ?? 0)) {
      roleMap.set(role.userId, role.roleType);
    }
  }

  return userRows.map((user) => {
    const profile = profileMap.get(user.id) ?? null;
    const activity = activityMap.get(user.id);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      primaryRole: roleMap.get(user.id) ?? null,
      profile: profile
        ? {
            id: profile.id,
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            phoneNumber: profile.phoneNumber,
            dateOfBirth: profile.dateOfBirth ?? null,
          }
        : null,
      lastActivity: activity?.lastActivity ?? null,
      totalEvents: activity?.totalEvents ?? 0,
    };
  });
}

export const adminRouter = createTRPCRouter({
  dashboard: publicProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const trendRangeStart = startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_IN_TREND - 1), 1)));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_IN_DAY);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * MS_IN_DAY);
    const fourteenDaysAhead = new Date(now.getTime() + 14 * MS_IN_DAY);

    const [{ totalUsers }] = await ctx.db.select({ totalUsers: sql<number>`count(${users.id})::int` }).from(users);

    const userCreatedRows = await ctx.db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(gte(users.createdAt, trendRangeStart));

    const eventRows = await ctx.db
      .select({ startAt: events.startDatetime })
      .from(events)
      .where(gte(events.startDatetime, trendRangeStart));

    const userTrend = bucketizeByMonth(
      userCreatedRows.map((row) => row.createdAt).filter(Boolean),
      MONTHS_IN_TREND,
      now,
    );
    const eventTrend = bucketizeByMonth(
      eventRows.map((row) => row.startAt).filter(Boolean),
      MONTHS_IN_TREND,
      now,
    );

    const newUsersCurrent = userCreatedRows.filter((row) => row.createdAt >= thirtyDaysAgo).length;
    const newUsersPrevious = userCreatedRows.filter(
      (row) => row.createdAt < thirtyDaysAgo && row.createdAt >= sixtyDaysAgo,
    ).length;
    const eventsCurrent = eventRows.filter((row) => row.startAt >= thirtyDaysAgo).length;
    const eventsPrevious = eventRows.filter(
      (row) => row.startAt < thirtyDaysAgo && row.startAt >= sixtyDaysAgo,
    ).length;

    const recentEvents = await ctx.db
      .select({
        userId: calendars.userId,
        startAt: events.startDatetime,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(gte(events.startDatetime, thirtyDaysAgo));

    const previousEvents = await ctx.db
      .select({
        userId: calendars.userId,
        startAt: events.startDatetime,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .where(and(gte(events.startDatetime, sixtyDaysAgo), lt(events.startDatetime, thirtyDaysAgo)));

    const activeUserIds = new Set(recentEvents.map((row) => row.userId).filter((id): id is number => typeof id === "number"));
    const previousActiveUserIds = new Set(
      previousEvents.map((row) => row.userId).filter((id): id is number => typeof id === "number"),
    );

    const activeUserCount = activeUserIds.size;
    const previousActiveUserCount = previousActiveUserIds.size;

    const utilizationCurrent =
      activeUserCount > 0 ? Math.round((eventsCurrent / activeUserCount) * 10) / 10 : 0;
    const utilizationPrevious =
      previousActiveUserCount > 0 ? Math.round((eventsPrevious / previousActiveUserCount) * 10) / 10 : 0;

    const upcomingRows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        start: events.startDatetime,
        assigneeProfileId: events.assigneeProfileId,
      })
      .from(events)
      .where(and(gte(events.startDatetime, now), lt(events.startDatetime, fourteenDaysAhead)))
      .orderBy(events.startDatetime)
      .limit(6);

    const assigneeIds = Array.from(
      new Set(
        upcomingRows
          .map((row) => row.assigneeProfileId)
          .filter((id): id is number => typeof id === "number" && Number.isFinite(id)),
      ),
    );

    const assignees =
      assigneeIds.length > 0
        ? await ctx.db
            .select({
              id: profiles.id,
              firstName: profiles.firstName,
              lastName: profiles.lastName,
            })
            .from(profiles)
            .where(inArray(profiles.id, assigneeIds))
        : [];

    const assigneeMap = new Map<number, { firstName: string; lastName: string }>();
    for (const profile of assignees) {
      assigneeMap.set(profile.id, {
        firstName: profile.firstName,
        lastName: profile.lastName,
      });
    }

    const upcomingEvents = upcomingRows.map((row) => {
      const assignee = row.assigneeProfileId ? assigneeMap.get(row.assigneeProfileId) : null;
      return {
        id: row.id,
        title: row.title,
        start: row.start,
        assigneeName: assignee ? `${assignee.firstName} ${assignee.lastName}` : null,
      };
    });

    const activeUserRows = await ctx.db
      .select({
        userId: calendars.userId,
        displayName: users.displayName,
        email: users.email,
        username: users.username,
        lastActivity: sql<Date | null>`max(${events.startDatetime})`,
      })
      .from(events)
      .innerJoin(calendars, eq(events.calendarId, calendars.id))
      .innerJoin(users, eq(calendars.userId, users.id))
      .groupBy(calendars.userId, users.displayName, users.email, users.username)
      .orderBy(sql`max(${events.startDatetime}) desc`)
      .limit(8);

    const activeUsersList =
      activeUserRows.length > 0
        ? activeUserRows.map((row) => ({
            id: row.userId,
            name: row.displayName || row.username || row.email,
            email: row.email,
            lastActivity: row.lastActivity,
          }))
        : (
            await ctx.db
              .select({
                id: users.id,
                displayName: users.displayName,
                username: users.username,
                email: users.email,
              })
              .from(users)
              .orderBy(desc(users.createdAt))
              .limit(8)
          ).map((row) => ({
            id: row.id,
            name: row.displayName || row.username || row.email,
            email: row.email,
            lastActivity: null,
          }));

    const userTrendTotal = sumSeries(userTrend);
    const eventTrendTotal = sumSeries(eventTrend);

    const alerts: Array<{ id: string; message: string; severity: "critical" | "warning" | "info"; occurredAt: Date }> =
      [];

    if (newUsersCurrent < newUsersPrevious) {
      alerts.push({
        id: "user-growth",
        message: "User growth dipped compared to the previous month.",
        severity: "warning",
        occurredAt: now,
      });
    }

    if (activeUserCount === 0) {
      alerts.push({
        id: "no-active-users",
        message: "No user activity recorded in the last 30 days.",
        severity: "critical",
        occurredAt: now,
      });
    }

    if (upcomingEvents.length === 0) {
      alerts.push({
        id: "no-upcoming-events",
        message: "There are no scheduled events in the next two weeks.",
        severity: "warning",
        occurredAt: now,
      });
    }

    if (eventsCurrent > eventsPrevious * 1.2 && eventsPrevious > 0) {
      alerts.push({
        id: "event-velocity",
        message: "Event scheduling volume is trending sharply upward.",
        severity: "info",
        occurredAt: now,
      });
    }

    return {
      summaryCards: [
        {
          id: "total-users",
          label: "Total Users",
          value: totalUsers ?? 0,
          helper: `${newUsersCurrent} new this month`,
          delta: calculateTrendDelta(newUsersCurrent, newUsersPrevious),
        },
        {
          id: "active-users",
          label: "Active Users (30d)",
          value: activeUserCount,
          helper: `${previousActiveUserCount} previous period`,
          delta: calculateTrendDelta(activeUserCount, previousActiveUserCount),
        },
        {
          id: "events-month",
          label: "Events Scheduled (30d)",
          value: eventsCurrent,
          helper: `${eventsPrevious} previous period`,
          delta: calculateTrendDelta(eventsCurrent, eventsPrevious),
        },
        {
          id: "utilization",
          label: "Events per Active User",
          value: utilizationCurrent,
          helper: `${utilizationPrevious} previous`,
          delta: calculateTrendDelta(utilizationCurrent, utilizationPrevious),
        },
      ],
      charts: {
        userTrend,
        eventTrend,
        totals: {
          userTrendTotal,
          eventTrendTotal,
        },
      },
      activeUsers: activeUsersList,
      alerts,
      upcomingEvents,
    };
  }),

  users: publicProcedure.query(async ({ ctx }) => {
    return {
      users: await fetchUsers(ctx.db),
    };
  }),

  updateUser: publicProcedure
    .input(
      z
        .object({
          userId: z.number().int().positive(),
          displayName: z.string().min(1).max(255).optional(),
          profile: z
            .object({
              firstName: z.string().min(1).max(100),
              lastName: z.string().min(1).max(100),
              email: z.string().email().max(255),
              phoneNumber: z.string().min(1).max(32),
              dateOfBirth: z.coerce.date().optional().nullable(),
            })
            .optional(),
          primaryRole: z.enum(["admin", "manager", "employee"]).optional(),
        })
        .refine((value) => value.displayName !== undefined || value.profile !== undefined || value.primaryRole !== undefined, {
          message: "No updates provided",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        if (input.displayName !== undefined) {
          await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, input.userId));
        }

        let profileId: number | null = null;
        let existingProfileRecord: { id: number } | undefined;

        if (input.profile) {
          const [existingProfile] = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.userId, input.userId))
            .limit(1);

          existingProfileRecord = existingProfile;

          if (existingProfileRecord) {
            await tx
              .update(profiles)
              .set({
                firstName: input.profile.firstName,
                lastName: input.profile.lastName,
                email: input.profile.email,
                phoneNumber: input.profile.phoneNumber,
                dateOfBirth: input.profile.dateOfBirth ?? null,
              })
              .where(eq(profiles.id, existingProfileRecord.id));
            profileId = existingProfileRecord.id;
          } else {
            const [createdProfile] = await tx
              .insert(profiles)
              .values({
                userId: input.userId,
                firstName: input.profile.firstName,
                lastName: input.profile.lastName,
                email: input.profile.email,
                phoneNumber: input.profile.phoneNumber,
                dateOfBirth: input.profile.dateOfBirth ?? null,
              })
              .returning({ id: profiles.id });
            profileId = createdProfile?.id ?? null;
          }
        }

        if (profileId === null && input.primaryRole) {
          const [existingProfile] = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.userId, input.userId))
            .limit(1);
          profileId = existingProfile?.id ?? null;
        }

        if (input.primaryRole) {
          const scopeId = await findBusinessId(tx);
          if (scopeId !== null && profileId !== null) {
            await tx
              .delete(organizationRoles)
              .where(
                and(
                  eq(organizationRoles.userId, input.userId),
                  eq(organizationRoles.scopeType, "business"),
                  eq(organizationRoles.scopeId, scopeId),
                ),
              );
            await tx
              .insert(organizationRoles)
              .values({
                userId: input.userId,
                profileId,
                roleType: input.primaryRole,
                scopeType: "business",
                scopeId,
              })
              .returning();
          }
        }

        const [updatedUser] = await fetchUsers(tx, [input.userId]);
        if (!updatedUser) {
          throw new Error("User not found after update");
        }

        return updatedUser;
      });
    }),
});

