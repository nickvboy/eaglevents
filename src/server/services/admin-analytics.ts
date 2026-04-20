import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as dbClient } from "~/server/db";
import {
  buildings,
  calendars,
  eventAttendees,
  eventRooms,
  events,
  profiles,
  rooms,
  users,
} from "~/server/db/schema";
import {
  createEventDateTimeAliases,
  hydrateEventRecord,
} from "~/server/services/date-time";
import {
  EVENT_TYPE_OPTIONS,
  toEventRequestFormState,
} from "~/types/event-request";

type DbClient = typeof dbClient;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const REQUEST_CATEGORY_LABELS = {
  university_affiliated_request_to_university_business:
    "University business requests",
  university_affiliated_nonrequest_to_university_business:
    "Affiliated events without request",
  fgcu_student_affiliated_event: "FGCU student affiliated",
  non_affiliated_or_revenue_generating_event: "External or revenue events",
} as const;

export const analyticsRangePresetValues = ["1M", "3M", "6M", "YTD", "12M", "custom"] as const;
export const analyticsFrequencyValues = ["auto", "day", "week", "month", "quarter"] as const;
export const analyticsMetricValues = ["eventCount", "scheduledHours", "participants", "overlapHours"] as const;
export const analyticsDurationMetricValues = ["scheduled", "program", "setupLead"] as const;
export const analyticsLocationLevelValues = ["building", "room"] as const;
export const analyticsRequesterSourceValues = ["owner_profile", "calendar_owner", "scope"] as const;
export const analyticsOverlapLevelValues = ["system", "building", "room"] as const;
export const analyticsLocationModeValues = ["all", "physical", "virtual"] as const;

export type AnalyticsRangePreset = (typeof analyticsRangePresetValues)[number];
export type AnalyticsFrequency = (typeof analyticsFrequencyValues)[number];
export type AnalyticsMetric = (typeof analyticsMetricValues)[number];
export type AnalyticsDurationMetric = (typeof analyticsDurationMetricValues)[number];
export type AnalyticsLocationLevel = (typeof analyticsLocationLevelValues)[number];
export type AnalyticsRequesterSource = (typeof analyticsRequesterSourceValues)[number];
export type AnalyticsOverlapLevel = (typeof analyticsOverlapLevelValues)[number];
export type AnalyticsLocationMode = (typeof analyticsLocationModeValues)[number];

export type AnalyticsGlobalFilters = {
  rangePreset: AnalyticsRangePreset;
  customStart: Date | null;
  customEnd: Date | null;
  frequency: AnalyticsFrequency;
  buildingIds: number[];
  roomIds: number[];
  eventTypes: string[];
  requestCategories: string[];
  requesterKeys: string[];
  locationMode: AnalyticsLocationMode;
  includeAllDay: boolean;
};

export type AnalyticsSeriesPoint = {
  bucketKey: string;
  bucketLabel: string;
  bucketStart: Date;
  bucketEnd: Date;
  value: number;
  compareValue?: number | null;
};

export type AnalyticsCompositionValue = {
  key: string;
  label: string;
  value: number;
};

export type AnalyticsCompositionPoint = {
  bucketKey: string;
  bucketLabel: string;
  bucketStart: Date;
  bucketEnd: Date;
  values: AnalyticsCompositionValue[];
};

export type AnalyticsRankedDatum = {
  key: string;
  label: string;
  value: number;
  secondaryValue?: number | null;
  share?: number | null;
  coverage?: number | null;
};

export type AnalyticsHeatmapCell = {
  xKey: string;
  xLabel: string;
  yKey: string;
  yLabel: string;
  value: number;
};

export type AnalyticsCalendarCell = {
  dateKey: string;
  label: string;
  date: Date;
  value: number;
};

export type AnalyticsBoxPlotDatum = {
  key: string;
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
};

export type AnalyticsTimelineLane = {
  lane: number;
  eventId: number;
  title: string;
  start: Date;
  end: Date;
  buildingLabel: string | null;
  roomLabels: string[];
};

export type AnalyticsKpi = {
  id: string;
  label: string;
  value: number;
  helper?: string;
  suffix?: string;
};

export type AnalyticsCoverageSummary = {
  totalEvents: number;
  participantCountCoveragePercent: number;
  eventTypeCoveragePercent: number;
  ownerRequesterCoveragePercent: number;
};

type TimeBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

type AnalyticsRoomEntity = {
  roomId: number;
  roomLabel: string;
  buildingId: number;
  buildingLabel: string;
};

type AnalyticsBuildingEntity = {
  buildingId: number;
  buildingLabel: string;
};

type AnalyticsAttendeeEntity = {
  attendeeKey: string;
  attendeeLabel: string;
  profileId: number | null;
  email: string;
};

export type AnalyticsEventFact = {
  id: number;
  title: string;
  start: Date;
  end: Date;
  eventStartTime: Date | null;
  eventEndTime: Date | null;
  setupTime: Date | null;
  buildingId: number | null;
  buildingLabel: string | null;
  roomEntities: AnalyticsRoomEntity[];
  buildingEntities: AnalyticsBuildingEntity[];
  calendarId: number;
  calendarName: string;
  calendarOwnerUserId: number | null;
  calendarOwnerLabel: string | null;
  ownerProfileId: number | null;
  ownerProfileLabel: string | null;
  assigneeProfileId: number | null;
  assigneeProfileLabel: string | null;
  scopeType: typeof events.$inferSelect["scopeType"];
  scopeId: number;
  isVirtual: boolean;
  isAllDay: boolean;
  participantCount: number | null;
  technicianNeeded: boolean;
  requestCategory: typeof events.$inferSelect["requestCategory"];
  requestCategoryLabel: string;
  eventTypes: string[];
  hasEventTypes: boolean;
  requesterKey: string;
  requesterLabel: string;
  requesterSource: AnalyticsRequesterSource;
  attendees: AnalyticsAttendeeEntity[];
  scheduledHours: number;
  programHours: number | null;
  setupLeadHours: number | null;
};

type OverlapSegment = {
  start: Date;
  end: Date;
  count: number;
};

function roundNumber(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, amount: number) {
  return new Date(date.getTime() + amount * DAY_MS);
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return startOfUtcDay(addUtcDays(date, offset));
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfUtcQuarter(date: Date) {
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterMonth, 1));
}

function addUtcMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function addUtcQuarters(date: Date, amount: number) {
  return addUtcMonths(date, amount * 3);
}

