import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import * as XLSX from "xlsx";

import type { db as dbClient } from "~/server/db";
import {
  auditLogs,
  buildings,
  calendars,
  eventAttendees,
  eventCoOwners,
  eventRooms,
  events,
  profiles,
  rooms,
} from "~/server/db/schema";
import { loadDateTimesByIds, getBusinessDateSettings } from "~/server/services/date-time";
import {
  createEventFromInput,
  updateEventFromInput,
  requestCategorySchema,
  type EventCreateInput,
  type EventUpdateInput,
} from "~/server/services/event-upsert";
import { createProfileFromInput } from "~/server/services/profile-upsert";
import {
  EQUIPMENT_NEEDED_OPTIONS,
  EVENT_TYPE_OPTIONS,
  toEventRequestFormState,
  type EquipmentNeededOption,
  type EventTypeOption,
} from "~/types/event-request";

type DbClient = typeof dbClient;

export const EVENT_XLSX_TEMPLATE_VERSION = 1;
export const EVENT_TRANSFER_MAX_ROWS = 200;

const WORKBOOK_SHEET_NAME = "Events";
const WORKBOOK_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REQUEST_CATEGORY_OPTIONS = requestCategorySchema.options;

const REQUEST_CATEGORY_LABELS: Record<(typeof REQUEST_CATEGORY_OPTIONS)[number], string> = {
  university_affiliated_request_to_university_business: "University business requests",
  university_affiliated_nonrequest_to_university_business: "Affiliated events without request",
  fgcu_student_affiliated_event: "FGCU student affiliated",
  non_affiliated_or_revenue_generating_event: "External or revenue events",
};

type EventTransferListInput = {
  search?: string;
  start?: Date;
  end?: Date;
  limit?: number;
};

export type { EventTransferListInput };

export type EventTransferListItem = {
  id: number;
  title: string;
  eventCode: string;
  startDatetime: Date;
  endDatetime: Date;
  calendarId: number;
  buildingId: number | null;
  zendeskTicketNumber: string | null;
  updatedAt: Date | null;
};

export type ImportEventsWorkbookRowResult = {
  rowNumber: number;
  sourceEventId: number | null;
  action: "created" | "updated" | "failed";
  eventId?: number;
  title?: string;
  message?: string;
};

export type ImportEventsWorkbookResult = {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  results: ImportEventsWorkbookRowResult[];
};

export type ExportEventsWorkbookResult = {
  filename: string;
  contentBase64: string;
  mimeType: string;
  rowCount: number;
  templateVersion: number;
};

export type ResolvedWorkbookReferenceSet = {
  calendarId: number;
  buildingId: number | null;
  roomIds: number[];
  assigneeProfileId: number | null;
  coOwnerProfileIds: number[];
  attendeeProfileIds: number[];
};

type ColumnKey =
  | "action"
  | "eventId"
  | "title"
  | "description"
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime"
  | "allDay"
  | "virtual"
  | "calendar"
  | "building"
  | "rooms"
  | "locationOverride"
  | "assignee"
  | "coOwners"
  | "attendees"
  | "participantCount"
  | "technicianNeeded"
  | "requestCategory"
  | "equipmentNeeded"
  | "equipmentOtherDetails"
  | "eventTypes"
  | "eventTypeOtherDetails"
  | "setupTime"
  | "zendeskTicket"
  | "recurrenceRule"
  | "status"
  | "eventCode"
  | "lastUpdated"
  | "importNotes"
  | "templateVersion"
  | "calendarId"
  | "buildingId"
  | "roomIds"
  | "assigneeProfileId"
  | "coOwnerProfileIds"
  | "attendeeProfileIds"
  | "requestDetailsVersion";

type WorkbookColumn = {
  key: ColumnKey;
  header: string;
  width: number;
  hidden?: boolean;
  comment?: string;
};

type WorkbookRow = Record<ColumnKey, string>;

const WORKBOOK_COLUMNS: WorkbookColumn[] = [
  { key: "action", header: "Action", width: 12 },
  {
    key: "eventId",
    header: "Event ID",
    width: 12,
    comment: "Existing event ID. Leave blank to create a new event. Archived event IDs cannot be updated.",
  },
  { key: "title", header: "Title", width: 30 },
  { key: "description", header: "Description", width: 36 },
  {
    key: "startDate",
    header: "Start Date",
    width: 14,
    comment: "Required. Use YYYY-MM-DD. For all-day events this is the first event day.",
  },
  {
    key: "startTime",
    header: "Start Time",
    width: 12,
    comment: "Required for timed events. Use HH:mm in 24-hour time. Leave blank for all-day events.",
  },
  {
    key: "endDate",
    header: "End Date",
    width: 14,
    comment: "Required. For all-day events this is the last event day, not the exclusive end date.",
  },
  {
    key: "endTime",
    header: "End Time",
    width: 12,
    comment: "Required for timed events. Use HH:mm in 24-hour time. Leave blank for all-day events.",
  },
  { key: "allDay", header: "All Day", width: 10 },
  { key: "virtual", header: "Virtual", width: 10 },
  { key: "calendar", header: "Calendar", width: 24 },
  { key: "building", header: "Building", width: 22 },
  {
    key: "rooms",
    header: "Rooms",
    width: 28,
    comment: "Separate multiple rooms with '; '. Exported rows show room number plus room ID in brackets.",
  },
  { key: "locationOverride", header: "Location Override", width: 24 },
  {
    key: "assignee",
    header: "Assignee",
    width: 28,
    comment: "Use 'Display Name <email>' when editing. Leave blank to clear.",
  },
  {
    key: "coOwners",
    header: "Co-Owners",
    width: 32,
    comment: "Separate multiple people with '; '. Use 'Display Name <email>' when possible.",
  },
  {
    key: "attendees",
    header: "Attendees",
    width: 36,
    comment: "Required. Separate multiple people with '; '. Use 'Display Name <email>' when possible.",
  },
  { key: "participantCount", header: "Participant Count", width: 16 },
  { key: "technicianNeeded", header: "Technician Needed", width: 18 },
  { key: "requestCategory", header: "Request Category", width: 28 },
  { key: "equipmentNeeded", header: "Equipment Needed", width: 24 },
  { key: "equipmentOtherDetails", header: "Equipment Other Details", width: 26 },
  { key: "eventTypes", header: "Event Types", width: 24 },
  { key: "eventTypeOtherDetails", header: "Event Type Other Details", width: 24 },
  {
    key: "setupTime",
    header: "Setup Time",
    width: 20,
    comment: "Optional. Use YYYY-MM-DD HH:mm in business local time.",
  },
  {
    key: "zendeskTicket",
    header: "Zendesk Ticket",
    width: 18,
    comment: "Optional. Letters and numbers only are kept after import.",
  },
  {
    key: "recurrenceRule",
    header: "Recurrence Rule",
    width: 24,
    comment: "Optional RRULE string. Leave blank for a one-time event.",
  },
  { key: "status", header: "Status", width: 12 },
  { key: "eventCode", header: "Event Code", width: 12 },
  { key: "lastUpdated", header: "Last Updated", width: 20 },
  { key: "importNotes", header: "Import Notes", width: 24 },
  { key: "templateVersion", header: "Template Version", width: 14, hidden: true },
  { key: "calendarId", header: "Calendar ID", width: 12, hidden: true },
  { key: "buildingId", header: "Building ID", width: 12, hidden: true },
  { key: "roomIds", header: "Room IDs", width: 16, hidden: true },
  { key: "assigneeProfileId", header: "Assignee Profile ID", width: 18, hidden: true },
  { key: "coOwnerProfileIds", header: "Co-Owner Profile IDs", width: 18, hidden: true },
  { key: "attendeeProfileIds", header: "Attendee Profile IDs", width: 18, hidden: true },
  { key: "requestDetailsVersion", header: "Request Details Version", width: 18, hidden: true },
];

