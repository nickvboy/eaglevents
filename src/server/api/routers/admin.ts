import { z } from "zod";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  buildings,
  businesses,
  calendars,
  departments,
  eventHourLogs,
  eventZendeskConfirmations,
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
const REPORT_WINDOW_DAYS = 60;
const UPCOMING_ZENDESK_DAYS = 14;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const REQUEST_CATEGORY_LABELS = {
  university_affiliated_request_to_university_business: "University business requests",
  university_affiliated_nonrequest_to_university_business: "Affiliated events without request",
  fgcu_student_affiliated_event: "FGCU student affiliated",
  non_affiliated_or_revenue_generating_event: "External or revenue events",
} as const;

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

type SelectParameter = {
  id: string;
  label: string;
  type: "select";
  options: Array<{ label: string; value: string }>;
  defaultValue: string;
  helper?: string;
};

type NumberParameter = {
  id: string;
  label: string;
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number;
  suffix?: string;
  helper?: string;
};

type ToggleParameter = {
  id: string;
  label: string;
  type: "toggle";
  defaultValue: boolean;
  helper?: string;
};

type ReportParameter = SelectParameter | NumberParameter | ToggleParameter;

type ExportReport =
  | {
      id: string;
      label: string;
      description: string;
      format: "multiYearMonth";
      years: Array<{
        year: number;
        months: Array<{ label: string; eventCount: number; staffedHours: number }>;
        totals: { events: number; hours: number };
      }>;
      parameters?: ReportParameter[];
    }
  | {
      id: string;
      label: string;
      description: string;
      format: "simpleTable";
      columns: string[];
      rows: Array<Array<string | number>>;
      parameters?: ReportParameter[];
    };

function minutesToHours(minutes: number) {
  if (minutes <= 0) return 0;
  return Math.round((minutes / 60) * 10) / 10;
}