function formatBucketLabel(start: Date, frequency: Exclude<AnalyticsFrequency, "auto">) {
  if (frequency === "day" || frequency === "week") {
    return `${MONTH_LABELS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  }
  if (frequency === "month") {
    return `${MONTH_LABELS[start.getUTCMonth()]} ${String(start.getUTCFullYear()).slice(-2)}`;
  }
  const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
  return `Q${quarter} ${start.getUTCFullYear()}`;
}

function bucketKeyForDate(date: Date, frequency: Exclude<AnalyticsFrequency, "auto">) {
  if (frequency === "day") return startOfUtcDay(date).toISOString();
  if (frequency === "week") return startOfUtcWeek(date).toISOString();
  if (frequency === "month") return startOfUtcMonth(date).toISOString();
  return startOfUtcQuarter(date).toISOString();
}

function toPercent(value: number, total: number) {
  if (total <= 0) return 0;
  return roundNumber((value / total) * 100, 1);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatName(firstName: string | null, lastName: string | null) {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ").trim();
}

function formatBuildingLabel(name: string | null, acronym: string | null) {
  if (acronym && name) return `${acronym} - ${name}`;
  return name ?? acronym ?? "Unassigned location";
}

function formatRoomLabel(roomNumber: string, buildingName: string | null, buildingAcronym: string | null) {
  const buildingLabel = formatBuildingLabel(buildingName, buildingAcronym);
  return `${buildingLabel} · Room ${roomNumber}`;
}

function getRequestCategoryLabel(value: typeof events.$inferSelect["requestCategory"]) {
  if (!value) return "Unspecified category";
  return REQUEST_CATEGORY_LABELS[value] ?? value;
}

export function defaultAnalyticsFilters(): AnalyticsGlobalFilters {
  return {
    rangePreset: "12M",
    customStart: null,
    customEnd: null,
    frequency: "auto",
    buildingIds: [],
    roomIds: [],
    eventTypes: [],
    requestCategories: [],
    requesterKeys: [],
    locationMode: "all",
    includeAllDay: true,
  };
}

export function resolveAnalyticsDateRange(filters: AnalyticsGlobalFilters, now = new Date()) {
  const end = new Date(now.getTime());
  if (filters.rangePreset === "custom") {
    if (!filters.customStart || !filters.customEnd) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Custom analytics ranges require both a start and end date.",
      });
    }
    const start = startOfUtcDay(filters.customStart);
    const exclusiveEnd = addUtcDays(startOfUtcDay(filters.customEnd), 1);
    if (exclusiveEnd <= start) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Analytics range end must be after the start date.",
      });
    }
    return { start, end: exclusiveEnd };
  }

  if (filters.rangePreset === "YTD") {
    return { start: new Date(Date.UTC(end.getUTCFullYear(), 0, 1)), end };
  }

  const months = filters.rangePreset === "1M" ? 1 : filters.rangePreset === "3M" ? 3 : filters.rangePreset === "6M" ? 6 : 12;
  return {
    start: addUtcMonths(startOfUtcMonth(end), -months + 1),
    end,
  };
}

export function resolveAnalyticsFrequency(filters: AnalyticsGlobalFilters, start: Date, end: Date): Exclude<AnalyticsFrequency, "auto"> {
  if (filters.frequency !== "auto") return filters.frequency;
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
  if (days <= 62) return "day";
  if (days <= 180) return "week";
  if (days <= 730) return "month";
  return "quarter";
}

export function buildTimeBuckets(start: Date, end: Date, frequency: Exclude<AnalyticsFrequency, "auto">): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  let cursor =
    frequency === "day"
      ? startOfUtcDay(start)
      : frequency === "week"
        ? startOfUtcWeek(start)
        : frequency === "month"
          ? startOfUtcMonth(start)
          : startOfUtcQuarter(start);

  while (cursor < end) {
    const next =
      frequency === "day"
        ? addUtcDays(cursor, 1)
        : frequency === "week"
          ? addUtcDays(cursor, 7)
          : frequency === "month"
            ? addUtcMonths(cursor, 1)
            : addUtcQuarters(cursor, 1);
    buckets.push({
      key: cursor.toISOString(),
      label: formatBucketLabel(cursor, frequency),
      start: cursor,
      end: next,
    });
    cursor = next;
  }
  return buckets;
}

function bucketForDate(date: Date, buckets: TimeBucket[], frequency: Exclude<AnalyticsFrequency, "auto">) {
  const key = bucketKeyForDate(date, frequency);
  return buckets.find((bucket) => bucket.key === key) ?? null;
}

function getMetricValue(row: AnalyticsEventFact, metric: Exclude<AnalyticsMetric, "overlapHours">) {
  if (metric === "eventCount") return 1;
  if (metric === "scheduledHours") return row.scheduledHours;
  return row.participantCount ?? 0;
}

function getDurationValue(row: AnalyticsEventFact, metric: AnalyticsDurationMetric) {
  if (metric === "scheduled") return row.scheduledHours;
  if (metric === "program") return row.programHours;
  return row.setupLeadHours;
}

function percentile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;
  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower] ?? 0;
  const lowerValue = sortedValues[lower] ?? 0;
  const upperValue = sortedValues[upper] ?? 0;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

function normalizeWeightList(values: Array<{ key: string; label: string }>) {
  if (values.length === 0) return [];
  const weight = 1 / values.length;
  return values.map((value) => ({ ...value, weight }));
}

function hourlySegmentsForRange(start: Date, end: Date) {
  const segments: Array<{ hour: number; weekday: number; durationHours: number }> = [];
  let cursor = new Date(start.getTime());
  while (cursor < end) {
    const nextHour = new Date(
      Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate(),
        cursor.getUTCHours() + 1,
        0,
        0,
        0,
      ),
    );
    const segmentEnd = nextHour < end ? nextHour : end;
    const weekday = ((cursor.getUTCDay() + 6) % 7) + 1;
    segments.push({
      hour: cursor.getUTCHours(),
      weekday,
      durationHours: (segmentEnd.getTime() - cursor.getTime()) / HOUR_MS,
    });
    cursor = segmentEnd;
  }
  return segments;
}

function eventPeakDayKey(rows: AnalyticsEventFact[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dateKey(row.start);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey: string | null = null;
  let bestValue = -1;
  for (const [key, value] of counts) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestKey;
}

export function computeRequesterProxy(row: {
  ownerProfileId: number | null;
  ownerProfileLabel: string | null;
  calendarOwnerUserId: number | null;
  calendarOwnerLabel: string | null;
  scopeType: typeof events.$inferSelect["scopeType"];
  scopeId: number;
}) {
  if (row.ownerProfileId) {
    return {
      requesterKey: `owner_profile:${row.ownerProfileId}`,
      requesterLabel: row.ownerProfileLabel ?? `Owner #${row.ownerProfileId}`,
      requesterSource: "owner_profile" as const,
    };
  }
  if (row.calendarOwnerUserId) {
    return {
      requesterKey: `calendar_owner:${row.calendarOwnerUserId}`,
      requesterLabel: row.calendarOwnerLabel ?? `Calendar owner #${row.calendarOwnerUserId}`,
      requesterSource: "calendar_owner" as const,
    };
  }
  return {
    requesterKey: `scope:${row.scopeType}:${row.scopeId}`,
    requesterLabel: `${row.scopeType} ${row.scopeId}`,
    requesterSource: "scope" as const,
  };
}

export function buildCoverageSummary(rows: AnalyticsEventFact[]): AnalyticsCoverageSummary {
  const totalEvents = rows.length;
  const participantCount = rows.filter((row) => row.participantCount !== null).length;
  const eventTypeCount = rows.filter((row) => row.hasEventTypes).length;
  const ownerCoverage = rows.filter((row) => row.requesterSource === "owner_profile").length;
  return {
    totalEvents,
    participantCountCoveragePercent: toPercent(participantCount, totalEvents),
    eventTypeCoveragePercent: toPercent(eventTypeCount, totalEvents),
    ownerRequesterCoveragePercent: toPercent(ownerCoverage, totalEvents),
  };
}

