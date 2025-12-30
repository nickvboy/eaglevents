import fs from "fs";
import path from "path";
import { mkdir, stat, copyFile, writeFile } from "fs/promises";
import * as XLSX from "xlsx";
import { inArray } from "drizzle-orm";

import {
  businesses,
  buildings,
  calendars,
  eventAttendees,
  eventHourLogs,
  eventReminders,
  eventZendeskConfirmations,
  events,
  profiles,
  users,
} from "~/server/db/schema";
import { db } from "~/server/db";

type DbClient = typeof db;

const EXPORT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SCHEDULER_POLL_MS = 60 * 60 * 1000;
const EXPORT_DIR_NAME = "exports";
const BACKUP_DIR_NAME = "join-table-backups";
const MAIN_FILENAME = "eaglevents-join-table.xlsx";

type JoinTableRow = {
  event: Record<string, unknown>;
  calendar: Record<string, unknown> | null;
  calendarUser: Record<string, unknown> | null;
  building: Record<string, unknown> | null;
  business: Record<string, unknown> | null;
  assigneeProfile: Record<string, unknown> | null;
  attendees: unknown[];
  reminders: unknown[];
  hourLogs: unknown[];
  confirmations: unknown[];
};

type JoinTableExportResult = {
  updatedAt: string;
  filePath: string;
  backupPath: string | null;
  rowCount: number;
};

type JoinTableExportStatus = {
  filePath: string;
  backupDirectory: string;
  exists: boolean;
  lastUpdatedAt: string | null;
  nextScheduledAt: string | null;
  intervalHours: number;
};

type JoinTableExportState = {
  running: Promise<JoinTableExportResult> | null;
  schedulerStarted: boolean;
};

const GLOBAL_STATE_KEY = "__joinTableExportState";

function getExportState(): JoinTableExportState {
  const globalState = globalThis as typeof globalThis & { [GLOBAL_STATE_KEY]?: JoinTableExportState };
  const state =
    (globalState[GLOBAL_STATE_KEY] ??= {
      running: null,
      schedulerStarted: false,
    });
  return state;
}

function getExportPaths() {
  const exportDir = path.resolve(process.cwd(), EXPORT_DIR_NAME);
  const backupDir = path.join(exportDir, BACKUP_DIR_NAME);
  const filePath = path.join(exportDir, MAIN_FILENAME);
  return { exportDir, backupDir, filePath };
}

function formatBackupTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

function formatCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return Object.prototype.toString.call(value);
}