const REQUIRED_HEADERS = ["Event ID", "Title", "Start Date", "End Date", "All Day", "Virtual", "Calendar", "Attendees"] as const;

type RoomRecord = {
  id: number;
  buildingId: number;
  roomNumber: string;
};

type BuildingRecord = {
  id: number;
  name: string;
  acronym: string;
};

type CalendarRecord = {
  id: number;
  name: string;
};

type ProfileRecord = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
};

type ParsedProfileImportToken = {
  raw: string;
  displayName: string | null;
  email: string | null;
};

type ReferenceData = {
  timeZone: string;
  calendars: CalendarRecord[];
  buildings: BuildingRecord[];
  rooms: RoomRecord[];
  profiles: ProfileRecord[];
  calendarById: Map<number, CalendarRecord>;
  buildingById: Map<number, BuildingRecord>;
  roomById: Map<number, RoomRecord>;
  profilesById: Map<number, ProfileRecord>;
  calendarsByName: Map<string, CalendarRecord[]>;
  buildingsByName: Map<string, BuildingRecord[]>;
  profilesByEmail: Map<string, ProfileRecord>;
  profilesByLabel: Map<string, ProfileRecord[]>;
  profilesByDisplayName: Map<string, ProfileRecord[]>;
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function trimOrNull(value: string | undefined | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalInt(value: string | undefined | null) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected an integer value, received "${trimmed}".`);
  }
  return parsed;
}

function parseOptionalNumber(value: string | undefined | null, columnLabel: string) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`"${columnLabel}" must be a number.`);
  }
  return parsed;
}

function parseBooleanCell(value: string | undefined | null, defaultValue = false) {
  const normalized = trimOrNull(value)?.toLowerCase();
  if (!normalized) return defaultValue;
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  throw new Error(`Boolean values must be Yes or No. Received "${value ?? ""}".`);
}

function formatBooleanCell(value: boolean | null | undefined) {
  return value ? "Yes" : "No";
}

function splitVisibleList(value: string | undefined | null) {
  return (trimOrNull(value) ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitHiddenIdList(value: string | undefined | null) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return [];
  return trimmed
    .split("|")
    .map((entry) => parseOptionalInt(entry))
    .filter((entry): entry is number => typeof entry === "number");
}

function compareIdSets(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort((a, b) => a - b);
  const rightSorted = [...right].sort((a, b) => a - b);
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function getLocalDateParts(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const partMap = new Map(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  return {
    year: Number(partMap.get("year")),
    month: Number(partMap.get("month")),
    day: Number(partMap.get("day")),
    hour: Number(partMap.get("hour")),
    minute: Number(partMap.get("minute")),
    second: Number(partMap.get("second")),
  };
}

function formatDateInTimeZone(value: Date | null | undefined, timeZone: string) {
  if (!value) return "";
  const parts = getLocalDateParts(value, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatTimeInTimeZone(value: Date | null | undefined, timeZone: string) {
  if (!value) return "";
  const parts = getLocalDateParts(value, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function formatDateTimeInTimeZone(value: Date | null | undefined, timeZone: string) {
  if (!value) return "";
  return `${formatDateInTimeZone(value, timeZone)} ${formatTimeInTimeZone(value, timeZone)}`;
}

function parseDateCell(value: string | undefined | null, columnLabel: string) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`"${columnLabel}" must use YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`"${columnLabel}" is not a valid date.`);
  }
  return { year, month, day };
}

function parseTimeCell(value: string | undefined | null, columnLabel: string) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error(`"${columnLabel}" must use HH:mm.`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`"${columnLabel}" is not a valid time.`);
  }
  return { hour, minute };
}

function parseDateTimeCell(value: string | undefined | null, columnLabel: string) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const normalized = trimmed.replace("T", " ");
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(normalized);
  if (!match) {
    throw new Error(`"${columnLabel}" must use YYYY-MM-DD HH:mm.`);
  }
  const date = parseDateCell(match[1], columnLabel);
  const time = parseTimeCell(match[2], columnLabel);
  if (!date || !time) {
    throw new Error(`"${columnLabel}" is invalid.`);
  }
  return { ...date, ...time, second: 0 };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getLocalDateParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
) {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
  const candidate = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone));
  const adjustedOffset = getTimeZoneOffsetMs(candidate, timeZone);
  const corrected = new Date(utcGuess - adjustedOffset);
  return corrected;
}