function computeAttendeeIdentity(row: {
  profileId: number | null;
  email: string;
  profileEmail: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  const resolvedEmail = (row.profileEmail ?? row.email).trim();
  const normalizedEmail = resolvedEmail.toLowerCase();
  const label = formatName(row.firstName, row.lastName) || resolvedEmail;
  return {
    attendeeKey: row.profileId ? `profile:${row.profileId}` : `email:${normalizedEmail}`,
    attendeeLabel: label,
    email: resolvedEmail,
  };
}

export async function loadAnalyticsBaseEvents(db: DbClient, options?: { start?: Date; end?: Date }) {
  const aliases = createEventDateTimeAliases("admin_analytics");
  const ownerProfiles = alias(profiles, "admin_analytics_owner_profiles");
  const assigneeProfiles = alias(profiles, "admin_analytics_assignee_profiles");
  const calendarOwners = alias(users, "admin_analytics_calendar_owners");

  let condition = eq(events.isArchived, false);
  if (options?.start && options?.end) {
    condition =
      and(
        condition,
        lt(aliases.start.instantUtc, options.end),
        gt(aliases.end.instantUtc, options.start),
      ) ?? condition;
  }

  const rows = await db
    .select({
      event: events,
      startDateTime: { instantUtc: aliases.start.instantUtc },
      endDateTime: { instantUtc: aliases.end.instantUtc },
      eventStartDateTime: { instantUtc: aliases.eventStart.instantUtc },
      eventEndDateTime: { instantUtc: aliases.eventEnd.instantUtc },
      setupDateTime: { instantUtc: aliases.setup.instantUtc },
      buildingName: buildings.name,
      buildingAcronym: buildings.acronym,
      calendarName: calendars.name,
      calendarUserId: calendars.userId,
      calendarOwnerDisplayName: calendarOwners.displayName,
      calendarOwnerUsername: calendarOwners.username,
      calendarOwnerEmail: calendarOwners.email,
      ownerFirstName: ownerProfiles.firstName,
      ownerLastName: ownerProfiles.lastName,
      assigneeFirstName: assigneeProfiles.firstName,
      assigneeLastName: assigneeProfiles.lastName,
    })
    .from(events)
    .innerJoin(calendars, eq(events.calendarId, calendars.id))
    .innerJoin(aliases.start, eq(events.startDateTimeId, aliases.start.id))
    .innerJoin(aliases.end, eq(events.endDateTimeId, aliases.end.id))
    .leftJoin(aliases.eventStart, eq(events.eventStartDateTimeId, aliases.eventStart.id))
    .leftJoin(aliases.eventEnd, eq(events.eventEndDateTimeId, aliases.eventEnd.id))
    .leftJoin(aliases.setup, eq(events.setupDateTimeId, aliases.setup.id))
    .leftJoin(buildings, eq(events.buildingId, buildings.id))
    .leftJoin(ownerProfiles, eq(events.ownerProfileId, ownerProfiles.id))
    .leftJoin(assigneeProfiles, eq(events.assigneeProfileId, assigneeProfiles.id))
    .leftJoin(calendarOwners, eq(calendars.userId, calendarOwners.id))
    .where(condition)
    .orderBy(aliases.start.instantUtc);

  const eventIds = rows.map((row) => row.event.id);
  const roomRows =
    eventIds.length === 0
      ? []
      : await db
          .select({
            eventId: eventRooms.eventId,
            roomId: rooms.id,
            roomNumber: rooms.roomNumber,
            buildingId: rooms.buildingId,
            buildingName: buildings.name,
            buildingAcronym: buildings.acronym,
          })
          .from(eventRooms)
          .innerJoin(rooms, eq(eventRooms.roomId, rooms.id))
          .leftJoin(buildings, eq(rooms.buildingId, buildings.id))
          .where(inArray(eventRooms.eventId, eventIds));

  const attendeeRows =
    eventIds.length === 0
      ? []
      : await db
          .select({
            eventId: eventAttendees.eventId,
            profileId: eventAttendees.profileId,
            email: eventAttendees.email,
            profileEmail: profiles.email,
            firstName: profiles.firstName,
            lastName: profiles.lastName,
          })
          .from(eventAttendees)
          .leftJoin(profiles, eq(eventAttendees.profileId, profiles.id))
          .where(inArray(eventAttendees.eventId, eventIds));

  const roomsByEvent = new Map<number, AnalyticsRoomEntity[]>();
  for (const row of roomRows) {
    const list = roomsByEvent.get(row.eventId) ?? [];
    list.push({
      roomId: row.roomId,
      roomLabel: formatRoomLabel(row.roomNumber, row.buildingName, row.buildingAcronym),
      buildingId: row.buildingId,
      buildingLabel: formatBuildingLabel(row.buildingName, row.buildingAcronym),
    });
    roomsByEvent.set(row.eventId, list);
  }

  const attendeesByEvent = new Map<number, AnalyticsAttendeeEntity[]>();
  for (const row of attendeeRows) {
    const identity = computeAttendeeIdentity({
      profileId: row.profileId ?? null,
      email: row.email,
      profileEmail: row.profileEmail,
      firstName: row.firstName,
      lastName: row.lastName,
    });
    const existing = attendeesByEvent.get(row.eventId) ?? [];
    if (!existing.some((entry) => entry.attendeeKey === identity.attendeeKey)) {
      existing.push({
        attendeeKey: identity.attendeeKey,
        attendeeLabel: identity.attendeeLabel,
        profileId: row.profileId ?? null,
        email: identity.email,
      });
      attendeesByEvent.set(row.eventId, existing);
    }
  }

  return rows.map((row) => {
    const hydrated = hydrateEventRecord({
      event: row.event,
      startDateTime: row.startDateTime,
      endDateTime: row.endDateTime,
      eventStartDateTime: row.eventStartDateTime,
      eventEndDateTime: row.eventEndDateTime,
      setupDateTime: row.setupDateTime,
    });
    const requestState = toEventRequestFormState(
      row.event.requestDetails ?? row.event.equipmentNeeded ?? null,
    );
    const selectedEventTypes = Array.from(new Set(requestState.selectedEventTypes));
    const roomEntities = roomsByEvent.get(row.event.id) ?? [];
    const buildingEntities = new Map<number, AnalyticsBuildingEntity>();
    for (const roomEntity of roomEntities) {
      buildingEntities.set(roomEntity.buildingId, {
        buildingId: roomEntity.buildingId,
        buildingLabel: roomEntity.buildingLabel,
      });
    }
    if (buildingEntities.size === 0 && typeof row.event.buildingId === "number") {
      buildingEntities.set(row.event.buildingId, {
        buildingId: row.event.buildingId,
        buildingLabel: formatBuildingLabel(row.buildingName, row.buildingAcronym),
      });
    }
    const ownerProfileLabel =
      formatName(row.ownerFirstName, row.ownerLastName) ||
      (row.event.ownerProfileId ? `Profile #${row.event.ownerProfileId}` : null);
    const assigneeProfileLabel =
      formatName(row.assigneeFirstName, row.assigneeLastName) ||
      (row.event.assigneeProfileId ? `Profile #${row.event.assigneeProfileId}` : null);
    const calendarOwnerLabel =
      row.calendarOwnerDisplayName ??
      row.calendarOwnerUsername ??
      row.calendarOwnerEmail ??
      (row.calendarUserId ? `User #${row.calendarUserId}` : null);
    const requester = computeRequesterProxy({
      ownerProfileId: row.event.ownerProfileId,
      ownerProfileLabel,
      calendarOwnerUserId: row.calendarUserId,
      calendarOwnerLabel,
      scopeType: row.event.scopeType,
      scopeId: row.event.scopeId,
    });

    const scheduledHours = Math.max(
      0,
      (hydrated.endDatetime.getTime() - hydrated.startDatetime.getTime()) / HOUR_MS,
    );
    const programHours =
      hydrated.eventStartTime && hydrated.eventEndTime && hydrated.eventEndTime > hydrated.eventStartTime
        ? (hydrated.eventEndTime.getTime() - hydrated.eventStartTime.getTime()) / HOUR_MS
        : null;
    const setupLeadHours =
      hydrated.setupTime && hydrated.eventStartTime && hydrated.eventStartTime > hydrated.setupTime
        ? (hydrated.eventStartTime.getTime() - hydrated.setupTime.getTime()) / HOUR_MS
        : null;

    return {
      id: row.event.id,
      title: row.event.title,
      start: hydrated.startDatetime,
      end: hydrated.endDatetime,
      eventStartTime: hydrated.eventStartTime,
      eventEndTime: hydrated.eventEndTime,
      setupTime: hydrated.setupTime,
      buildingId: row.event.buildingId ?? null,
      buildingLabel:
        row.event.buildingId !== null
          ? formatBuildingLabel(row.buildingName, row.buildingAcronym)
          : null,
      roomEntities,
      buildingEntities: Array.from(buildingEntities.values()),
      calendarId: row.event.calendarId,
      calendarName: row.calendarName,
      calendarOwnerUserId: row.calendarUserId,
      calendarOwnerLabel,
      ownerProfileId: row.event.ownerProfileId ?? null,
      ownerProfileLabel,
      assigneeProfileId: row.event.assigneeProfileId ?? null,
      assigneeProfileLabel,
      scopeType: row.event.scopeType,
      scopeId: row.event.scopeId,
      isVirtual: row.event.isVirtual,
      isAllDay: row.event.isAllDay,
      participantCount: row.event.participantCount ?? null,
      technicianNeeded: row.event.technicianNeeded,
      requestCategory: row.event.requestCategory ?? null,
      requestCategoryLabel: getRequestCategoryLabel(row.event.requestCategory),
      eventTypes: selectedEventTypes.length > 0 ? selectedEventTypes : ["Uncategorized"],
      hasEventTypes: selectedEventTypes.length > 0,
      requesterKey: requester.requesterKey,
      requesterLabel: requester.requesterLabel,
      requesterSource: requester.requesterSource,
      attendees: attendeesByEvent.get(row.event.id) ?? [],
      scheduledHours,
      programHours,
      setupLeadHours,
    } satisfies AnalyticsEventFact;
  });
}

export function applyAnalyticsFilters(
  rows: AnalyticsEventFact[],
  filters: Omit<AnalyticsGlobalFilters, "rangePreset" | "customStart" | "customEnd" | "frequency">,
) {
  return rows.filter((row) => {
    if (!filters.includeAllDay && row.isAllDay) return false;
    if (filters.locationMode === "physical" && row.isVirtual) return false;
    if (filters.locationMode === "virtual" && !row.isVirtual) return false;
    if (
      filters.buildingIds.length > 0 &&
      !row.buildingEntities.some((building) => filters.buildingIds.includes(building.buildingId))
    ) {
      return false;
    }
    if (
      filters.roomIds.length > 0 &&
      !row.roomEntities.some((room) => filters.roomIds.includes(room.roomId))
    ) {
      return false;
    }
    if (
      filters.eventTypes.length > 0 &&
      !row.eventTypes.some((eventType) => filters.eventTypes.includes(eventType))
    ) {
      return false;
    }
    if (
      filters.requestCategories.length > 0 &&
      !filters.requestCategories.includes(row.requestCategory ?? "")
    ) {
      return false;
    }
    if (
      filters.requesterKeys.length > 0 &&
      !filters.requesterKeys.includes(row.requesterKey)
    ) {
      return false;
    }
    return true;
  });
}

export function aggregateTimeSeries(
  rows: AnalyticsEventFact[],
  metric: Exclude<AnalyticsMetric, "overlapHours">,
  frequency: Exclude<AnalyticsFrequency, "auto">,
  range: { start: Date; end: Date },
) {
  const buckets = buildTimeBuckets(range.start, range.end, frequency);
  const values = new Map<string, number>();
  for (const bucket of buckets) values.set(bucket.key, 0);
  for (const row of rows) {
    const bucket = bucketForDate(row.start, buckets, frequency);
    if (!bucket) continue;
    values.set(bucket.key, (values.get(bucket.key) ?? 0) + getMetricValue(row, metric));
  }
  return buckets.map((bucket) => ({
    bucketKey: bucket.key,
    bucketLabel: bucket.label,
    bucketStart: bucket.start,
    bucketEnd: bucket.end,
    value: roundNumber(values.get(bucket.key) ?? 0, 2),
  }));
}

export function aggregateCalendarHeatmap(rows: AnalyticsEventFact[], range: { start: Date; end: Date }) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dateKey(row.start);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cells: AnalyticsCalendarCell[] = [];
  for (let cursor = startOfUtcDay(range.start); cursor < range.end; cursor = addUtcDays(cursor, 1)) {
    const key = dateKey(cursor);
    cells.push({
      dateKey: key,
      label: `${MONTH_LABELS[cursor.getUTCMonth()]} ${cursor.getUTCDate()}`,
      date: cursor,
      value: counts.get(key) ?? 0,
    });
  }
  return cells;
}

