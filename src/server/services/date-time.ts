import { eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as dbClient } from "~/server/db";
import { businesses, dateTimes, events } from "~/server/db/schema";
import {
  DEFAULT_DATE_FORMAT_CONFIG,
  type DateFormatConfig,
} from "~/types/date-time";

type DbClient = typeof dbClient;
type DateTimeRow = typeof dateTimes.$inferSelect;

export const DEFAULT_TIME_ZONE = "UTC";

const MONTH_SHORT_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONTH_LONG_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const WEEKDAY_SHORT_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_LONG_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const FALLBACK_TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

type BusinessDateSettings = {
  timeZone: string;
  formatConfig: DateFormatConfig;
};

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour24: number;
  minute: number;
  second: number;
};

function getFormatter(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function pad(value: number, width = 2) {
  return String(value).padStart(width, "0");
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function makeUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcMonth(year: number, month: number) {
  return makeUtcDate(year, month, 1);
}

function endOfUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0));
}

function startOfUtcQuarter(year: number, quarter: number) {
  return makeUtcDate(year, (quarter - 1) * 3 + 1, 1);
}

function endOfUtcQuarter(year: number, quarter: number) {
  return new Date(Date.UTC(year, quarter * 3, 0));
}

function startOfUtcYear(year: number) {
  return makeUtcDate(year, 1, 1);
}

function endOfUtcYear(year: number) {
  return makeUtcDate(year, 12, 31);
}

function getIsoWeekParts(date: Date) {
  const target = new Date(date.getTime());
  const dayOfWeek = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayOfWeek);
  const isoWeekYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoWeekYear, 0, 1));
  const isoWeek = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { isoWeekYear, isoWeek };
}

function startOfIsoWeek(date: Date) {
  const dayOfWeek = date.getUTCDay() || 7;
  return addUtcDays(date, 1 - dayOfWeek);
}

function getDayOfYear(date: Date) {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - yearStart) / 86400000) + 1;
}

function deriveLocalParts(instantUtc: Date, timeZone: string): LocalDateTimeParts {
  const parts = getFormatter(timeZone).formatToParts(instantUtc);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(partMap.get("year")),
    month: Number(partMap.get("month")),
    day: Number(partMap.get("day")),
    hour24: Number(partMap.get("hour")),
    minute: Number(partMap.get("minute")),
    second: Number(partMap.get("second")),
  };
}

function formatPattern(
  pattern: string,
  values: {
    year: number;
    month: number;
    day: number;
    quarter: number;
    hour24: number;
    minute: number;
    second: number;
    monthName: string;
    monthShortName: string;
    weekdayName: string;
    weekdayShortName: string;
  },
) {
  let result = "";
  for (let index = 0; index < pattern.length; ) {
    if (pattern[index] === "[") {
      const endIndex = pattern.indexOf("]", index + 1);
      if (endIndex >= 0) {
        result += pattern.slice(index + 1, endIndex);
        index = endIndex + 1;
        continue;
      }
    }

    const tokens: Array<[string, string]> = [
      ["YYYY", String(values.year)],
      ["MMMM", values.monthName],
      ["MMM", values.monthShortName],
      ["dddd", values.weekdayName],
      ["ddd", values.weekdayShortName],
      ["MM", pad(values.month)],
      ["DD", pad(values.day)],
      ["HH", pad(values.hour24)],
      ["hh", pad(values.hour24 % 12 === 0 ? 12 : values.hour24 % 12)],
      ["mm", pad(values.minute)],
      ["ss", pad(values.second)],
      ["YY", pad(values.year % 100)],
      ["Q", String(values.quarter)],
      ["M", String(values.month)],
      ["D", String(values.day)],
      ["H", String(values.hour24)],
      ["h", String(values.hour24 % 12 === 0 ? 12 : values.hour24 % 12)],
      ["m", String(values.minute)],
      ["s", String(values.second)],
      ["A", values.hour24 >= 12 ? "PM" : "AM"],
      ["a", values.hour24 >= 12 ? "pm" : "am"],
    ];

    const matchedToken = tokens.find(([token]) => pattern.startsWith(token, index));
    if (matchedToken) {
      result += matchedToken[1];
      index += matchedToken[0].length;
      continue;
    }

    result += pattern[index];
    index += 1;
  }
  return result;
}