function collectKeys(rows: JoinTableRow[], getter: (row: JoinTableRow) => Record<string, unknown> | null) {
  const keys = new Set<string>();
  for (const row of rows) {
    const target = getter(row);
    if (!target) continue;
    for (const key of Object.keys(target)) {
      keys.add(key);
    }
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function buildMatrix(rows: JoinTableRow[]) {
  const eventKeys = collectKeys(rows, (row) => row.event);
  const calendarKeys = collectKeys(rows, (row) => row.calendar);
  const calendarUserKeys = collectKeys(rows, (row) => row.calendarUser);
  const buildingKeys = collectKeys(rows, (row) => row.building);
  const businessKeys = collectKeys(rows, (row) => row.business);
  const assigneeKeys = collectKeys(rows, (row) => row.assigneeProfile);

  const headers = [
    ...eventKeys.map((key) => `event.${key}`),
    ...calendarKeys.map((key) => `calendar.${key}`),
    ...calendarUserKeys.map((key) => `calendarUser.${key}`),
    ...buildingKeys.map((key) => `building.${key}`),
    ...businessKeys.map((key) => `business.${key}`),
    ...assigneeKeys.map((key) => `assigneeProfile.${key}`),
    "attendees",
    "reminders",
    "hourLogs",
    "confirmations",
  ];

  const dataRows = rows.map((row) => {
    const values: Record<string, unknown> = {};
    for (const key of eventKeys) values[`event.${key}`] = row.event[key];
    for (const key of calendarKeys) values[`calendar.${key}`] = row.calendar?.[key] ?? null;
    for (const key of calendarUserKeys) values[`calendarUser.${key}`] = row.calendarUser?.[key] ?? null;
    for (const key of buildingKeys) values[`building.${key}`] = row.building?.[key] ?? null;
    for (const key of businessKeys) values[`business.${key}`] = row.business?.[key] ?? null;
    for (const key of assigneeKeys) values[`assigneeProfile.${key}`] = row.assigneeProfile?.[key] ?? null;
    values.attendees = row.attendees;
    values.reminders = row.reminders;
    values.hourLogs = row.hourLogs;
    values.confirmations = row.confirmations;
    return headers.map((header) => formatCellValue(values[header]));
  });

  return [headers, ...dataRows];
}

async function loadJoinTableRows(database: DbClient): Promise<JoinTableRow[]> {
  const eventRows = await database.select().from(events).orderBy(events.id);
  if (eventRows.length === 0) return [];

  const calendarIds = Array.from(new Set(eventRows.map((row) => row.calendarId)));
  const buildingIds = Array.from(
    new Set(eventRows.map((row) => row.buildingId).filter((id): id is number => typeof id === "number")),
  );
  const assigneeProfileIds = Array.from(
    new Set(eventRows.map((row) => row.assigneeProfileId).filter((id): id is number => typeof id === "number")),
  );
  const eventIds = eventRows.map((row) => row.id);

  const [calendarRows, buildingRows, attendeeRows, reminderRows, hourLogRows, confirmationRows] = await Promise.all([
    database.select().from(calendars).where(inArray(calendars.id, calendarIds)),
    buildingIds.length > 0 ? database.select().from(buildings).where(inArray(buildings.id, buildingIds)) : [],
    database.select().from(eventAttendees).where(inArray(eventAttendees.eventId, eventIds)),
    database.select().from(eventReminders).where(inArray(eventReminders.eventId, eventIds)),
    database.select().from(eventHourLogs).where(inArray(eventHourLogs.eventId, eventIds)),
    database.select().from(eventZendeskConfirmations).where(inArray(eventZendeskConfirmations.eventId, eventIds)),
  ]);

  const calendarUserIds = Array.from(new Set(calendarRows.map((row) => row.userId)));
  const businessIds = Array.from(new Set(buildingRows.map((row) => row.businessId)));
  const attendeeProfileIds = Array.from(
    new Set(attendeeRows.map((row) => row.profileId).filter((id): id is number => typeof id === "number")),
  );
  const hourLogProfileIds = Array.from(
    new Set(hourLogRows.map((row) => row.loggedByProfileId).filter((id): id is number => typeof id === "number")),
  );
  const profileIds = Array.from(new Set([...assigneeProfileIds, ...attendeeProfileIds, ...hourLogProfileIds]));

  const [userRows, businessRows, profileRows] = await Promise.all([
    calendarUserIds.length > 0 ? database.select().from(users).where(inArray(users.id, calendarUserIds)) : [],
    businessIds.length > 0 ? database.select().from(businesses).where(inArray(businesses.id, businessIds)) : [],
    profileIds.length > 0 ? database.select().from(profiles).where(inArray(profiles.id, profileIds)) : [],
  ]);

  const calendarMap = new Map(calendarRows.map((row) => [row.id, row]));
  const userMap = new Map(userRows.map((row) => [row.id, row]));
  const buildingMap = new Map(buildingRows.map((row) => [row.id, row]));
  const businessMap = new Map(businessRows.map((row) => [row.id, row]));
  const profileMap = new Map(profileRows.map((row) => [row.id, row]));

  const attendeesByEvent = new Map<number, unknown[]>();
  for (const attendee of attendeeRows) {
    const list = attendeesByEvent.get(attendee.eventId) ?? [];
    list.push({
      attendee,
      profile: attendee.profileId ? profileMap.get(attendee.profileId) ?? null : null,
    });
    attendeesByEvent.set(attendee.eventId, list);
  }

  const remindersByEvent = new Map<number, unknown[]>();
  for (const reminder of reminderRows) {
    const list = remindersByEvent.get(reminder.eventId) ?? [];
    list.push(reminder);
    remindersByEvent.set(reminder.eventId, list);
  }

  const hourLogsByEvent = new Map<number, unknown[]>();
  for (const log of hourLogRows) {
    const list = hourLogsByEvent.get(log.eventId) ?? [];
    list.push({
      log,
      profile: log.loggedByProfileId ? profileMap.get(log.loggedByProfileId) ?? null : null,
    });
    hourLogsByEvent.set(log.eventId, list);
  }

  const confirmationsByEvent = new Map<number, unknown[]>();
  for (const confirmation of confirmationRows) {
    const list = confirmationsByEvent.get(confirmation.eventId) ?? [];
    list.push(confirmation);
    confirmationsByEvent.set(confirmation.eventId, list);
  }

  return eventRows.map((event) => {
    const calendar = calendarMap.get(event.calendarId) ?? null;
    const calendarUser = calendar ? userMap.get(calendar.userId) ?? null : null;
    const building = event.buildingId ? buildingMap.get(event.buildingId) ?? null : null;
    const business = building ? businessMap.get(building.businessId) ?? null : null;
    const assigneeProfile = event.assigneeProfileId ? profileMap.get(event.assigneeProfileId) ?? null : null;
    return {
      event,
      calendar,
      calendarUser,
      building,
      business,
      assigneeProfile,
      attendees: attendeesByEvent.get(event.id) ?? [],
      reminders: remindersByEvent.get(event.id) ?? [],
      hourLogs: hourLogsByEvent.get(event.id) ?? [],
      confirmations: confirmationsByEvent.get(event.id) ?? [],
    };
  });
}

async function writeJoinTableExport(database: DbClient): Promise<JoinTableExportResult> {
  const { exportDir, backupDir, filePath } = getExportPaths();
  await mkdir(exportDir, { recursive: true });

  let backupPath: string | null = null;
  if (fs.existsSync(filePath)) {
    await mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `eaglevents-join-table-${formatBackupTimestamp(new Date())}.xlsx`);
    try {
      await copyFile(filePath, backupPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "EBUSY" || err?.code === "EPERM") {
        throw new Error("Join table export file is locked. Close it and try again.");
      }
      throw error;
    }
  }

  const rows = await loadJoinTableRows(database);
  const matrix = buildMatrix(rows);
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Join Table");
  try {
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await writeFile(filePath, buffer);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "EBUSY" || err?.code === "EPERM" || err?.code === "EACCES") {
      throw new Error("Join table export file is locked. Close it and try again.");
    }
    throw error;
  }

  return {
    updatedAt: new Date().toISOString(),
    filePath,
    backupPath,
    rowCount: rows.length,
  };
}