export function aggregateStackedComposition(
  rows: AnalyticsEventFact[],
  dimension: "requestCategory" | "eventType" | "locationMode" | "requester" | "attendee",
  metric: Exclude<AnalyticsMetric, "overlapHours">,
  frequency: Exclude<AnalyticsFrequency, "auto">,
  range: { start: Date; end: Date },
  topN = 5,
) {
  const buckets = buildTimeBuckets(range.start, range.end, frequency);
  const valueMap = new Map<string, Map<string, AnalyticsCompositionValue>>();
  const totals = new Map<string, number>();

  const getWeightedValues = (row: AnalyticsEventFact) => {
    if (dimension === "requestCategory") {
      return [{ key: row.requestCategory ?? "unspecified", label: row.requestCategoryLabel, weight: 1 }];
    }
    if (dimension === "locationMode") {
      return [{ key: row.isVirtual ? "virtual" : "physical", label: row.isVirtual ? "Virtual" : "Physical", weight: 1 }];
    }
    if (dimension === "requester") {
      return [{ key: row.requesterKey, label: row.requesterLabel, weight: 1 }];
    }
    if (dimension === "attendee") {
      return row.attendees.map((attendee) => ({
        key: attendee.attendeeKey,
        label: attendee.attendeeLabel,
        weight: 1,
      }));
    }
    return normalizeWeightList(row.eventTypes.map((eventType) => ({ key: eventType, label: eventType })));
  };

  for (const row of rows) {
    const bucket = bucketForDate(row.start, buckets, frequency);
    if (!bucket) continue;
    const bucketMap = valueMap.get(bucket.key) ?? new Map<string, AnalyticsCompositionValue>();
    for (const value of getWeightedValues(row)) {
      const current = bucketMap.get(value.key) ?? { key: value.key, label: value.label, value: 0 };
      current.value += getMetricValue(row, metric) * value.weight;
      bucketMap.set(value.key, current);
      totals.set(value.key, (totals.get(value.key) ?? 0) + getMetricValue(row, metric) * value.weight);
    }
    valueMap.set(bucket.key, bucketMap);
  }

  const allowedKeys = new Set(
    Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([key]) => key),
  );

  return buckets.map((bucket) => ({
    bucketKey: bucket.key,
    bucketLabel: bucket.label,
    bucketStart: bucket.start,
    bucketEnd: bucket.end,
    values: Array.from(valueMap.get(bucket.key)?.values() ?? [])
      .filter((value) => allowedKeys.has(value.key))
      .sort((a, b) => b.value - a.value)
      .map((value) => ({ ...value, value: roundNumber(value.value, 2) })),
  }));
}

type RankedEntityDimension = "building" | "room" | "requester" | "attendee" | "eventType" | "requestCategory";

export function aggregateRanked(
  rows: AnalyticsEventFact[],
  dimension: RankedEntityDimension,
  metric: Exclude<AnalyticsMetric, "overlapHours">,
  topN = 10,
) {
  const totals = new Map<string, AnalyticsRankedDatum>();
  const totalMetric =
    dimension === "attendee"
      ? rows.reduce((sum, row) => sum + getMetricValue(row, metric) * row.attendees.length, 0)
      : rows.reduce((sum, row) => sum + getMetricValue(row, metric), 0);

  for (const row of rows) {
    let values: Array<{ key: string; label: string; weight: number }> = [];
    if (dimension === "building") {
      values = row.buildingEntities.map((entry) => ({ key: String(entry.buildingId), label: entry.buildingLabel, weight: 1 }));
    } else if (dimension === "room") {
      values = row.roomEntities.map((entry) => ({ key: String(entry.roomId), label: entry.roomLabel, weight: 1 }));
    } else if (dimension === "requester") {
      values = [{ key: row.requesterKey, label: row.requesterLabel, weight: 1 }];
    } else if (dimension === "attendee") {
      values = row.attendees.map((entry) => ({ key: entry.attendeeKey, label: entry.attendeeLabel, weight: 1 }));
    } else if (dimension === "requestCategory") {
      values = [{ key: row.requestCategory ?? "unspecified", label: row.requestCategoryLabel, weight: 1 }];
    } else {
      values = normalizeWeightList(row.eventTypes.map((eventType) => ({ key: eventType, label: eventType })));
    }

    for (const value of values) {
      const current = totals.get(value.key) ?? { key: value.key, label: value.label, value: 0 };
      current.value += getMetricValue(row, metric) * value.weight;
      totals.set(value.key, current);
    }
  }

  return Array.from(totals.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, topN)
    .map((entry) => ({
      ...entry,
      value: roundNumber(entry.value, 2),
      share: toPercent(entry.value, totalMetric),
    }));
}

export function aggregateWeekdayHourHeatmap(rows: AnalyticsEventFact[], mode: "starts" | "active") {
  const cells = new Map<string, AnalyticsHeatmapCell>();
  const putCell = (weekday: number, hour: number, amount: number) => {
    const xKey = String(hour);
    const yKey = String(weekday);
    const key = `${xKey}:${yKey}`;
    const current = cells.get(key) ?? {
      xKey,
      xLabel: `${String(hour).padStart(2, "0")}:00`,
      yKey,
      yLabel: WEEKDAY_LABELS[weekday - 1] ?? yKey,
      value: 0,
    };
    current.value += amount;
    cells.set(key, current);
  };

  for (const row of rows) {
    if (mode === "starts") {
      const weekday = ((row.start.getUTCDay() + 6) % 7) + 1;
      putCell(weekday, row.start.getUTCHours(), 1);
      continue;
    }
    for (const segment of hourlySegmentsForRange(row.start, row.end)) {
      putCell(segment.weekday, segment.hour, segment.durationHours);
    }
  }

  return Array.from(cells.values())
    .sort((a, b) => Number(a.yKey) - Number(b.yKey) || Number(a.xKey) - Number(b.xKey))
    .map((cell) => ({ ...cell, value: roundNumber(cell.value, 2) }));
}