function addCalendarDays(value: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatProfileDisplay(profile: ProfileRecord | null | undefined) {
  if (!profile) return "";
  const fullName = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
  const label = fullName || profile.email;
  return `${label} <${profile.email}>`;
}

function formatProfileName(profile: ProfileRecord | null | undefined) {
  if (!profile) return "";
  return `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
}

function parseProfileImportToken(token: string): ParsedProfileImportToken {
  const raw = token.trim();
  const emailMatch = /<([^>]+)>\s*$/.exec(raw);
  if (emailMatch?.[1]) {
    const email = emailMatch[1].trim().toLowerCase();
    const matchIndex = emailMatch.index ?? raw.length;
    const displayName = raw.slice(0, matchIndex).trim() || null;
    return { raw, displayName, email };
  }

  const normalized = raw.toLowerCase();
  const emailOnly = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
  return {
    raw,
    displayName: emailOnly ? null : raw,
    email: emailOnly,
  };
}

function deriveProfileNameParts(token: ParsedProfileImportToken) {
  const emailLocalPart = token.email?.split("@")[0] ?? "";
  const trimmedDisplayName = token.displayName?.trim() ?? "";
  const fallbackName = emailLocalPart.replace(/[._-]+/g, " ").trim();
  const source =
    trimmedDisplayName.length > 0
      ? trimmedDisplayName
      : fallbackName.length > 0
        ? fallbackName
        : "";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return {
      firstName: "Imported",
      lastName: "Profile",
    };
  }
  if (words.length === 1) {
    return {
      firstName: words[0]!,
      lastName: "Imported",
    };
  }
  return {
    firstName: words[0]!,
    lastName: words.slice(1).join(" "),
  };
}

function addProfileReference(references: ReferenceData, profile: ProfileRecord) {
  if (references.profilesById.has(profile.id)) {
    return;
  }
  references.profiles.push(profile);
  references.profilesById.set(profile.id, profile);
  references.profilesByEmail.set(normalizeKey(profile.email), profile);

  const displayKey = normalizeKey(formatProfileDisplay(profile));
  const labelMatches = references.profilesByLabel.get(displayKey) ?? [];
  labelMatches.push(profile);
  references.profilesByLabel.set(displayKey, labelMatches);

  const nameKey = normalizeKey(formatProfileName(profile));
  if (nameKey) {
    const nameMatches = references.profilesByDisplayName.get(nameKey) ?? [];
    nameMatches.push(profile);
    references.profilesByDisplayName.set(nameKey, nameMatches);
  }
}

function formatRoomDisplay(room: RoomRecord | null | undefined) {
  if (!room) return "";
  return `${room.roomNumber} [${room.id}]`;
}

function getCellValue(row: Record<string, string>, key: string) {
  return row[key] ?? "";
}

function createMultiLookup<T>(items: T[], keyBuilder: (item: T) => string | null) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyBuilder(item);
    if (!key) continue;
    const normalized = normalizeKey(key);
    const existing = map.get(normalized) ?? [];
    existing.push(item);
    map.set(normalized, existing);
  }
  return map;
}

function getSingleMatch<T>(matches: T[] | undefined, columnLabel: string, value: string) {
  if (!matches || matches.length === 0) {
    throw new Error(`"${columnLabel}" could not be resolved from "${value}".`);
  }
  if (matches.length > 1) {
    throw new Error(`"${columnLabel}" is ambiguous for "${value}".`);
  }
  return matches[0]!;
}

function decodeWorkbook(base64: string) {
  try {
    return XLSX.read(base64, { type: "base64" });
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Workbook could not be parsed." });
  }
}

function isRowEmpty(row: Record<string, string>) {
  return Object.values(row).every((value) => (value ?? "").trim().length === 0);
}

async function loadReferenceData(db: DbClient): Promise<ReferenceData> {
  const [settings, calendarRows, buildingRows, roomRows, profileRows] = await Promise.all([
    getBusinessDateSettings(db),
    db.select({ id: calendars.id, name: calendars.name }).from(calendars).where(eq(calendars.isArchived, false)),
    db.select({ id: buildings.id, name: buildings.name, acronym: buildings.acronym }).from(buildings),
    db.select({ id: rooms.id, buildingId: rooms.buildingId, roomNumber: rooms.roomNumber }).from(rooms),
    db.select({ id: profiles.id, firstName: profiles.firstName, lastName: profiles.lastName, email: profiles.email }).from(profiles),
  ]);

  return {
    timeZone: settings.timeZone,
    calendars: calendarRows,
    buildings: buildingRows,
    rooms: roomRows,
    profiles: profileRows,
    calendarById: new Map(calendarRows.map((row) => [row.id, row])),
    buildingById: new Map(buildingRows.map((row) => [row.id, row])),
    roomById: new Map(roomRows.map((row) => [row.id, row])),
    profilesById: new Map(profileRows.map((row) => [row.id, row])),
    calendarsByName: createMultiLookup(calendarRows, (row) => row.name),
    buildingsByName: createMultiLookup(buildingRows, (row) => row.name),
    profilesByEmail: new Map(profileRows.map((row) => [normalizeKey(row.email), row])),
    profilesByLabel: createMultiLookup(profileRows, (row) => formatProfileDisplay(row)),
    profilesByDisplayName: createMultiLookup(profileRows, (row) => formatProfileName(row)),
  };
}

function resolveCalendarFromVisible(value: string, references: ReferenceData) {
  return getSingleMatch(references.calendarsByName.get(normalizeKey(value)), "Calendar", value);
}

function resolveBuildingFromVisible(value: string, references: ReferenceData) {
  return getSingleMatch(references.buildingsByName.get(normalizeKey(value)), "Building", value);
}

function lookupExistingProfileToken(token: string, columnLabel: string, references: ReferenceData) {
  const parsed = parseProfileImportToken(token);
  if (parsed.email) {
    const byEmail = references.profilesByEmail.get(normalizeKey(parsed.email));
    return byEmail ?? null;
  }

  if (parsed.displayName) {
    const labelMatches = references.profilesByDisplayName.get(normalizeKey(parsed.displayName));
    if (labelMatches?.length === 1) {
      return labelMatches[0]!;
    }
    if ((labelMatches?.length ?? 0) > 1) {
      throw new Error(`"${columnLabel}" is ambiguous for "${token}".`);
    }
  }

  return null;
}

async function resolveOrCreateProfileToken(options: {
  db: DbClient;
  token: string;
  columnLabel: string;
  references: ReferenceData;
}) {
  const existing = lookupExistingProfileToken(options.token, options.columnLabel, options.references);
  if (existing) return existing;

  const parsed = parseProfileImportToken(options.token);
  if (!parsed.email) {
    throw new Error(
      `"${options.columnLabel}" could not resolve "${options.token}". Include an email address to create a new profile.`,
    );
  }

  const derivedNames = deriveProfileNameParts(parsed);
  try {
    const created = await createProfileFromInput({
      db: options.db,
      input: {
        firstName: derivedNames.firstName,
        lastName: derivedNames.lastName,
        email: parsed.email,
        phoneNumber: "",
      },
    });

    if (!created.profileId) {
      throw new Error(`"${options.columnLabel}" could not resolve "${options.token}".`);
    }

    const profile: ProfileRecord = {
      id: created.profileId,
      firstName: created.firstName,
      lastName: created.lastName,
      email: created.email,
    };
    addProfileReference(options.references, profile);
    return profile;
  } catch (error) {
    const fallback = options.references.profilesByEmail.get(normalizeKey(parsed.email));
    if (fallback) return fallback;
    const existingByEmail = await options.db
      .select({
        id: profiles.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
      })
      .from(profiles)
      .where(eq(profiles.email, parsed.email))
      .limit(1);
    const concurrentMatch = existingByEmail[0];
    if (concurrentMatch) {
      addProfileReference(options.references, concurrentMatch);
      return concurrentMatch;
    }
    throw error;
  }
}

async function resolveProfileScalarReference(options: {
  db: DbClient;
  columnLabel: string;
  visibleValue: string;
  hiddenIdValue: string;
  allowBlank?: boolean;
  references: ReferenceData;
}) {
  const visible = trimOrNull(options.visibleValue);
  const hiddenId = parseOptionalInt(options.hiddenIdValue);

  if (!visible && hiddenId === null) {
    if (options.allowBlank) return null;
    throw new Error(`"${options.columnLabel}" is required.`);
  }
  if (!visible && hiddenId !== null) {
    throw new Error(`"${options.columnLabel}" was cleared, but its hidden key is still set. Clear both to remove it.`);
  }
  if (!visible) {
    return null;
  }
  if (hiddenId === null) {
    return (await resolveOrCreateProfileToken({
      db: options.db,
      token: visible,
      columnLabel: options.columnLabel,
      references: options.references,
    })).id;
  }

  const hiddenEntity = options.references.profilesById.get(hiddenId);
  if (!hiddenEntity) {
    throw new Error(`"${options.columnLabel}" hidden key is invalid.`);
  }
  const visibleEntity = lookupExistingProfileToken(visible, options.columnLabel, options.references);
  if (!visibleEntity || visibleEntity.id !== hiddenEntity.id) {
    throw new Error(`"${options.columnLabel}" conflicts with its hidden key.`);
  }
  return hiddenEntity.id;
}

async function resolveProfileListReference(options: {
  db: DbClient;
  columnLabel: string;
  visibleValue: string;
  hiddenIdsValue: string;
  references: ReferenceData;
}) {
  const visibleItems = splitVisibleList(options.visibleValue);
  const hiddenIds = splitHiddenIdList(options.hiddenIdsValue);

  if (visibleItems.length === 0 && hiddenIds.length === 0) return [];
  if (visibleItems.length === 0 && hiddenIds.length > 0) {
    throw new Error(`"${options.columnLabel}" was cleared, but its hidden keys are still set. Clear both to remove it.`);
  }

  if (hiddenIds.length === 0) {
    const resolved = await Promise.all(
      visibleItems.map((token) =>
        resolveOrCreateProfileToken({
          db: options.db,
          token,
          columnLabel: options.columnLabel,
          references: options.references,
        }),
      ),
    );
    return resolved.map((profile) => profile.id);
  }

  const visibleIds = visibleItems.map((token) => {
    const profile = lookupExistingProfileToken(token, options.columnLabel, options.references);
    if (!profile) {
      throw new Error(`"${options.columnLabel}" conflicts with its hidden keys.`);
    }
    return profile.id;
  });
  if (!compareIdSets(visibleIds, hiddenIds)) {
    throw new Error(`"${options.columnLabel}" conflicts with its hidden keys.`);
  }
  return hiddenIds;
}

function resolveRoomToken(token: string, buildingId: number | null, references: ReferenceData) {
  const bracketId = /\[(\d+)\]\s*$/.exec(token);
  if (bracketId?.[1]) {
    const roomId = Number(bracketId[1]);
    const room = references.roomById.get(roomId);
    if (!room) {
      throw new Error(`"Rooms" could not resolve "${token}".`);
    }
    if (buildingId && room.buildingId !== buildingId) {
      throw new Error(`"Rooms" conflicts with the selected building.`);
    }
    return room.id;
  }

  if (!buildingId) {
    throw new Error(`"Rooms" requires a building when room IDs are not present.`);
  }
  const matches = references.rooms.filter(
    (room) => room.buildingId === buildingId && normalizeKey(room.roomNumber) === normalizeKey(token),
  );
  return getSingleMatch(matches, "Rooms", token).id;
}

function resolveRoomListFromVisible(value: string, buildingId: number | null, references: ReferenceData) {
  return splitVisibleList(value).map((token) => resolveRoomToken(token, buildingId, references));
}

function resolveScalarReference<T extends { id: number }>(options: {
  columnLabel: string;
  visibleValue: string;
  hiddenIdValue: string;
  allowBlank?: boolean;
  resolveVisible: (value: string) => T;
  resolveHidden: (id: number) => T | undefined;
}) {
  const visible = trimOrNull(options.visibleValue);
  const hiddenId = parseOptionalInt(options.hiddenIdValue);

  if (!visible && hiddenId === null) {
    if (options.allowBlank) return null;
    throw new Error(`"${options.columnLabel}" is required.`);
  }
  if (!visible && hiddenId !== null) {
    throw new Error(`"${options.columnLabel}" was cleared, but its hidden key is still set. Clear both to remove it.`);
  }
  if (visible && hiddenId === null) {
    return options.resolveVisible(visible).id;
  }

  const hiddenEntity = options.resolveHidden(hiddenId!);
  if (!hiddenEntity) {
    throw new Error(`"${options.columnLabel}" hidden key is invalid.`);
  }
  const visibleEntity = options.resolveVisible(visible!);
  if (hiddenEntity.id !== visibleEntity.id) {
    throw new Error(`"${options.columnLabel}" conflicts with its hidden key.`);
  }
  return hiddenEntity.id;
}

function resolveListReference(options: {
  columnLabel: string;
  visibleValue: string;
  hiddenIdsValue: string;
  resolveVisible: (value: string) => number[];
}) {
  const visibleItems = splitVisibleList(options.visibleValue);
  const hiddenIds = splitHiddenIdList(options.hiddenIdsValue);

  if (visibleItems.length === 0 && hiddenIds.length === 0) return [];
  if (visibleItems.length === 0 && hiddenIds.length > 0) {
    throw new Error(`"${options.columnLabel}" was cleared, but its hidden keys are still set. Clear both to remove it.`);
  }
  if (visibleItems.length > 0 && hiddenIds.length === 0) {
    return options.resolveVisible(options.visibleValue);
  }

  const visibleIds = options.resolveVisible(options.visibleValue);
  if (!compareIdSets(visibleIds, hiddenIds)) {
    throw new Error(`"${options.columnLabel}" conflicts with its hidden keys.`);
  }
  return hiddenIds;
}

function resolveRequestCategory(value: string | undefined | null) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;
  const normalized = normalizeKey(trimmed);
  const byCode = REQUEST_CATEGORY_OPTIONS.find((entry) => normalizeKey(entry) === normalized);
  if (byCode) return byCode;
  const byLabel = REQUEST_CATEGORY_OPTIONS.find((entry) => normalizeKey(REQUEST_CATEGORY_LABELS[entry]) === normalized);
  if (byLabel) return byLabel;
  throw new Error(`"Request Category" is invalid.`);
}

function resolveEquipmentList(value: string | undefined | null) {
  const entries = splitVisibleList(value);
  const invalid = entries.find((entry) => !(EQUIPMENT_NEEDED_OPTIONS as readonly string[]).includes(entry));
  if (invalid) {
    throw new Error(`"Equipment Needed" contains an unknown option "${invalid}".`);
  }
  return entries as EquipmentNeededOption[];
}

function resolveEventTypeList(value: string | undefined | null) {
  const entries = splitVisibleList(value);
  const invalid = entries.find((entry) => !(EVENT_TYPE_OPTIONS as readonly string[]).includes(entry));
  if (invalid) {
    throw new Error(`"Event Types" contains an unknown option "${invalid}".`);
  }
  return entries as EventTypeOption[];
}

function buildRequestDetailsInput(options: {
  requestDetailsVersion: string;
  equipmentNeededValue: string;
  equipmentOtherDetailsValue: string;
  eventTypesValue: string;
  eventTypeOtherDetailsValue: string;
  mode: "create" | "update";
}) {
  const requestDetailsVersion = trimOrNull(options.requestDetailsVersion);
  const equipmentNeeded = resolveEquipmentList(options.equipmentNeededValue);
  const equipmentOtherDetails = trimOrNull(options.equipmentOtherDetailsValue);
  const eventTypes = resolveEventTypeList(options.eventTypesValue);
  const eventTypeOtherDetails = trimOrNull(options.eventTypeOtherDetailsValue);

  const hasVisibleValues =
    equipmentNeeded.length > 0 ||
    Boolean(equipmentOtherDetails) ||
    eventTypes.length > 0 ||
    Boolean(eventTypeOtherDetails);

  if (requestDetailsVersion === "1" && equipmentNeeded.length === 0 && eventTypes.length === 0 && equipmentOtherDetails) {
    return {
      equipmentNeeded: equipmentOtherDetails,
      requestDetails: {
        version: 1 as const,
        equipmentNeededText: equipmentOtherDetails,
      },
    };
  }

  if (requestDetailsVersion === "2" || hasVisibleValues) {
    return {
      equipmentNeeded: undefined,
      requestDetails: {
        version: 2 as const,
        equipmentNeeded,
        equipmentOtherDetails: equipmentOtherDetails ?? "",
        eventTypes,
        eventTypeOtherDetails: eventTypeOtherDetails ?? "",
      },
    };
  }

  if (options.mode === "update") {
    return { equipmentNeeded: null, requestDetails: null };
  }

  return { equipmentNeeded: undefined, requestDetails: undefined };
}

function mapWorksheetRows(sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (rows.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Workbook is empty." });
  }

  const headerRow = rows[0]?.map((value) => String(value).trim()) ?? [];
  const requiredMissing = REQUIRED_HEADERS.filter((header) => !headerRow.includes(header));
  if (requiredMissing.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Workbook is missing required columns: ${requiredMissing.join(", ")}.`,
    });
  }

  const missingKnownColumns = WORKBOOK_COLUMNS.map((column) => column.header).filter((header) => !headerRow.includes(header));
  if (missingKnownColumns.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Workbook is missing template columns: ${missingKnownColumns.join(", ")}.`,
    });
  }

  const mappedRows = rows.slice(1).map((row, rowIndex) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < headerRow.length; index += 1) {
      const header = headerRow[index];
      if (!header) continue;
      record[header] = String(row[index] ?? "");
    }
    return { rowNumber: rowIndex + 2, record };
  });

  return mappedRows.filter((row) => !isRowEmpty(row.record));
}

function addWorksheetComments(sheet: XLSX.WorkSheet) {
  WORKBOOK_COLUMNS.forEach((column, index) => {
    if (!column.comment) return;
    const address = XLSX.utils.encode_cell({ c: index, r: 0 });
    const cell = sheet[address] as XLSX.CellObject | undefined;
    if (!cell) return;
    cell.c = [{ a: "Eaglevents", t: column.comment }];
  });
}

function buildWorkbookRow(event: typeof events.$inferSelect, options: {
  calendarName: string;
  building: BuildingRecord | null;
  rooms: RoomRecord[];
  assignee: ProfileRecord | null;
  coOwners: ProfileRecord[];
  attendees: ProfileRecord[];
}) {
  const requestState = toEventRequestFormState(event.requestDetails ?? event.equipmentNeeded ?? null);
  const row: WorkbookRow = {
    action: "Update",
    eventId: String(event.id),
    title: event.title,
    description: event.description ?? "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    allDay: formatBooleanCell(event.isAllDay),
    virtual: formatBooleanCell(event.isVirtual),
    calendar: options.calendarName,
    building: options.building?.name ?? "",
    rooms: options.rooms.map((room) => formatRoomDisplay(room)).join("; "),
    locationOverride: event.location ?? "",
    assignee: formatProfileDisplay(options.assignee),
    coOwners: options.coOwners.map((profile) => formatProfileDisplay(profile)).join("; "),
    attendees: options.attendees.map((profile) => formatProfileDisplay(profile)).join("; "),
    participantCount: event.participantCount === null ? "" : String(event.participantCount),
    technicianNeeded: formatBooleanCell(event.technicianNeeded),
    requestCategory: event.requestCategory ? REQUEST_CATEGORY_LABELS[event.requestCategory] ?? event.requestCategory : "",
    equipmentNeeded: requestState.selectedEquipment.join("; "),
    equipmentOtherDetails: requestState.equipmentOtherDetails,
    eventTypes: requestState.selectedEventTypes.join("; "),
    eventTypeOtherDetails: requestState.eventTypeOtherDetails,
    setupTime: "",
    zendeskTicket: event.zendeskTicketNumber ?? "",
    recurrenceRule: event.recurrenceRule ?? "",
    status: "Existing",
    eventCode: event.eventCode,
    lastUpdated: "",
    importNotes: "",
    templateVersion: String(EVENT_XLSX_TEMPLATE_VERSION),
    calendarId: String(event.calendarId),
    buildingId: event.buildingId ? String(event.buildingId) : "",
    roomIds: options.rooms.map((room) => room.id).join("|"),
    assigneeProfileId: event.assigneeProfileId ? String(event.assigneeProfileId) : "",
    coOwnerProfileIds: options.coOwners.map((profile) => profile.id).join("|"),
    attendeeProfileIds: options.attendees.map((profile) => profile.id).join("|"),
    requestDetailsVersion: event.requestDetails?.version ? String(event.requestDetails.version) : event.equipmentNeeded ? "1" : "",
  };
  return row;
}

export async function listTransferEvents(
  db: DbClient,
  input?: EventTransferListInput,
): Promise<EventTransferListItem[]> {
  const search = input?.search?.trim();
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      eventCode: events.eventCode,
      calendarId: events.calendarId,
      buildingId: events.buildingId,
      zendeskTicketNumber: events.zendeskTicketNumber,
      updatedAt: events.updatedAt,
      startDateTimeId: events.startDateTimeId,
      endDateTimeId: events.endDateTimeId,
    })
    .from(events)
    .where(
      and(
        eq(events.isArchived, false),
        search
          ? or(
              ilike(events.title, `%${search}%`),
              ilike(events.eventCode, `%${search}%`),
              ilike(events.zendeskTicketNumber, `%${search}%`),
            )
          : undefined,
      ),
    )
    .limit(input?.limit ?? 50);

  const dateTimeIds = Array.from(new Set(rows.flatMap((row) => [row.startDateTimeId, row.endDateTimeId])));
  const dateTimeMap = new Map((await loadDateTimesByIds(db, dateTimeIds)).map((row) => [row.id, row.instantUtc]));

  return rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      eventCode: row.eventCode,
      startDatetime: dateTimeMap.get(row.startDateTimeId) ?? new Date(0),
      endDatetime: dateTimeMap.get(row.endDateTimeId) ?? new Date(0),
      calendarId: row.calendarId,
      buildingId: row.buildingId ?? null,
      zendeskTicketNumber: row.zendeskTicketNumber ?? null,
      updatedAt: row.updatedAt ?? null,
    }))
    .filter((row) => {
      if (search) {
        const normalizedSearch = search.toLowerCase();
        const matchesSearch =
          row.title.toLowerCase().includes(normalizedSearch) ||
          row.eventCode.toLowerCase().includes(normalizedSearch) ||
          (row.zendeskTicketNumber ?? "").toLowerCase().includes(normalizedSearch) ||
          String(row.id) === normalizedSearch;
        if (!matchesSearch) return false;
      }
      if (input?.start && row.endDatetime <= input.start) return false;
      if (input?.end && row.startDatetime >= input.end) return false;
      return true;
    })
    .sort((a, b) => b.startDatetime.getTime() - a.startDatetime.getTime());
}

export async function exportEventsWorkbook(db: DbClient, eventIds: number[]): Promise<ExportEventsWorkbookResult> {
  const uniqueIds = Array.from(new Set(eventIds)).filter((id) => Number.isInteger(id) && id > 0);
  if (uniqueIds.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one event to export." });
  }
  if (uniqueIds.length > EVENT_TRANSFER_MAX_ROWS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Export is limited to ${EVENT_TRANSFER_MAX_ROWS} events.` });
  }

  const [references, eventRows, eventRoomRows, coOwnerRows, attendeeRows] = await Promise.all([
    loadReferenceData(db),
    db.select().from(events).where(and(inArray(events.id, uniqueIds), eq(events.isArchived, false))),
    db.select().from(eventRooms).where(inArray(eventRooms.eventId, uniqueIds)),
    db.select().from(eventCoOwners).where(inArray(eventCoOwners.eventId, uniqueIds)),
    db.select().from(eventAttendees).where(inArray(eventAttendees.eventId, uniqueIds)),
  ]);

  if (eventRows.length !== uniqueIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "One or more selected events no longer exist." });
  }

  const dateTimeIds = Array.from(
    new Set(
      eventRows.flatMap((row) =>
        [row.startDateTimeId, row.endDateTimeId, row.setupDateTimeId].filter((value): value is number => typeof value === "number"),
      ),
    ),
  );
  const dateTimeMap = new Map((await loadDateTimesByIds(db, dateTimeIds)).map((row) => [row.id, row.instantUtc]));

  const rows = eventRows.map((event) => {
    const roomIds = eventRoomRows.filter((row) => row.eventId === event.id).map((row) => row.roomId);
    const coOwnerIds = coOwnerRows.filter((row) => row.eventId === event.id).map((row) => row.profileId);
    const attendeeIds = attendeeRows
      .filter((row): row is typeof row & { profileId: number } => row.eventId === event.id && row.profileId !== null)
      .map((row) => row.profileId);
    const workbookRow = buildWorkbookRow(event, {
      calendarName: references.calendarById.get(event.calendarId)?.name ?? "",
      building: event.buildingId ? (references.buildingById.get(event.buildingId) ?? null) : null,
      rooms: roomIds.map((id) => references.roomById.get(id)).filter((room): room is RoomRecord => Boolean(room)),
      assignee: event.assigneeProfileId ? (references.profilesById.get(event.assigneeProfileId) ?? null) : null,
      coOwners: coOwnerIds.map((id) => references.profilesById.get(id)).filter((profile): profile is ProfileRecord => Boolean(profile)),
      attendees: attendeeIds.map((id) => references.profilesById.get(id)).filter((profile): profile is ProfileRecord => Boolean(profile)),
    });

    const startDatetime = dateTimeMap.get(event.startDateTimeId) ?? null;
    const endDatetime = dateTimeMap.get(event.endDateTimeId) ?? null;
    const setupTime = event.setupDateTimeId ? (dateTimeMap.get(event.setupDateTimeId) ?? null) : null;

    workbookRow.startDate = formatDateInTimeZone(startDatetime, references.timeZone);
    workbookRow.endDate = event.isAllDay
      ? formatDateInTimeZone(endDatetime ? new Date(endDatetime.getTime() - 1000) : null, references.timeZone)
      : formatDateInTimeZone(endDatetime, references.timeZone);
    workbookRow.startTime = event.isAllDay ? "" : formatTimeInTimeZone(startDatetime, references.timeZone);
    workbookRow.endTime = event.isAllDay ? "" : formatTimeInTimeZone(endDatetime, references.timeZone);
    workbookRow.setupTime = formatDateTimeInTimeZone(setupTime, references.timeZone);
    workbookRow.lastUpdated = event.updatedAt ? formatDateTimeInTimeZone(event.updatedAt, references.timeZone) : "";

    return workbookRow;
  });

  const sheetData = [
    WORKBOOK_COLUMNS.map((column) => column.header),
    ...rows.map((row) => WORKBOOK_COLUMNS.map((column) => row[column.key] ?? "")),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sheetData);
  sheet["!cols"] = WORKBOOK_COLUMNS.map((column) => ({
    wch: column.width,
    hidden: column.hidden ?? false,
  }));
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range(range) };
  addWorksheetComments(sheet);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, WORKBOOK_SHEET_NAME);

  return {
    filename: `eaglevents-events-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.xlsx`,
    contentBase64: XLSX.write(workbook, { type: "base64", bookType: "xlsx" }) as string,
    mimeType: WORKBOOK_MIME_TYPE,
    rowCount: rows.length,
    templateVersion: EVENT_XLSX_TEMPLATE_VERSION,
  };
}