function formatRequestCategory(code: string | null) {
  if (!code) return "Uncategorized";
  const label = REQUEST_CATEGORY_LABELS[code as keyof typeof REQUEST_CATEGORY_LABELS];
  if (label) return label;
  return code
    .split("_")
    .map((segment) => (segment ? segment[0]!.toUpperCase() + segment.slice(1) : segment))
    .join(" ");
}

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

  reports: publicProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - REPORT_WINDOW_DAYS * MS_IN_DAY);

    const eventRows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        start: events.startDatetime,
        end: events.endDatetime,
        buildingId: events.buildingId,
        buildingName: buildings.name,
        buildingAcronym: buildings.acronym,
        requestCategory: events.requestCategory,
        participantCount: events.participantCount,
        technicianNeeded: events.technicianNeeded,
        zendeskTicketNumber: events.zendeskTicketNumber,
      })
      .from(events)
      .leftJoin(buildings, eq(events.buildingId, buildings.id))
      .where(and(gte(events.startDatetime, windowStart), lt(events.startDatetime, now)))
      .orderBy(desc(events.startDatetime));

    const eventIds = eventRows.map((row) => row.id);
    const hourRows =
      eventIds.length === 0
        ? []
        : await ctx.db
            .select({
              eventId: eventHourLogs.eventId,
              durationMinutes: eventHourLogs.durationMinutes,
              loggedByProfileId: eventHourLogs.loggedByProfileId,
            })
            .from(eventHourLogs)
            .where(inArray(eventHourLogs.eventId, eventIds));

    const confirmationRows =
      eventIds.length === 0
        ? []
        : await ctx.db
            .select({
              eventId: eventZendeskConfirmations.eventId,
            })
            .from(eventZendeskConfirmations)
            .where(inArray(eventZendeskConfirmations.eventId, eventIds));

    const confirmedEvents = new Set(confirmationRows.map((row) => row.eventId));
    const ticketedEventIds = eventRows.filter((event) => event.zendeskTicketNumber).map((event) => event.id);
    const confirmedTicketCount = ticketedEventIds.filter((id) => confirmedEvents.has(id)).length;
    const awaitingTicketCount = ticketedEventIds.length - confirmedTicketCount;

    const totalMinutes = hourRows.reduce((acc, row) => acc + (row.durationMinutes ?? 0), 0);
    const totalEvents = eventRows.length;
    const technicianEvents = eventRows.filter((event) => event.technicianNeeded);
    const technicianTicketed = technicianEvents.filter((event) => event.zendeskTicketNumber).length;
    const technicianConfirmed = technicianEvents.filter((event) => confirmedEvents.has(event.id)).length;
    const technicianWithoutTicket = technicianEvents.length - technicianTicketed;
    const technicianAwaitingConfirmation = technicianTicketed - technicianConfirmed;

    const participantSamples = eventRows.filter((event) => typeof event.participantCount === "number").length;
    const totalParticipants = eventRows.reduce((acc, event) => acc + (event.participantCount ?? 0), 0);
    const avgParticipants = participantSamples === 0 ? null : Math.round(totalParticipants / participantSamples);

    type BuildingKey = number | "unassigned";
    const buildingStats = new Map<
      BuildingKey,
      {
        buildingId: number | null;
        buildingName: string | null;
        buildingAcronym: string | null;
        eventCount: number;
        technicianEvents: number;
        staffedMinutes: number;
      }
    >();
    const eventLookup = new Map(eventRows.map((row) => [row.id, row]));
    for (const event of eventRows) {
      const key: BuildingKey = event.buildingId ?? "unassigned";
      let entry = buildingStats.get(key);
      if (!entry) {
        entry = {
          buildingId: event.buildingId ?? null,
          buildingName: event.buildingName ?? null,
          buildingAcronym: event.buildingAcronym ?? null,
          eventCount: 0,
          technicianEvents: 0,
          staffedMinutes: 0,
        };
        buildingStats.set(key, entry);
      }
      entry.eventCount += 1;
      if (event.technicianNeeded) entry.technicianEvents += 1;
    }
    for (const log of hourRows) {
      const event = eventLookup.get(log.eventId);
      if (!event) continue;
      const key: BuildingKey = event.buildingId ?? "unassigned";
      const entry = buildingStats.get(key);
      if (!entry) continue;
      entry.staffedMinutes += log.durationMinutes ?? 0;
    }
    const buildingStatsList = Array.from(buildingStats.values())
      .sort((a, b) => b.eventCount - a.eventCount)
      .map((entry) => ({
        buildingId: entry.buildingId,
        buildingName: entry.buildingName ?? (entry.buildingId ? "Unnamed building" : "Unassigned location"),
        buildingAcronym: entry.buildingAcronym ?? null,
        eventCount: entry.eventCount,
        technicianEvents: entry.technicianEvents,
        staffedHours: minutesToHours(entry.staffedMinutes),
      }));
    const eventsByBuilding = buildingStatsList.slice(0, 6);

    const requestCategoryCounts = new Map<string, number>();
    for (const event of eventRows) {
      const key = event.requestCategory ?? "uncategorized";
      requestCategoryCounts.set(key, (requestCategoryCounts.get(key) ?? 0) + 1);
    }
    const requestCategories = Array.from(requestCategoryCounts.entries())
      .map(([category, value]) => ({
        category,
        label: formatRequestCategory(category === "uncategorized" ? null : category),
        value,
        percent: totalEvents === 0 ? 0 : Math.round((value / totalEvents) * 1000) / 10,
      }))
      .sort((a, b) => b.value - a.value);

    type DepartmentKey = number | "unassigned";
    const profileIds = Array.from(
      new Set(hourRows.map((row) => row.loggedByProfileId).filter((profileId): profileId is number => typeof profileId === "number")),
    );
    const roleRows =
      profileIds.length === 0
        ? []
        : await ctx.db
            .select({
              profileId: organizationRoles.profileId,
              scopeId: organizationRoles.scopeId,
            })
            .from(organizationRoles)
            .where(and(inArray(organizationRoles.profileId, profileIds), eq(organizationRoles.scopeType, "department")));
    const departmentIds = Array.from(new Set(roleRows.map((role) => role.scopeId)));
    const departmentRows =
      departmentIds.length === 0
        ? []
        : await ctx.db
            .select({
              id: departments.id,
              name: departments.name,
            })
            .from(departments)
            .where(inArray(departments.id, departmentIds));
    const departmentNameMap = new Map(departmentRows.map((dept) => [dept.id, dept.name]));
    const profileDepartmentMap = new Map(roleRows.map((role) => [role.profileId, role.scopeId]));
    const departmentMinutes = new Map<DepartmentKey, number>();
    for (const log of hourRows) {
      const departmentId = log.loggedByProfileId ? profileDepartmentMap.get(log.loggedByProfileId) ?? null : null;
      const key: DepartmentKey = departmentId ?? "unassigned";
      departmentMinutes.set(key, (departmentMinutes.get(key) ?? 0) + (log.durationMinutes ?? 0));
    }
    const departmentHoursList = Array.from(departmentMinutes.entries())
      .map(([key, minutes]) => ({
        departmentId: key === "unassigned" ? null : key,
        departmentName: key === "unassigned" ? "Unassigned" : departmentNameMap.get(key) ?? "Unassigned",
        hours: minutesToHours(minutes),
      }))
      .filter((entry) => entry.hours > 0)
      .sort((a, b) => b.hours - a.hours);
    const hoursByDepartment = departmentHoursList.slice(0, 6);

    const earliestEventYearRow = await ctx.db
      .select({
        year: sql<number>`min(extract(year from ${events.startDatetime}))::int`,
      })
      .from(events)
      .limit(1);
    const earliestEventYearValue = earliestEventYearRow[0]?.year ?? null;
    const lookbackStartYear = earliestEventYearValue ?? now.getUTCFullYear();
    const monthRangeStart = new Date(Date.UTC(lookbackStartYear, 0, 1));
    const eventYearExpr = sql<number>`extract(year from ${events.startDatetime})::int`;
    const eventMonthExpr = sql<number>`extract(month from ${events.startDatetime})::int`;
    const monthlyRows = await ctx.db
      .select({
        year: eventYearExpr,
        month: eventMonthExpr,
        eventCount: sql<number>`count(${events.id})::int`,
        staffedMinutes: sql<number>`coalesce(sum(${eventHourLogs.durationMinutes}), 0)::int`,
      })
      .from(events)
      .leftJoin(eventHourLogs, eq(events.id, eventHourLogs.eventId))
      .where(gte(events.startDatetime, monthRangeStart))
      .groupBy(eventYearExpr, eventMonthExpr)
      .orderBy(eventYearExpr, eventMonthExpr);

    const monthlyRowMap = new Map<string, { eventCount: number; staffedMinutes: number }>();
    let maxYearWithData = lookbackStartYear;
    for (const row of monthlyRows) {
      const year = Number(row.year ?? lookbackStartYear);
      const month = Number(row.month ?? 1);
      const eventCount = Number(row.eventCount ?? 0);
      const staffedMinutes = Number(row.staffedMinutes ?? 0);
      monthlyRowMap.set(`${year}-${month}`, { eventCount, staffedMinutes });
      if (year > maxYearWithData) {
        maxYearWithData = year;
      }
    }

    const targetEndYear = Math.max(maxYearWithData, lookbackStartYear);
    const monthlyReportYears: Array<{
      year: number;
      months: Array<{ label: string; eventCount: number; staffedHours: number }>;
      totals: { events: number; hours: number };
    }> = [];
    for (let year = lookbackStartYear; year <= targetEndYear; year++) {
      let yearlyEvents = 0;
      let yearlyHours = 0;
      const months = MONTH_LABELS.map((label, index) => {
        const stats = monthlyRowMap.get(`${year}-${index + 1}`);
        const eventCount = stats?.eventCount ?? 0;
        const staffedHours = minutesToHours(stats?.staffedMinutes ?? 0);
        yearlyEvents += eventCount;
        yearlyHours += staffedHours;
        return {
          label,
          eventCount,
          staffedHours,
        };
      });
      monthlyReportYears.push({
        year,
        months,
        totals: { events: yearlyEvents, hours: Math.round(yearlyHours * 10) / 10 },
      });
    }

    const futureCutoff = new Date(now.getTime() + UPCOMING_ZENDESK_DAYS * MS_IN_DAY);
    const upcomingZendeskRows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        start: events.startDatetime,
        buildingName: buildings.name,
        buildingAcronym: buildings.acronym,
        ticket: events.zendeskTicketNumber,
        technicianNeeded: events.technicianNeeded,
        confirmationId: eventZendeskConfirmations.id,
      })
      .from(events)
      .leftJoin(buildings, eq(events.buildingId, buildings.id))
      .leftJoin(eventZendeskConfirmations, eq(events.id, eventZendeskConfirmations.eventId))
      .where(and(gte(events.startDatetime, now), lt(events.startDatetime, futureCutoff), sql`${events.zendeskTicketNumber} IS NOT NULL`))
      .orderBy(events.startDatetime)
      .limit(32);

    const queueMap = new Map<
      number,
      {
        id: number;
        title: string;
        start: Date;
        buildingName: string | null;
        buildingAcronym: string | null;
        technicianNeeded: boolean;
        ticketNumber: string;
        hasConfirmation: boolean;
      }
    >();
    for (const row of upcomingZendeskRows) {
      let entry = queueMap.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          title: row.title,
          start: row.start,
          buildingName: row.buildingName ?? null,
          buildingAcronym: row.buildingAcronym ?? null,
          technicianNeeded: row.technicianNeeded,
          ticketNumber: row.ticket ?? "",
          hasConfirmation: false,
        };
        queueMap.set(row.id, entry);
      }
      if (row.confirmationId !== null) {
        entry.hasConfirmation = true;
      }
    }
    const zendeskQueue = Array.from(queueMap.values())
      .filter((item) => !item.hasConfirmation)
      .slice(0, 6)
      .map(({ hasConfirmation, ...rest }) => rest);

    const yearOptions = monthlyReportYears.map((year) => ({
      label: String(year.year),
      value: String(year.year),
    }));
    const firstYear = monthlyReportYears[0]?.year ?? now.getUTCFullYear();
    const lastYear = monthlyReportYears[monthlyReportYears.length - 1]?.year ?? firstYear;

    const exportReports: ExportReport[] = [
      {
        id: "events-hours-month",
        label: "Events & hours by month",
        description: "Monthly event counts and logged technician hours across your available historical data.",
        format: "multiYearMonth",
        years: monthlyReportYears,
        parameters:
          yearOptions.length > 0
            ? [
                {
                  id: "startYear",
                  label: "Start year",
                  type: "select",
                  options: yearOptions,
                  defaultValue: String(firstYear),
                  helper: "Choose the earliest year to include.",
                },
                {
                  id: "endYear",
                  label: "End year",
                  type: "select",
                  options: yearOptions,
                  defaultValue: String(lastYear),
                  helper: "Choose the latest year to include.",
                },
              ]
            : undefined,
      },
      {
        id: "building-utilization",
        label: "Building utilization (last 60 days)",
        description: "Events, technician coverage, and staffed hours per building within the reporting window.",
        format: "simpleTable",
        columns: ["Building", "Events", "Technician Events", "Staffed Hours"],
        rows: buildingStatsList.map((entry) => [
          entry.buildingName && entry.buildingAcronym
            ? `${entry.buildingAcronym} - ${entry.buildingName}`
            : entry.buildingName ?? entry.buildingAcronym ?? "Unassigned",
          entry.eventCount,
          entry.technicianEvents,
          entry.staffedHours,
        ]),
        parameters: [
          {
            id: "limit",
            label: "Max rows",
            type: "number",
            min: 1,
            max: Math.max(buildingStatsList.length, 1),
            defaultValue: Math.min(10, Math.max(buildingStatsList.length, 1)),
            helper: "Control how many buildings are included.",
          },
          {
            id: "includeUnassigned",
            label: "Include unassigned locations",
            type: "toggle",
            defaultValue: true,
          },
        ],
      },
      {
        id: "department-hours",
        label: "Department hours (last 60 days)",
        description: "Total staffed hours by department for the current reporting window.",
        format: "simpleTable",
        columns: ["Department", "Hours Logged"],
        rows: departmentHoursList.map((dept) => [dept.departmentName, dept.hours]),
        parameters: [
          {
            id: "minHours",
            label: "Minimum hours",
            type: "number",
            min: 0,
            step: 0.5,
            defaultValue: 0,
            helper: "Hide departments below this threshold.",
          },
        ],
      },
      {
        id: "request-mix",
        label: "Request mix (last 60 days)",
        description: "Distribution of event request categories for the reporting period.",
        format: "simpleTable",
        columns: ["Category", "Events", "Percent"],
        rows: requestCategories.map((category) => [category.label, category.value, `${category.percent}%`]),
        parameters: [
          {
            id: "minPercent",
            label: "Minimum share",
            type: "number",
            min: 0,
            max: 100,
            step: 1,
            defaultValue: 0,
            suffix: "%",
            helper: "Filter categories by percentage of total events.",
          },
          {
            id: "sortBy",
            label: "Sort order",
            type: "select",
            options: [
              { label: "Largest share", value: "value" },
              { label: "Alphabetical", value: "alpha" },
            ],
            defaultValue: "value",
          },
        ],
      },
    ];

    return {
      window: {
        start: windowStart,
        end: now,
        days: REPORT_WINDOW_DAYS,
      },
      summary: {
        totalEvents,
        staffedHours: minutesToHours(totalMinutes),
        avgParticipants,
        zendesk: {
          ticketed: ticketedEventIds.length,
          confirmed: confirmedTicketCount,
          awaiting: awaitingTicketCount,
          coveragePercent: ticketedEventIds.length === 0 ? 0 : Math.round((confirmedTicketCount / ticketedEventIds.length) * 100),
        },
        technician: {
          needed: technicianEvents.length,
          ticketed: technicianTicketed,
          confirmed: technicianConfirmed,
          withoutTicket: technicianWithoutTicket,
          awaitingConfirmation: Math.max(technicianAwaitingConfirmation, 0),
          readyPercent: technicianEvents.length === 0 ? 100 : Math.round((technicianConfirmed / technicianEvents.length) * 100),
        },
      },
      breakdowns: {
        eventsByBuilding,
        requestCategories,
        hoursByDepartment,
      },
      zendeskQueue,
      exportReports,
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