function buildSweepSegments(rows: AnalyticsEventFact[]) {
  const markers = rows.flatMap((row) => [
    { time: row.start, delta: 1 },
    { time: row.end, delta: -1 },
  ]);
  markers.sort((a, b) => a.time.getTime() - b.time.getTime() || a.delta - b.delta);

  const segments: OverlapSegment[] = [];
  let active = 0;
  for (let index = 0; index < markers.length - 1; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    if (!marker || !next) continue;
    active += marker.delta;
    if (next.time <= marker.time) continue;
    if (active <= 0) continue;
    segments.push({
      start: marker.time,
      end: next.time,
      count: active,
    });
  }
  return segments;
}

function overlapHoursFromSegments(segments: OverlapSegment[]) {
  return segments.reduce((sum, segment) => {
    if (segment.count <= 1) return sum;
    return sum + (segment.end.getTime() - segment.start.getTime()) / HOUR_MS;
  }, 0);
}

export function computeOverlapStats(rows: AnalyticsEventFact[], level: AnalyticsOverlapLevel, entityId?: number | null) {
  const scopedRows =
    level === "building" && entityId
      ? rows.filter((row) => row.buildingEntities.some((building) => building.buildingId === entityId))
      : level === "room" && entityId
        ? rows.filter((row) => row.roomEntities.some((room) => room.roomId === entityId))
        : rows;

  const segments = buildSweepSegments(scopedRows);
  const totalActiveHours = segments.reduce(
    (sum, segment) => sum + ((segment.end.getTime() - segment.start.getTime()) / HOUR_MS) * segment.count,
    0,
  );
  const activeWindowHours = segments.reduce(
    (sum, segment) => sum + (segment.end.getTime() - segment.start.getTime()) / HOUR_MS,
    0,
  );
  const peakConcurrent = segments.reduce((max, segment) => Math.max(max, segment.count), 0);
  const averageConcurrency = activeWindowHours > 0 ? totalActiveHours / activeWindowHours : 0;
  const overlapHours = overlapHoursFromSegments(segments);
  const busiest =
    segments
      .filter((segment) => segment.count === peakConcurrent)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;

  return {
    rows: scopedRows,
    segments,
    peakConcurrent,
    averageConcurrency: roundNumber(averageConcurrency, 2),
    overlapHours: roundNumber(overlapHours, 2),
    busiestOverlapWindow: busiest
      ? { start: busiest.start, end: busiest.end, count: busiest.count }
      : null,
  };
}

function filterRowsByLocationLevel(rows: AnalyticsEventFact[], level: AnalyticsLocationLevel, entityId: number) {
  if (level === "building") {
    return rows.filter((row) => row.buildingEntities.some((building) => building.buildingId === entityId));
  }
  return rows.filter((row) => row.roomEntities.some((room) => room.roomId === entityId));
}

export function buildTimelineLanes(rows: AnalyticsEventFact[]) {
  const sorted = rows
    .slice()
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
  const laneEnds: Date[] = [];
  const lanes: AnalyticsTimelineLane[] = [];

  for (const row of sorted) {
    let lane = 0;
    while (lane < laneEnds.length && (laneEnds[lane]?.getTime() ?? 0) > row.start.getTime()) {
      lane += 1;
    }
    laneEnds[lane] = row.end;
    lanes.push({
      lane,
      eventId: row.id,
      title: row.title,
      start: row.start,
      end: row.end,
      buildingLabel: row.buildingLabel,
      roomLabels: row.roomEntities.map((room) => room.roomLabel),
    });
  }

  return lanes;
}

function buildHistogram(values: number[], bins: number) {
  if (values.length === 0) return [];
  const safeBins = Math.max(1, bins);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const binSize = span / safeBins;
  const counts = Array.from({ length: safeBins }, () => 0);
  for (const value of values) {
    const index = Math.min(safeBins - 1, Math.floor((value - min) / binSize));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts.map((count, index) => ({
    key: `bin-${index}`,
    label: `${roundNumber(min + index * binSize, 1)}-${roundNumber(min + (index + 1) * binSize, 1)}h`,
    value: count,
  }));
}

export function computeDurationStats(rows: AnalyticsEventFact[], durationMetric: AnalyticsDurationMetric) {
  const values = rows
    .map((row) => getDurationValue(row, durationMetric))
    .filter((value): value is number => typeof value === "number" && value >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) {
    return { count: 0, median: 0, p90: 0, average: 0, min: 0, max: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    median: roundNumber(percentile(values, 0.5), 2),
    p90: roundNumber(percentile(values, 0.9), 2),
    average: roundNumber(total / values.length, 2),
    min: roundNumber(values[0] ?? 0, 2),
    max: roundNumber(values[values.length - 1] ?? 0, 2),
  };
}

export function computeBoxPlots(
  rows: AnalyticsEventFact[],
  durationMetric: AnalyticsDurationMetric,
  breakoutBy: "eventType" | "building" | "requester",
) {
  const groups = new Map<string, { label: string; values: number[] }>();
  for (const row of rows) {
    const duration = getDurationValue(row, durationMetric);
    if (duration === null || duration < 0) continue;
    const entries =
      breakoutBy === "eventType"
        ? normalizeWeightList(row.eventTypes.map((eventType) => ({ key: eventType, label: eventType })))
        : breakoutBy === "building"
          ? row.buildingEntities.map((building) => ({ key: String(building.buildingId), label: building.buildingLabel, weight: 1 }))
          : [{ key: row.requesterKey, label: row.requesterLabel, weight: 1 }];

    for (const entry of entries) {
      const group = groups.get(entry.key) ?? { label: entry.label, values: [] };
      group.values.push(duration);
      groups.set(entry.key, group);
    }
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const sorted = group.values.slice().sort((a, b) => a - b);
      if (sorted.length === 0) return null;
      const q1 = percentile(sorted, 0.25);
      const q3 = percentile(sorted, 0.75);
      const med = percentile(sorted, 0.5);
      const iqr = q3 - q1;
      const lowerFence = q1 - iqr * 1.5;
      const upperFence = q3 + iqr * 1.5;
      const inRange = sorted.filter((value) => value >= lowerFence && value <= upperFence);
      return {
        key,
        label: group.label,
        min: roundNumber(inRange[0] ?? sorted[0] ?? 0, 2),
        q1: roundNumber(q1, 2),
        median: roundNumber(med, 2),
        q3: roundNumber(q3, 2),
        max: roundNumber(inRange[inRange.length - 1] ?? sorted[sorted.length - 1] ?? 0, 2),
        outliers: sorted
          .filter((value) => value < lowerFence || value > upperFence)
          .map((value) => roundNumber(value, 2)),
      } satisfies AnalyticsBoxPlotDatum;
    })
    .filter((value): value is AnalyticsBoxPlotDatum => value !== null)
    .sort((a, b) => b.median - a.median)
    .slice(0, 10);
}

function compositionToFlatRows(points: AnalyticsCompositionPoint[]) {
  const keys = Array.from(new Set(points.flatMap((point) => point.values.map((value) => value.key))));
  return points.map((point) => {
    const row: Record<string, number | string | Date> = {
      bucketKey: point.bucketKey,
      bucketLabel: point.bucketLabel,
      bucketStart: point.bucketStart,
      bucketEnd: point.bucketEnd,
    };
    for (const key of keys) row[key] = 0;
    for (const value of point.values) row[value.key] = roundNumber(value.value, 2);
    return row;
  });
}

function topBuildingsUsed(rows: AnalyticsEventFact[]) {
  const used = new Set<number>();
  for (const row of rows) {
    for (const building of row.buildingEntities) used.add(building.buildingId);
  }
  return used.size;
}

function splitSeries(rows: AnalyticsEventFact[], range: { start: Date; end: Date }, frequency: Exclude<AnalyticsFrequency, "auto">) {
  return {
    virtual: aggregateTimeSeries(rows.filter((row) => row.isVirtual), "eventCount", frequency, range),
    physical: aggregateTimeSeries(rows.filter((row) => !row.isVirtual), "eventCount", frequency, range),
    allDay: aggregateTimeSeries(rows.filter((row) => row.isAllDay), "eventCount", frequency, range),
    timed: aggregateTimeSeries(rows.filter((row) => !row.isAllDay), "eventCount", frequency, range),
  };
}

function buildDailyPeakConcurrencySeries(segments: OverlapSegment[], range: { start: Date; end: Date }, frequency: Exclude<AnalyticsFrequency, "auto">) {
  const buckets = buildTimeBuckets(range.start, range.end, frequency);
  const maxValues = new Map<string, number>();
  for (const bucket of buckets) maxValues.set(bucket.key, 0);
  for (const segment of segments) {
    for (const bucket of buckets) {
      if (segment.end <= bucket.start || segment.start >= bucket.end) continue;
      maxValues.set(bucket.key, Math.max(maxValues.get(bucket.key) ?? 0, segment.count));
    }
  }
  return buckets.map((bucket) => ({
    bucketKey: bucket.key,
    bucketLabel: bucket.label,
    bucketStart: bucket.start,
    bucketEnd: bucket.end,
    value: maxValues.get(bucket.key) ?? 0,
  }));
}

function buildConcurrencyHeatmap(segments: OverlapSegment[]) {
  const map = new Map<string, AnalyticsHeatmapCell>();
  const put = (weekday: number, hour: number, value: number) => {
    const key = `${weekday}:${hour}`;
    const current = map.get(key) ?? {
      xKey: String(hour),
      xLabel: `${String(hour).padStart(2, "0")}:00`,
      yKey: String(weekday),
      yLabel: WEEKDAY_LABELS[weekday - 1] ?? String(weekday),
      value: 0,
    };
    current.value += value;
    map.set(key, current);
  };
  for (const segment of segments) {
    if (segment.count <= 0) continue;
    for (const hourSegment of hourlySegmentsForRange(segment.start, segment.end)) {
      put(hourSegment.weekday, hourSegment.hour, hourSegment.durationHours * segment.count);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => Number(a.yKey) - Number(b.yKey) || Number(a.xKey) - Number(b.xKey))
    .map((cell) => ({ ...cell, value: roundNumber(cell.value, 2) }));
}

function buildOverlapDurationDistribution(segments: OverlapSegment[]) {
  return buildHistogram(
    segments
      .filter((segment) => segment.count > 1)
      .map((segment) => (segment.end.getTime() - segment.start.getTime()) / HOUR_MS),
    10,
  );
}

function uniqueSortedOptions<T extends { value: string | number; label: string }>(rows: T[]) {
  return rows
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, "en-US", { sensitivity: "base" }));
}