export function getSupportedTimeZones() {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supportedValuesOf === "function") {
    try {
      const values = supportedValuesOf("timeZone");
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
    } catch {
      // Fall through.
    }
  }
  return [...FALLBACK_TIME_ZONES];
}

export function assertValidTimeZone(timeZoneRaw: string | null | undefined) {
  const trimmed = (timeZoneRaw ?? DEFAULT_TIME_ZONE).trim();
  const timeZone = trimmed.length > 0 ? trimmed : DEFAULT_TIME_ZONE;
  try {
    void new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    throw new Error("Invalid time zone.");
  }
}

function resolveFormatPattern(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function normalizeDateFormatConfig(config: Partial<DateFormatConfig> | null | undefined): DateFormatConfig {
  return {
    dateKeyPattern: resolveFormatPattern(config?.dateKeyPattern, DEFAULT_DATE_FORMAT_CONFIG.dateKeyPattern),
    isoDatePattern: resolveFormatPattern(config?.isoDatePattern, DEFAULT_DATE_FORMAT_CONFIG.isoDatePattern),
    usDatePattern: resolveFormatPattern(config?.usDatePattern, DEFAULT_DATE_FORMAT_CONFIG.usDatePattern),
    longDatePattern: resolveFormatPattern(config?.longDatePattern, DEFAULT_DATE_FORMAT_CONFIG.longDatePattern),
    monthYearPattern: resolveFormatPattern(config?.monthYearPattern, DEFAULT_DATE_FORMAT_CONFIG.monthYearPattern),
    yearMonthLabelPattern: resolveFormatPattern(
      config?.yearMonthLabelPattern,
      DEFAULT_DATE_FORMAT_CONFIG.yearMonthLabelPattern,
    ),
    yearQuarterLabelPattern: resolveFormatPattern(
      config?.yearQuarterLabelPattern,
      DEFAULT_DATE_FORMAT_CONFIG.yearQuarterLabelPattern,
    ),
    quarterYearLabelPattern: resolveFormatPattern(
      config?.quarterYearLabelPattern,
      DEFAULT_DATE_FORMAT_CONFIG.quarterYearLabelPattern,
    ),
    isoDateTimePattern: resolveFormatPattern(
      config?.isoDateTimePattern,
      DEFAULT_DATE_FORMAT_CONFIG.isoDateTimePattern,
    ),
    usDateTimePattern: resolveFormatPattern(
      config?.usDateTimePattern,
      DEFAULT_DATE_FORMAT_CONFIG.usDateTimePattern,
    ),
  };
}

export async function getBusinessDateSettings(
  db: Pick<DbClient, "select">,
  businessId?: number | null,
): Promise<BusinessDateSettings> {
  const rows =
    typeof businessId === "number"
      ? await db
          .select({
            timeZone: businesses.timeZone,
            dateFormatConfig: businesses.dateFormatConfig,
          })
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .limit(1)
      : await db
          .select({
            timeZone: businesses.timeZone,
            dateFormatConfig: businesses.dateFormatConfig,
          })
          .from(businesses)
          .orderBy(businesses.id)
          .limit(1);

  return {
    timeZone: assertValidTimeZone(rows[0]?.timeZone ?? DEFAULT_TIME_ZONE),
    formatConfig: normalizeDateFormatConfig(rows[0]?.dateFormatConfig ?? DEFAULT_DATE_FORMAT_CONFIG),
  };
}

export function buildDateTimeDimensionValue(instantUtc: Date, settings: BusinessDateSettings) {
  const timeZone = assertValidTimeZone(settings.timeZone);
  const formatConfig = normalizeDateFormatConfig(settings.formatConfig);
  const local = deriveLocalParts(instantUtc, timeZone);
  const fullDate = makeUtcDate(local.year, local.month, local.day);
  const quarter = Math.floor((local.month - 1) / 3) + 1;
  const { isoWeekYear, isoWeek } = getIsoWeekParts(fullDate);
  const weekStartDate = startOfIsoWeek(fullDate);
  const weekEndDate = addUtcDays(weekStartDate, 6);
  const monthStartDate = startOfUtcMonth(local.year, local.month);
  const monthEndDate = endOfUtcMonth(local.year, local.month);
  const quarterStartDate = startOfUtcQuarter(local.year, quarter);
  const quarterEndDate = endOfUtcQuarter(local.year, quarter);
  const yearStartDate = startOfUtcYear(local.year);
  const yearEndDate = endOfUtcYear(local.year);
  const previousDate = addUtcDays(fullDate, -1);
  const nextDate = addUtcDays(fullDate, 1);
  const weekdayNumber = fullDate.getUTCDay() === 0 ? 7 : fullDate.getUTCDay();
  const monthName = MONTH_LONG_NAMES[local.month - 1] ?? MONTH_LONG_NAMES[0];
  const monthShortName = MONTH_SHORT_NAMES[local.month - 1] ?? MONTH_SHORT_NAMES[0];
  const dayOfWeekName = WEEKDAY_LONG_NAMES[weekdayNumber - 1] ?? WEEKDAY_LONG_NAMES[0];
  const dayLabel = WEEKDAY_SHORT_NAMES[weekdayNumber - 1] ?? WEEKDAY_SHORT_NAMES[0];
  const formatValues = {
    year: local.year,
    month: local.month,
    day: local.day,
    quarter,
    hour24: local.hour24,
    minute: local.minute,
    second: local.second,
    monthName,
    monthShortName,
    weekdayName: dayOfWeekName,
    weekdayShortName: dayLabel,
  };

  const dateKey = formatPattern(formatConfig.dateKeyPattern, formatValues);
  const isoDate = formatPattern(formatConfig.isoDatePattern, formatValues);
  const usDate = formatPattern(formatConfig.usDatePattern, formatValues);
  const dateLongFormat = formatPattern(formatConfig.longDatePattern, formatValues);
  const monthYearText = formatPattern(formatConfig.monthYearPattern, formatValues);
  const yearMonthLabel = formatPattern(formatConfig.yearMonthLabelPattern, formatValues);
  const yearQuarterLabel = formatPattern(formatConfig.yearQuarterLabelPattern, formatValues);
  const quarterYearLabel = formatPattern(formatConfig.quarterYearLabelPattern, formatValues);
  const isoDateTime = formatPattern(formatConfig.isoDateTimePattern, formatValues);
  const usDateTime = formatPattern(formatConfig.usDateTimePattern, formatValues);

  return {
    instantUtc,
    timeZone,
    dateKey,
    fullDate: toIsoDate(fullDate),
    calendarDate: toIsoDate(fullDate),
    dayOfWeekNumber: weekdayNumber,
    dayOfWeekName,
    year: local.year,
    quarter,
    month: local.month,
    monthLabel: monthShortName,
    monthName,
    monthShortName,
    isoWeekYear,
    isoWeek,
    isoWeekLabel: `${isoWeekYear}-W${pad(isoWeek)}`,
    dayOfMonth: local.day,
    dayOfYear: getDayOfYear(fullDate),
    weekOfYear: isoWeek,
    dayOfWeekIso: weekdayNumber,
    dayLabel,
    monthNumber: local.month,
    quarterNumber: quarter,
    yearMonthKey: `${local.year}${pad(local.month)}`,
    yearMonthLabel,
    yearQuarterLabel,
    weekStartDate: toIsoDate(weekStartDate),
    weekEndDate: toIsoDate(weekEndDate),
    monthStartDate: toIsoDate(monthStartDate),
    monthEndDate: toIsoDate(monthEndDate),
    quarterStartDate: toIsoDate(quarterStartDate),
    quarterEndDate: toIsoDate(quarterEndDate),
    yearStartDate: toIsoDate(yearStartDate),
    yearEndDate: toIsoDate(yearEndDate),
    isWeekday: weekdayNumber <= 5,
    isWeekend: weekdayNumber >= 6,
    isBusinessDay: weekdayNumber <= 5,
    isMonthStart: local.day === 1,
    isMonthEnd: toIsoDate(fullDate) === toIsoDate(monthEndDate),
    isQuarterStart: toIsoDate(fullDate) === toIsoDate(quarterStartDate),
    isQuarterEnd: toIsoDate(fullDate) === toIsoDate(quarterEndDate),
    isYearStart: local.month === 1 && local.day === 1,
    isYearEnd: local.month === 12 && local.day === 31,
    hour24: local.hour24,
    minute: local.minute,
    second: local.second,
    isoDate,
    isoDateTime,
    usDate,
    usDateTime,
    dateIsoFormat: isoDate,
    dateUsFormat: usDate,
    dateLongFormat,
    monthYearText,
    quarterYearLabel,
    previousDate: toIsoDate(previousDate),
    nextDate: toIsoDate(nextDate),
  };
}

function buildDateTimeKey(timeZone: string, instantUtc: Date) {
  return `${timeZone}|${instantUtc.toISOString()}`;
}

export async function resolveDateTimeIds(
  db: Pick<DbClient, "insert" | "select">,
  settings: BusinessDateSettings,
  values: Array<Date | null | undefined>,
) {
  const distinctInstants = Array.from(
    new Map(
      values
        .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
        .map((value) => [value.toISOString(), value]),
    ).values(),
  );

  if (distinctInstants.length === 0) {
    return {
      timeZone: settings.timeZone,
      byKey: new Map<string, number>(),
      rows: [] as DateTimeRow[],
    };
  }

  await db
    .insert(dateTimes)
    .values(distinctInstants.map((instantUtc) => buildDateTimeDimensionValue(instantUtc, settings)))
    .onConflictDoNothing({
      target: [dateTimes.instantUtc, dateTimes.timeZone],
    });

  const rows = await db
    .select()
    .from(dateTimes)
    .where(inArray(dateTimes.instantUtc, distinctInstants));

  return {
    timeZone: settings.timeZone,
    byKey: new Map(
      rows
        .filter((row) => row.timeZone === settings.timeZone)
        .map((row) => [buildDateTimeKey(row.timeZone, row.instantUtc), row.id]),
    ),
    rows,
  };
}

export function getDateTimeId(
  resolved: Awaited<ReturnType<typeof resolveDateTimeIds>>,
  value: Date | null | undefined,
) {
  if (!value || Number.isNaN(value.getTime())) return null;
  return resolved.byKey.get(buildDateTimeKey(resolved.timeZone, value)) ?? null;
}

export async function loadDateTimesByIds(
  db: Pick<DbClient, "select">,
  ids: number[],
) {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id))));
  if (uniqueIds.length === 0) return [];
  return db.select().from(dateTimes).where(inArray(dateTimes.id, uniqueIds));
}