async function buildImportInput(options: {
  db: DbClient;
  row: Record<string, string>;
  references: ReferenceData;
  mode: "create" | "update";
  matchedEventId?: number;
}): Promise<EventCreateInput | EventUpdateInput> {
  const { row, references, mode } = options;
  const allDay = parseBooleanCell(getCellValue(row, "All Day"), false);
  const isVirtual = parseBooleanCell(getCellValue(row, "Virtual"), false);
  const technicianNeeded = parseBooleanCell(getCellValue(row, "Technician Needed"), false);

  const calendarId = resolveScalarReference({
    columnLabel: "Calendar",
    visibleValue: getCellValue(row, "Calendar"),
    hiddenIdValue: getCellValue(row, "Calendar ID"),
    resolveVisible: (value) => resolveCalendarFromVisible(value, references),
    resolveHidden: (id) => references.calendarById.get(id),
  });
  if (calendarId === null) {
    throw new Error(`"Calendar" is required.`);
  }

  const buildingId = resolveScalarReference({
    columnLabel: "Building",
    visibleValue: getCellValue(row, "Building"),
    hiddenIdValue: getCellValue(row, "Building ID"),
    allowBlank: true,
    resolveVisible: (value) => resolveBuildingFromVisible(value, references),
    resolveHidden: (id) => references.buildingById.get(id),
  });

  const roomIds = resolveListReference({
    columnLabel: "Rooms",
    visibleValue: getCellValue(row, "Rooms"),
    hiddenIdsValue: getCellValue(row, "Room IDs"),
    resolveVisible: (value) => resolveRoomListFromVisible(value, buildingId, references),
  });

  const assigneeProfileId = await resolveProfileScalarReference({
    db: options.db,
    columnLabel: "Assignee",
    visibleValue: getCellValue(row, "Assignee"),
    hiddenIdValue: getCellValue(row, "Assignee Profile ID"),
    allowBlank: true,
    references,
  });

  const coOwnerProfileIds = await resolveProfileListReference({
    db: options.db,
    columnLabel: "Co-Owners",
    visibleValue: getCellValue(row, "Co-Owners"),
    hiddenIdsValue: getCellValue(row, "Co-Owner Profile IDs"),
    references,
  });

  const attendeeProfileIds = await resolveProfileListReference({
    db: options.db,
    columnLabel: "Attendees",
    visibleValue: getCellValue(row, "Attendees"),
    hiddenIdsValue: getCellValue(row, "Attendee Profile IDs"),
    references,
  });

  const title = trimOrNull(getCellValue(row, "Title"));
  if (!title) {
    throw new Error(`"Title" is required.`);
  }

  const startDate = parseDateCell(getCellValue(row, "Start Date"), "Start Date");
  const endDate = parseDateCell(getCellValue(row, "End Date"), "End Date");
  if (!startDate || !endDate) {
    throw new Error(`"Start Date" and "End Date" are required.`);
  }

  let startDatetime: Date;
  let endDatetime: Date;
  if (allDay) {
    startDatetime = zonedDateTimeToUtc({ ...startDate, hour: 0, minute: 0, second: 0 }, references.timeZone);
    const exclusiveEndDate = addCalendarDays(endDate, 1);
    endDatetime = zonedDateTimeToUtc({ ...exclusiveEndDate, hour: 0, minute: 0, second: 0 }, references.timeZone);
  } else {
    const startTime = parseTimeCell(getCellValue(row, "Start Time"), "Start Time");
    const endTime = parseTimeCell(getCellValue(row, "End Time"), "End Time");
    if (!startTime || !endTime) {
      throw new Error(`"Start Time" and "End Time" are required for timed events.`);
    }
    startDatetime = zonedDateTimeToUtc({ ...startDate, ...startTime, second: 0 }, references.timeZone);
    endDatetime = zonedDateTimeToUtc({ ...endDate, ...endTime, second: 0 }, references.timeZone);
  }

  const setupParts = parseDateTimeCell(getCellValue(row, "Setup Time"), "Setup Time");
  const setupTime = setupParts ? zonedDateTimeToUtc(setupParts, references.timeZone) : undefined;
  const participantCount = parseOptionalNumber(getCellValue(row, "Participant Count"), "Participant Count");
  const requestCategory = resolveRequestCategory(getCellValue(row, "Request Category"));
  const requestFields = buildRequestDetailsInput({
    requestDetailsVersion: getCellValue(row, "Request Details Version"),
    equipmentNeededValue: getCellValue(row, "Equipment Needed"),
    equipmentOtherDetailsValue: getCellValue(row, "Equipment Other Details"),
    eventTypesValue: getCellValue(row, "Event Types"),
    eventTypeOtherDetailsValue: getCellValue(row, "Event Type Other Details"),
    mode,
  });

  const baseInput = {
    calendarId,
    title,
    description: trimOrNull(getCellValue(row, "Description")),
    location: trimOrNull(getCellValue(row, "Location Override")),
    buildingId,
    roomIds,
    isVirtual,
    isAllDay: allDay,
    startDatetime,
    endDatetime,
    recurrenceRule: trimOrNull(getCellValue(row, "Recurrence Rule")),
    assigneeProfileId,
    coOwnerProfileIds,
    attendeeProfileIds,
    participantCount,
    technicianNeeded,
    requestCategory,
    equipmentNeeded: requestFields.equipmentNeeded,
    requestDetails: requestFields.requestDetails,
    setupTime,
    zendeskTicketNumber: trimOrNull(getCellValue(row, "Zendesk Ticket")),
  };

  if (mode === "update") {
    return {
      ...baseInput,
      id: options.matchedEventId!,
      assigneeProfileId,
      participantCount,
      setupTime: setupTime ?? null,
      description: trimOrNull(getCellValue(row, "Description")),
      location: trimOrNull(getCellValue(row, "Location Override")),
      buildingId,
      recurrenceRule: trimOrNull(getCellValue(row, "Recurrence Rule")),
      zendeskTicketNumber: trimOrNull(getCellValue(row, "Zendesk Ticket")),
    } as EventUpdateInput;
  }

  return {
    ...baseInput,
    assigneeProfileId: assigneeProfileId ?? undefined,
    participantCount: participantCount ?? undefined,
    description: trimOrNull(getCellValue(row, "Description")) ?? undefined,
    location: trimOrNull(getCellValue(row, "Location Override")) ?? undefined,
    buildingId,
    recurrenceRule: trimOrNull(getCellValue(row, "Recurrence Rule")),
    setupTime,
    zendeskTicketNumber: trimOrNull(getCellValue(row, "Zendesk Ticket")) ?? undefined,
  } as EventCreateInput;
}