export async function getAnalyticsMeta(db: DbClient) {
  const rows = await loadAnalyticsBaseEvents(db);
  const buildingMap = new Map<number, { value: number; label: string }>();
  const roomMap = new Map<number, { value: number; label: string; buildingId: number }>();
  const requesterMap = new Map<string, { value: string; label: string; source: AnalyticsRequesterSource }>();
  const eventTypes = new Set<string>();

  for (const row of rows) {
    for (const building of row.buildingEntities) {
      buildingMap.set(building.buildingId, { value: building.buildingId, label: building.buildingLabel });
    }
    for (const room of row.roomEntities) {
      roomMap.set(room.roomId, { value: room.roomId, label: room.roomLabel, buildingId: room.buildingId });
    }
    requesterMap.set(row.requesterKey, {
      value: row.requesterKey,
      label: row.requesterLabel,
      source: row.requesterSource,
    });
    for (const eventType of row.eventTypes) eventTypes.add(eventType);
  }

  return {
    rangePresets: analyticsRangePresetValues,
    frequencyOptions: analyticsFrequencyValues,
    defaults: defaultAnalyticsFilters(),
    buildingOptions: uniqueSortedOptions(Array.from(buildingMap.values())),
    roomOptions: uniqueSortedOptions(Array.from(roomMap.values())),
    requestCategoryOptions: Object.entries(REQUEST_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
    requesterOptions: uniqueSortedOptions(Array.from(requesterMap.values())),
    eventTypeOptions: uniqueSortedOptions(
      Array.from(new Set([...EVENT_TYPE_OPTIONS, ...eventTypes])).map((eventType) => ({
        value: eventType,
        label: eventType,
      })),
    ),
    coverage: buildCoverageSummary(rows),
  };
}

export async function getOverviewAnalytics(db: DbClient, filters: AnalyticsGlobalFilters, topN = 10) {
  const range = resolveAnalyticsDateRange(filters);
  const frequency = resolveAnalyticsFrequency(filters, range.start, range.end);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), filters);
  const overlap = computeOverlapStats(rows, "system");
  return {
    kpis: [
      { id: "events", label: "Total events", value: rows.length },
      { id: "scheduled-hours", label: "Scheduled hours", value: roundNumber(rows.reduce((sum, row) => sum + row.scheduledHours, 0), 1), suffix: "h" },
      { id: "median-duration", label: "Median duration", value: computeDurationStats(rows, "scheduled").median, suffix: "h" },
      { id: "peak-concurrent", label: "Peak concurrent events", value: overlap.peakConcurrent },
      { id: "buildings-used", label: "Distinct buildings used", value: topBuildingsUsed(rows) },
      { id: "virtual-share", label: "% virtual", value: toPercent(rows.filter((row) => row.isVirtual).length, rows.length), suffix: "%" },
    ] satisfies AnalyticsKpi[],
    eventVolumeTrend: aggregateTimeSeries(rows, "eventCount", frequency, range),
    scheduledHoursTrend: aggregateTimeSeries(rows, "scheduledHours", frequency, range),
    requestMixTrend: aggregateStackedComposition(rows, "requestCategory", "eventCount", frequency, range, 4),
    topLocationsByCount: aggregateRanked(rows, "building", "eventCount", topN),
    topLocationsByHours: aggregateRanked(rows, "building", "scheduledHours", topN),
    weekdayHourHeatmap: aggregateWeekdayHourHeatmap(rows, "starts"),
    concurrencyTrend: buildDailyPeakConcurrencySeries(overlap.segments, range, frequency),
    coverage: buildCoverageSummary(rows),
  };
}

export async function getTrendsAnalytics(
  db: DbClient,
  input: {
    filters: AnalyticsGlobalFilters;
    metric: "eventCount" | "scheduledHours";
    composition: "requestCategory" | "eventType" | "locationMode";
    comparePrevious: boolean;
  },
) {
  const range = resolveAnalyticsDateRange(input.filters);
  const frequency = resolveAnalyticsFrequency(input.filters, range.start, range.end);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), input.filters);
  const series = aggregateTimeSeries(rows, input.metric, frequency, range);
  let comparison: AnalyticsSeriesPoint[] = [];
  if (input.comparePrevious) {
    const duration = range.end.getTime() - range.start.getTime();
    const previousRange = { start: new Date(range.start.getTime() - duration), end: new Date(range.end.getTime() - duration) };
    const previousRows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, previousRange), input.filters);
    comparison = aggregateTimeSeries(previousRows, input.metric, frequency, previousRange);
  }
  const totalMetric = rows.reduce((sum, row) => sum + getMetricValue(row, input.metric), 0);
  return {
    kpis: [
      { id: "events", label: "Total events", value: rows.length },
      { id: "hours", label: "Scheduled hours", value: roundNumber(rows.reduce((sum, row) => sum + row.scheduledHours, 0), 1), suffix: "h" },
      { id: "avg-bucket", label: "Average per bucket", value: series.length > 0 ? roundNumber(totalMetric / series.length, 2) : 0 },
      { id: "prior-delta", label: "Prior-period delta", value: input.comparePrevious && comparison.length > 0 ? roundNumber(totalMetric - comparison.reduce((sum, point) => sum + point.value, 0), 2) : 0 },
    ] satisfies AnalyticsKpi[],
    series,
    comparison,
    compositionTrend: aggregateStackedComposition(rows, input.composition, input.metric, frequency, range, 5),
    calendarHeatmap: aggregateCalendarHeatmap(rows, range),
    splitSeries: splitSeries(rows, range, frequency),
    coverage: buildCoverageSummary(rows),
  };
}