export const eventStartInstantSql = sql<Date>`(
  select ${dateTimes.instantUtc}
  from ${dateTimes}
  where ${dateTimes.id} = ${events.startDateTimeId}
)`;

export const eventEndInstantSql = sql<Date>`(
  select ${dateTimes.instantUtc}
  from ${dateTimes}
  where ${dateTimes.id} = ${events.endDateTimeId}
)`;

export const eventStartYearSql = sql<number>`(
  select ${dateTimes.year}
  from ${dateTimes}
  where ${dateTimes.id} = ${events.startDateTimeId}
)`;

export const eventStartMonthSql = sql<number>`(
  select ${dateTimes.month}
  from ${dateTimes}
  where ${dateTimes.id} = ${events.startDateTimeId}
)`;

export function createEventDateTimeAliases(prefix = "event") {
  return {
    start: alias(dateTimes, `${prefix}_start_date_time`),
    end: alias(dateTimes, `${prefix}_end_date_time`),
    eventStart: alias(dateTimes, `${prefix}_event_start_date_time`),
    eventEnd: alias(dateTimes, `${prefix}_event_end_date_time`),
    setup: alias(dateTimes, `${prefix}_setup_date_time`),
  };
}

export function hydrateEventRecord<TEvent extends Record<string, unknown>>(row: {
  event: TEvent;
  startDateTime: Pick<DateTimeRow, "instantUtc">;
  endDateTime: Pick<DateTimeRow, "instantUtc">;
  eventStartDateTime: Pick<DateTimeRow, "instantUtc"> | null;
  eventEndDateTime: Pick<DateTimeRow, "instantUtc"> | null;
  setupDateTime: Pick<DateTimeRow, "instantUtc"> | null;
}) {
  return {
    ...row.event,
    startDatetime: row.startDateTime.instantUtc,
    endDatetime: row.endDateTime.instantUtc,
    eventStartTime: row.eventStartDateTime?.instantUtc ?? null,
    eventEndTime: row.eventEndDateTime?.instantUtc ?? null,
    setupTime: row.setupDateTime?.instantUtc ?? null,
  };
}