async function getLastExportTimestamp(filePath: string) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.mtime;
  } catch {
    return null;
  }
}

async function isExportStale(filePath: string) {
  const lastUpdate = await getLastExportTimestamp(filePath);
  if (!lastUpdate) return true;
  return Date.now() - lastUpdate.getTime() >= EXPORT_INTERVAL_MS;
}

export async function getJoinTableExportStatus(): Promise<JoinTableExportStatus> {
  const { filePath, backupDir } = getExportPaths();
  const lastUpdate = await getLastExportTimestamp(filePath);
  const exists = lastUpdate !== null;
  const nextScheduledAt = lastUpdate ? new Date(lastUpdate.getTime() + EXPORT_INTERVAL_MS) : null;
  return {
    filePath,
    backupDirectory: backupDir,
    exists,
    lastUpdatedAt: lastUpdate ? lastUpdate.toISOString() : null,
    nextScheduledAt: nextScheduledAt ? nextScheduledAt.toISOString() : null,
    intervalHours: EXPORT_INTERVAL_MS / (60 * 60 * 1000),
  };
}

export async function refreshJoinTableExport(database: DbClient, force: boolean): Promise<JoinTableExportResult | null> {
  const { filePath } = getExportPaths();
  const shouldUpdate = force || (await isExportStale(filePath));
  if (!shouldUpdate) return null;

  const state = getExportState();
  if (state.running) return state.running;

  const runPromise = writeJoinTableExport(database)
    .catch((error: unknown) => {
      state.running = null;
      throw error;
    })
    .then((result) => {
      state.running = null;
      return result;
    });
  state.running = runPromise;
  return runPromise;
}

export function ensureJoinTableExportScheduler() {
  const state = getExportState();
  if (state.schedulerStarted) return;
  state.schedulerStarted = true;

  const run = async () => {
    try {
      await refreshJoinTableExport(db, false);
    } catch (error) {
      console.error("[join-table-export] scheduled refresh failed", error);
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, SCHEDULER_POLL_MS);
}