export async function getEventTypeAnalytics(
  db: DbClient,
  input: { filters: AnalyticsGlobalFilters; metric: "eventCount" | "scheduledHours"; topN?: number },
) {
  const range = resolveAnalyticsDateRange(input.filters);
  const frequency = resolveAnalyticsFrequency(input.filters, range.start, range.end);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), input.filters);
  const rankedByCount = aggregateRanked(rows, "eventType", "eventCount", input.topN ?? 10);
  const rankedByHours = aggregateRanked(rows, "eventType", "scheduledHours", input.topN ?? 10);
  const coverage = buildCoverageSummary(rows);
  return {
    kpis: [
      { id: "top-type", label: "Top event type", value: rankedByCount[0]?.value ?? 0, helper: rankedByCount[0]?.label ?? "No data" },
      { id: "uncategorized", label: "Uncategorized share", value: toPercent(rows.filter((row) => !row.hasEventTypes).length, rows.length), suffix: "%" },
      { id: "type-diversity", label: "Type diversity", value: new Set(rows.flatMap((row) => row.eventTypes)).size },
      { id: "tech-needed", label: "% tech-required", value: toPercent(rows.filter((row) => row.technicianNeeded).length, rows.length), suffix: "%" },
    ] satisfies AnalyticsKpi[],
    rankedByCount,
    rankedByHours,
    typeShareTrend: aggregateStackedComposition(rows, "eventType", input.metric, frequency, range, 6),
    typeByRequestCategory: aggregateStackedComposition(rows, "requestCategory", input.metric, frequency, range, 4),
    categorizedVsUncategorized: [
      { key: "categorized", label: "Categorized", value: rows.filter((row) => row.hasEventTypes).length },
      { key: "uncategorized", label: "Uncategorized", value: rows.filter((row) => !row.hasEventTypes).length },
    ],
    coverage,
  };
}

function buildLocationOccupancyRows(rows: AnalyticsEventFact[], level: AnalyticsLocationLevel, topN = 10) {
  const groups = new Map<string, { key: string; label: string; durations: number[]; count: number; hours: number }>();
  for (const row of rows) {
    const entries = level === "building"
      ? row.buildingEntities.map((building) => ({ key: String(building.buildingId), label: building.buildingLabel }))
      : row.roomEntities.map((room) => ({ key: String(room.roomId), label: room.roomLabel }));
    for (const entry of entries) {
      const group = groups.get(entry.key) ?? { key: entry.key, label: entry.label, durations: [], count: 0, hours: 0 };
      group.count += 1;
      group.hours += row.scheduledHours;
      group.durations.push(row.scheduledHours);
      groups.set(entry.key, group);
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => b.hours - a.hours)
    .slice(0, topN)
    .map((group) => ({
      key: group.key,
      label: group.label,
      eventCount: group.count,
      scheduledHours: roundNumber(group.hours, 1),
      medianDuration: roundNumber(median(group.durations), 2),
    }));
}

export async function getLocationAnalytics(
  db: DbClient,
  input: { filters: AnalyticsGlobalFilters; level: AnalyticsLocationLevel; metric: "eventCount" | "scheduledHours" | "participants"; topN?: number },
) {
  const range = resolveAnalyticsDateRange(input.filters);
  const frequency = resolveAnalyticsFrequency(input.filters, range.start, range.end);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), input.filters);
  return {
    kpis: [
      { id: "top-building", label: "Top building", value: aggregateRanked(rows, "building", "eventCount", 1)[0]?.value ?? 0, helper: aggregateRanked(rows, "building", "eventCount", 1)[0]?.label ?? "No data" },
      { id: "top-room", label: "Top room", value: aggregateRanked(rows, "room", "eventCount", 1)[0]?.value ?? 0, helper: aggregateRanked(rows, "room", "eventCount", 1)[0]?.label ?? "No data" },
      { id: "distinct-rooms", label: "Distinct rooms used", value: new Set(rows.flatMap((row) => row.roomEntities.map((room) => room.roomId))).size },
      { id: "physical-share", label: "% physical", value: toPercent(rows.filter((row) => !row.isVirtual).length, rows.length), suffix: "%" },
    ] satisfies AnalyticsKpi[],
    rankedLocations: aggregateRanked(rows, input.level, input.metric, input.topN ?? 10),
    locationTrend: aggregateStackedComposition(rows, "requestCategory", input.metric === "participants" ? "eventCount" : input.metric, frequency, range, 4),
    buildingHeatmap: aggregateWeekdayHourHeatmap(rows.filter((row) => !row.isVirtual), "starts"),
    occupancyRows: buildLocationOccupancyRows(rows, input.level, input.topN ?? 10),
    virtualVsPhysical: [
      { key: "physical", label: "Physical", value: rows.filter((row) => !row.isVirtual).length },
      { key: "virtual", label: "Virtual", value: rows.filter((row) => row.isVirtual).length },
    ],
    coverage: buildCoverageSummary(rows),
  };
}

function buildEntityLocationMatrix(rows: AnalyticsEventFact[], dimension: "requester" | "attendee", topN = 8) {
  const topEntities = aggregateRanked(rows, dimension, "eventCount", topN);
  const topBuildings = aggregateRanked(rows, "building", "eventCount", 5);
  const cells: AnalyticsHeatmapCell[] = [];
  for (const entity of topEntities) {
    for (const building of topBuildings) {
      const value = rows.filter(
        (row) =>
          (dimension === "requester"
            ? row.requesterKey === entity.key
            : row.attendees.some((entry) => entry.attendeeKey === entity.key)) &&
          row.buildingEntities.some((entry) => String(entry.buildingId) === building.key),
      ).length;
      cells.push({
        xKey: building.key,
        xLabel: building.label,
        yKey: entity.key,
        yLabel: entity.label,
        value,
      });
    }
  }
  return cells;
}

function buildConcentrationCurve(rows: AnalyticsEventFact[], dimension: "requester" | "attendee", topN = 10) {
  const ranked = aggregateRanked(rows, dimension, "eventCount", topN);
  const total = ranked.reduce((sum, entry) => sum + entry.value, 0);
  let cumulative = 0;
  return ranked.map((entry, index) => {
    cumulative += entry.value;
    return {
      bucketKey: entry.key,
      bucketLabel: `Top ${index + 1}`,
      bucketStart: new Date(0),
      bucketEnd: new Date(0),
      value: total > 0 ? roundNumber((cumulative / total) * 100, 1) : 0,
    } satisfies AnalyticsSeriesPoint;
  });
}

export async function getRequesterAnalytics(
  db: DbClient,
  input: { filters: AnalyticsGlobalFilters; metric: "eventCount" | "scheduledHours" | "participants"; topN?: number },
) {
  const range = resolveAnalyticsDateRange(input.filters);
  const frequency = resolveAnalyticsFrequency(input.filters, range.start, range.end);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), input.filters);
  const topRequesters = aggregateRanked(rows, "requester", input.metric, input.topN ?? 10);
  const topRequester = topRequesters[0] ?? null;
  const sourceCounts = new Map<AnalyticsRequesterSource, number>();
  for (const row of rows) {
    sourceCounts.set(row.requesterSource, (sourceCounts.get(row.requesterSource) ?? 0) + 1);
  }
  const topSource = Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "owner_profile";
  return {
    kpis: [
      { id: "top-requester", label: "Top requester", value: topRequester?.value ?? 0, helper: topRequester?.label ?? "No data" },
      { id: "diversity", label: "Requester diversity", value: new Set(rows.map((row) => row.requesterKey)).size },
      { id: "concentration", label: "Repeat concentration", value: topRequesters.slice(0, 5).reduce((sum, entry) => sum + (entry.share ?? 0), 0), suffix: "%" },
      { id: "top-source", label: "Top requester source", value: sourceCounts.get(topSource) ?? 0, helper: topSource.replaceAll("_", " ") },
    ] satisfies AnalyticsKpi[],
    rankedRequesters: topRequesters,
    requesterShareTrend: aggregateStackedComposition(rows, "requester", input.metric === "participants" ? "eventCount" : input.metric, frequency, range, 5),
    requesterByRequestCategory: aggregateStackedComposition(rows, "requestCategory", input.metric === "participants" ? "eventCount" : input.metric, frequency, range, 4),
    requesterLocationMatrix: buildEntityLocationMatrix(rows, "requester", Math.min(input.topN ?? 10, 8)),
    concentrationCurve: buildConcentrationCurve(rows, "requester", input.topN ?? 10),
    coverage: buildCoverageSummary(rows),
  };
}