export async function importEventsWorkbook(options: {
  db: DbClient;
  session: Session | null;
  contentBase64: string;
}) {
  const workbook = decodeWorkbook(options.contentBase64);
  const sheet = workbook.Sheets[WORKBOOK_SHEET_NAME];
  if (!sheet) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Workbook is missing the "${WORKBOOK_SHEET_NAME}" sheet.` });
  }

  const rows = mapWorksheetRows(sheet);
  if (rows.length > EVENT_TRANSFER_MAX_ROWS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Workbook import is limited to ${EVENT_TRANSFER_MAX_ROWS} rows.`,
    });
  }

  const templateVersions = Array.from(
    new Set(rows.map((row) => trimOrNull(row.record["Template Version"])).filter((value): value is string => Boolean(value))),
  );
  if (
    templateVersions.length > 1 ||
    (templateVersions.length === 1 && templateVersions[0] !== String(EVENT_XLSX_TEMPLATE_VERSION))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unsupported template version. Expected ${EVENT_XLSX_TEMPLATE_VERSION}.`,
    });
  }

  const sourceIds = Array.from(
    new Set(
      rows
        .map((row) => parseOptionalInt(row.record["Event ID"]))
        .filter((value): value is number => typeof value === "number"),
    ),
  );

  const [references, existingRows] = await Promise.all([
    loadReferenceData(options.db),
    sourceIds.length > 0
      ? options.db
          .select({ id: events.id, isArchived: events.isArchived })
          .from(events)
          .where(inArray(events.id, sourceIds))
      : Promise.resolve([]),
  ]);

  const existingMap = new Map(existingRows.map((row) => [row.id, row]));
  const results: ImportEventsWorkbookRowResult[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  for (const row of rows) {
    const sourceEventId = parseOptionalInt(row.record["Event ID"]);
    const existing = sourceEventId ? (existingMap.get(sourceEventId) ?? null) : null;

    if (existing?.isArchived) {
      results.push({
        rowNumber: row.rowNumber,
        sourceEventId,
        action: "failed",
        message: "Archived events cannot be updated by workbook import.",
      });
      continue;
    }

    try {
      if (existing) {
        const input = await buildImportInput({
          db: options.db,
          row: row.record,
          references,
          mode: "update",
          matchedEventId: existing.id,
        }) as EventUpdateInput;
        const updated = await updateEventFromInput({
          db: options.db,
          session: options.session,
          input,
          mode: "admin_import",
          refreshExports: false,
        });
        updatedCount += 1;
        results.push({
          rowNumber: row.rowNumber,
          sourceEventId,
          action: "updated",
          eventId: updated.id,
          title: updated.title,
        });
      } else {
        const input = await buildImportInput({
          db: options.db,
          row: row.record,
          references,
          mode: "create",
        }) as EventCreateInput;
        const created = await createEventFromInput({
          db: options.db,
          session: options.session,
          input,
          mode: "admin_import",
          refreshExports: false,
        });
        createdCount += 1;
        results.push({
          rowNumber: row.rowNumber,
          sourceEventId,
          action: "created",
          eventId: created.id,
          title: created.title,
        });
      }
    } catch (error) {
      results.push({
        rowNumber: row.rowNumber,
        sourceEventId,
        action: "failed",
        message: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }

  return {
    totalRows: rows.length,
    createdCount,
    updatedCount,
    failedCount: results.filter((result) => result.action === "failed").length,
    results,
  } satisfies ImportEventsWorkbookResult;
}

export async function writeEventWorkbookImportAuditLog(options: {
  db: DbClient;
  businessId: number | null;
  actorUserId: number | null;
  fileName?: string | null;
  result: ImportEventsWorkbookResult;
}) {
  if (!options.businessId) return;
  await options.db.insert(auditLogs).values({
    businessId: options.businessId,
    actorUserId: options.actorUserId,
    action: "events.xlsx_import",
    targetType: "event",
    targetId: null,
    scopeType: "business",
    scopeId: options.businessId,
    metadata: {
      fileName: options.fileName ?? null,
      totalRows: options.result.totalRows,
      createdCount: options.result.createdCount,
      updatedCount: options.result.updatedCount,
      failedCount: options.result.failedCount,
    },
  });
}

export const __eventTransferTestUtils = {
  WORKBOOK_COLUMNS,
  formatProfileDisplay,
  formatRoomDisplay,
  parseProfileImportToken,
  deriveProfileNameParts,
  splitVisibleList,
  splitHiddenIdList,
  parseDateCell,
  parseTimeCell,
  parseDateTimeCell,
  formatDateInTimeZone,
  formatTimeInTimeZone,
  zonedDateTimeToUtc,
  buildWorkbookSheetRows(rows: WorkbookRow[]) {
    const sheetData = [
      WORKBOOK_COLUMNS.map((column) => column.header),
      ...rows.map((row) => WORKBOOK_COLUMNS.map((column) => row[column.key] ?? "")),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(sheetData);
    sheet["!cols"] = WORKBOOK_COLUMNS.map((column) => ({
      wch: column.width,
      hidden: column.hidden ?? false,
    }));
    addWorksheetComments(sheet);
    return sheet;
  },
  mapWorksheetRows,
};