export async function cleanupOrphanedDateTimes(db: Pick<DbClient, "select" | "delete">) {
  const eventRows = await db
    .select({
      startDateTimeId: events.startDateTimeId,
      endDateTimeId: events.endDateTimeId,
      eventStartDateTimeId: events.eventStartDateTimeId,
      eventEndDateTimeId: events.eventEndDateTimeId,
      setupDateTimeId: events.setupDateTimeId,
    })
    .from(events);

  const referencedIds = Array.from(
    new Set(
      eventRows.flatMap((row) =>
        [
          row.startDateTimeId,
          row.endDateTimeId,
          row.eventStartDateTimeId,
          row.eventEndDateTimeId,
          row.setupDateTimeId,
        ].filter((value): value is number => typeof value === "number"),
      ),
    ),
  );

  if (referencedIds.length === 0) {
    await db.delete(dateTimes).where(sql`true`);
    return;
  }

  const allRows = await db.select({ id: dateTimes.id }).from(dateTimes);
  const orphanedIds = allRows.map((row) => row.id).filter((id) => !referencedIds.includes(id));
  if (orphanedIds.length > 0) {
    await db.delete(dateTimes).where(inArray(dateTimes.id, orphanedIds));
  }
}

export async function rebuildEventDateTimesForSettings(
  db: DbClient,
  settings: BusinessDateSettings,
) {
  const eventRows = await db
    .select({
      id: events.id,
      startDateTimeId: events.startDateTimeId,
      endDateTimeId: events.endDateTimeId,
      eventStartDateTimeId: events.eventStartDateTimeId,
      eventEndDateTimeId: events.eventEndDateTimeId,
      setupDateTimeId: events.setupDateTimeId,
    })
    .from(events);

  if (eventRows.length === 0) return;

  const currentIds = Array.from(
    new Set(
      eventRows.flatMap((row) =>
        [
          row.startDateTimeId,
          row.endDateTimeId,
          row.eventStartDateTimeId,
          row.eventEndDateTimeId,
          row.setupDateTimeId,
        ].filter((value): value is number => typeof value === "number"),
      ),
    ),
  );
  const currentRows = await loadDateTimesByIds(db, currentIds);
  const rowById = new Map(currentRows.map((row) => [row.id, row]));
  const distinctInstants = Array.from(
    new Map(currentRows.map((row) => [row.instantUtc.toISOString(), row.instantUtc])).values(),
  );
  const resolved = await resolveDateTimeIds(db, settings, distinctInstants);

  await db.transaction(async (tx) => {
    for (const row of eventRows) {
      const startRow = rowById.get(row.startDateTimeId);
      const endRow = rowById.get(row.endDateTimeId);
      if (!startRow || !endRow) continue;

      await tx
        .update(events)
        .set({
          startDateTimeId: getDateTimeId(resolved, startRow.instantUtc) ?? row.startDateTimeId,
          endDateTimeId: getDateTimeId(resolved, endRow.instantUtc) ?? row.endDateTimeId,
          eventStartDateTimeId: row.eventStartDateTimeId
            ? (getDateTimeId(resolved, rowById.get(row.eventStartDateTimeId)?.instantUtc) ?? null)
            : null,
          eventEndDateTimeId: row.eventEndDateTimeId
            ? (getDateTimeId(resolved, rowById.get(row.eventEndDateTimeId)?.instantUtc) ?? null)
            : null,
          setupDateTimeId: row.setupDateTimeId
            ? (getDateTimeId(resolved, rowById.get(row.setupDateTimeId)?.instantUtc) ?? null)
            : null,
        })
        .where(eq(events.id, row.id));
    }

    await cleanupOrphanedDateTimes(tx);
  });
}