export async function getAttendeeAnalytics(
  db: DbClient,
  input: { filters: AnalyticsGlobalFilters; metric: "eventCount" | "scheduledHours" | "participants"; topN?: number },
) {
  const range = resolveAnalyticsDateRange(input.filters);
  const frequency = resolveAnalyticsFrequency(input.filters, range.start, range.end);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), input.filters);
  const topAttendees = aggregateRanked(rows, "attendee", input.metric, input.topN ?? 10);
  const topAttendee = topAttendees[0] ?? null;
  const eventsWithAttendees = rows.filter((row) => row.attendees.length > 0).length;
  const totalParticipants = roundNumber(
    rows.reduce((sum, row) => sum + (row.participantCount ?? 0), 0),
    0,
  );
  return {
    kpis: [
      { id: "top-attendee", label: "Top attendee", value: topAttendee?.value ?? 0, helper: topAttendee?.label ?? "No data" },
      { id: "participants", label: "Total participants", value: totalParticipants },
      { id: "diversity", label: "Attendee diversity", value: new Set(rows.flatMap((row) => row.attendees.map((entry) => entry.attendeeKey))).size },
      { id: "concentration", label: "Repeat concentration", value: topAttendees.slice(0, 5).reduce((sum, entry) => sum + (entry.share ?? 0), 0), suffix: "%" },
      { id: "coverage", label: "Events with attendee records", value: toPercent(eventsWithAttendees, rows.length), suffix: "%" },
    ] satisfies AnalyticsKpi[],
    rankedAttendees: topAttendees,
    attendeeShareTrend: aggregateStackedComposition(rows, "attendee", input.metric === "participants" ? "eventCount" : input.metric, frequency, range, 5),
    attendeeByRequestCategory: aggregateStackedComposition(rows, "requestCategory", input.metric === "participants" ? "eventCount" : input.metric, frequency, range, 4),
    attendeeParticipantShareTrend: aggregateStackedComposition(rows, "attendee", "participants", frequency, range, 5),
    attendeeParticipantsByRequestCategory: aggregateStackedComposition(rows, "requestCategory", "participants", frequency, range, 4),
    attendeeLocationMatrix: buildEntityLocationMatrix(rows, "attendee", Math.min(input.topN ?? 10, 8)),
    concentrationCurve: buildConcentrationCurve(rows, "attendee", input.topN ?? 10),
    coverage: buildCoverageSummary(rows),
  };
}

export async function getDurationAnalytics(
  db: DbClient,
  input: { filters: AnalyticsGlobalFilters; durationMetric: AnalyticsDurationMetric; breakoutBy: "eventType" | "building" | "requester"; histogramBins?: number },
) {
  const range = resolveAnalyticsDateRange(input.filters);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), input.filters);
  const durationRows = rows
    .map((row) => ({ row, duration: getDurationValue(row, input.durationMetric) }))
    .filter((entry): entry is { row: AnalyticsEventFact; duration: number } => entry.duration !== null && entry.duration >= 0);
  const durations = durationRows.map((entry) => entry.duration);
  const durationStats = computeDurationStats(rows, input.durationMetric);
  const scatterCoverage = buildCoverageSummary(rows).participantCountCoveragePercent;
  return {
    kpis: [
      { id: "median", label: "Median duration", value: durationStats.median, suffix: "h" },
      { id: "p90", label: "90th percentile", value: durationStats.p90, suffix: "h" },
      { id: "longest", label: "Longest event", value: durationStats.max, suffix: "h" },
      { id: "avg-setup", label: "Average setup lead", value: computeDurationStats(rows, "setupLead").average, suffix: "h" },
      { id: "avg-program", label: "Average program span", value: computeDurationStats(rows, "program").average, suffix: "h" },
    ] satisfies AnalyticsKpi[],
    histogram: buildHistogram(durations, input.histogramBins ?? 12),
    boxPlot: computeBoxPlots(rows, input.durationMetric, input.breakoutBy),
    scatter:
      scatterCoverage >= 40
        ? durationRows
            .filter((entry) => entry.row.participantCount !== null)
            .slice(0, 250)
            .map((entry) => ({ x: entry.row.participantCount ?? 0, y: roundNumber(entry.duration, 2), label: entry.row.title }))
        : [],
    longestEvents: durationRows
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map((entry) => ({
        id: entry.row.id,
        title: entry.row.title,
        duration: roundNumber(entry.duration, 2),
        start: entry.row.start,
        buildingLabel: entry.row.buildingLabel,
      })),
    coverage: buildCoverageSummary(rows),
  };
}

function buildOverlapRanked(rows: AnalyticsEventFact[], level: AnalyticsLocationLevel, topN = 10) {
  const groups = new Map<number, { label: string; rows: AnalyticsEventFact[] }>();
  for (const row of rows) {
    const entries = level === "building"
      ? row.buildingEntities.map((building) => ({ id: building.buildingId, label: building.buildingLabel }))
      : row.roomEntities.map((room) => ({ id: room.roomId, label: room.roomLabel }));
    for (const entry of entries) {
      const current = groups.get(entry.id) ?? { label: entry.label, rows: [] };
      current.rows.push(row);
      groups.set(entry.id, current);
    }
  }

  return Array.from(groups.entries())
    .map(([id, group]) => ({
      key: String(id),
      label: group.label,
      value: computeOverlapStats(group.rows, "system").overlapHours,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

export async function getOverlapAnalytics(
  db: DbClient,
  input: { filters: AnalyticsGlobalFilters; level: AnalyticsOverlapLevel; entityId?: number | null; selectedDate?: Date | null; topN?: number },
) {
  const range = resolveAnalyticsDateRange(input.filters);
  const frequency = resolveAnalyticsFrequency(input.filters, range.start, range.end);
  const rows = applyAnalyticsFilters(await loadAnalyticsBaseEvents(db, range), input.filters);
  const overlap = computeOverlapStats(rows, input.level, input.entityId);
  const defaultDateKey = eventPeakDayKey(overlap.rows) ?? dateKey(range.start);
  const selectedDay = input.selectedDate ? startOfUtcDay(input.selectedDate) : new Date(`${defaultDateKey}T00:00:00.000Z`);
  const selectedDayEnd = addUtcDays(selectedDay, 1);
  const timelineRows = overlap.rows.filter((row) => row.start < selectedDayEnd && row.end > selectedDay);
  return {
    kpis: [
      { id: "peak", label: "Peak concurrent events", value: overlap.peakConcurrent },
      { id: "average", label: "Average concurrency", value: overlap.averageConcurrency },
      { id: "overlap-hours", label: "Overlap hours", value: overlap.overlapHours, suffix: "h" },
      {
        id: "busiest-window",
        label: "Busiest overlap window",
        value: overlap.busiestOverlapWindow?.count ?? 0,
        helper: overlap.busiestOverlapWindow
          ? `${overlap.busiestOverlapWindow.start.toISOString().slice(0, 16)} - ${overlap.busiestOverlapWindow.end.toISOString().slice(11, 16)}`
          : "No overlap",
      },
      {
        id: "busiest-building",
        label: "Busiest building",
        value: buildOverlapRanked(rows, "building", 1)[0]?.value ?? 0,
        helper: buildOverlapRanked(rows, "building", 1)[0]?.label ?? "No data",
      },
    ] satisfies AnalyticsKpi[],
    concurrencyTrend: buildDailyPeakConcurrencySeries(overlap.segments, range, frequency),
    concurrencyHeatmap: buildConcurrencyHeatmap(overlap.segments),
    overlapRanked: input.level === "building" ? buildOverlapRanked(rows, "room", input.topN ?? 10) : buildOverlapRanked(rows, "building", input.topN ?? 10),
    selectedDate: selectedDay,
    timelineLanes: buildTimelineLanes(
      input.level === "building" && input.entityId
        ? filterRowsByLocationLevel(timelineRows, "building", input.entityId)
        : input.level === "room" && input.entityId
          ? filterRowsByLocationLevel(timelineRows, "room", input.entityId)
          : timelineRows,
    ),
    overlapDurationDistribution: buildOverlapDurationDistribution(overlap.segments),
    coverage: buildCoverageSummary(rows),
  };
}

export function compositionPointsToRows(points: AnalyticsCompositionPoint[]) {
  return compositionToFlatRows(points);
}
