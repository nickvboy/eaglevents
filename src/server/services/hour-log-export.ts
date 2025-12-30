import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { inArray } from "drizzle-orm";
import { mkdir, stat, copyFile, writeFile } from "fs/promises";

import { db } from "~/server/db";
import {
  buildings,
  calendars,
  eventHourLogs,
  events,
  profiles,
  users,
} from "~/server/db/schema";

type DbClient = typeof db;

const EXPORT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SCHEDULER_POLL_MS = 60 * 60 * 1000;
const EXPORT_DIR_NAME = "exports";
const BACKUP_DIR_NAME = "hour-log-backups";
const MAIN_FILENAME = "eaglevents-hour-logs.xlsx";

type HourLogExportResult = {
  updatedAt: string;
  filePath: string;
  backupPath: string | null;
  rowCount: number;
};

type HourLogExportStatus = {
  filePath: string;
  backupDirectory: string;
  exists: boolean;
  lastUpdatedAt: string | null;
  nextScheduledAt: string | null;
  intervalHours: number;
};

type HourLogExportState = {
  running: Promise<HourLogExportResult> | null;
  schedulerStarted: boolean;
};

const GLOBAL_STATE_KEY = "__hourLogExportState";

function getExportState(): HourLogExportState {
  const globalState = globalThis as typeof globalThis & { [GLOBAL_STATE_KEY]?: HourLogExportState };
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

function formatSheetName(value: string) {
  const cleaned = value.replace(/[\\/*?:[\]]/g, " ").trim();
  if (!cleaned) return "Unknown";
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
}

function formatTimestamp(value: Date | null) {
  return value ? value.toISOString() : "";
}

function formatReadableTimestamp(value: Date | null) {
  return value ? value.toLocaleString() : "";
}

async function loadHourLogData(database: DbClient) {
  const logs = await database.select().from(eventHourLogs).orderBy(eventHourLogs.id);
  if (logs.length === 0) return { logs, events: [], calendars: [], buildings: [], profiles: [], users: [] };

  const eventIds = Array.from(new Set(logs.map((log) => log.eventId)));
  const profileIds = Array.from(
    new Set(logs.map((log) => log.loggedByProfileId).filter((id): id is number => typeof id === "number")),
  );

  const eventRows = await database.select().from(events).where(inArray(events.id, eventIds));
  const calendarIds = Array.from(new Set(eventRows.map((row) => row.calendarId)));
  const buildingIds = Array.from(
    new Set(eventRows.map((row) => row.buildingId).filter((id): id is number => typeof id === "number")),
  );

  const [calendarRows, buildingRows, profileRows] = await Promise.all([
    database.select().from(calendars).where(inArray(calendars.id, calendarIds)),
    buildingIds.length > 0 ? database.select().from(buildings).where(inArray(buildings.id, buildingIds)) : [],
    profileIds.length > 0 ? database.select().from(profiles).where(inArray(profiles.id, profileIds)) : [],
  ]);

  const userIds = Array.from(
    new Set(profileRows.map((row) => row.userId).filter((id): id is number => typeof id === "number")),
  );
  const userRows = userIds.length > 0 ? await database.select().from(users).where(inArray(users.id, userIds)) : [];

  return {
    logs,
    events: eventRows,
    calendars: calendarRows,
    buildings: buildingRows,
    profiles: profileRows,
    users: userRows,
  };
}

function buildWorkbook(data: Awaited<ReturnType<typeof loadHourLogData>>) {
  const eventMap = new Map(data.events.map((row) => [row.id, row]));
  const calendarMap = new Map(data.calendars.map((row) => [row.id, row]));
  const buildingMap = new Map(data.buildings.map((row) => [row.id, row]));
  const profileMap = new Map(data.profiles.map((row) => [row.id, row]));
  const userMap = new Map(data.users.map((row) => [row.id, row]));

  const grouped = new Map<string, Array<Array<string | number>>>();
  const headers = [
    "Log ID",
    "User Name",
    "User Email",
    "Profile Email",
    "Profile Phone",
    "Event Title",
    "Event Code",
    "Zendesk Ticket",
    "Event Start",
    "Event Start (Local)",
    "Event End",
    "Event End (Local)",
    "Calendar",
    "Location",
    "Building",
    "Logged Start",
    "Logged Start (Local)",
    "Logged End",
    "Logged End (Local)",
    "Duration Minutes",
  ];

  for (const log of data.logs) {
    const event = eventMap.get(log.eventId);
    const calendar = event ? calendarMap.get(event.calendarId) : null;
    const building = event?.buildingId ? buildingMap.get(event.buildingId) ?? null : null;
    const profile = log.loggedByProfileId ? profileMap.get(log.loggedByProfileId) ?? null : null;
    const user = profile?.userId ? userMap.get(profile.userId) ?? null : null;

    const userDisplayName = user?.displayName?.trim();
    const profileName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : "";
    const displayName = userDisplayName && userDisplayName.length > 0 ? userDisplayName : profileName;
    const profileEmail = profile?.email?.trim();
    const sheetLabel = displayName && displayName.length > 0 ? displayName : profileEmail ?? "Unknown";
    const sheetKey = formatSheetName(sheetLabel);
    const rows = grouped.get(sheetKey) ?? [];

    rows.push([
      log.id,
      displayName && displayName.length > 0 ? displayName : "Unknown",
      user?.email ?? "",
      profile?.email ?? "",
      profile?.phoneNumber ?? "",
      event?.title ?? "",
      event?.eventCode ?? "",
      event?.zendeskTicketNumber ?? "",
      formatTimestamp(event?.startDatetime ?? null),
      formatReadableTimestamp(event?.startDatetime ?? null),
      formatTimestamp(event?.endDatetime ?? null),
      formatReadableTimestamp(event?.endDatetime ?? null),
      calendar?.name ?? "",
      event?.location ?? "",
      building?.name ?? "",
      formatTimestamp(log.startTime),
      formatReadableTimestamp(log.startTime),
      formatTimestamp(log.endTime),
      formatReadableTimestamp(log.endTime),
      log.durationMinutes ?? 0,
    ]);

    grouped.set(sheetKey, rows);
  }

  const workbook = XLSX.utils.book_new();
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  const allRows = sortedKeys.flatMap((key) => grouped.get(key) ?? []);
  const allWorksheet = XLSX.utils.aoa_to_sheet([headers, ...allRows]);
  XLSX.utils.book_append_sheet(workbook, allWorksheet, "All Logs");
  for (const key of sortedKeys) {
    const rows = grouped.get(key) ?? [];
    const matrix = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.utils.book_append_sheet(workbook, worksheet, key);
  }

  if (sortedKeys.length === 0) {
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Empty");
  }

  return { workbook, rowCount: data.logs.length };
}

async function writeHourLogExport(database: DbClient): Promise<HourLogExportResult> {
  const { exportDir, backupDir, filePath } = getExportPaths();
  await mkdir(exportDir, { recursive: true });

  let backupPath: string | null = null;
  if (fs.existsSync(filePath)) {
    await mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `eaglevents-hour-logs-${formatBackupTimestamp(new Date())}.xlsx`);
    try {
      await copyFile(filePath, backupPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "EBUSY" || err?.code === "EPERM" || err?.code === "EACCES") {
        throw new Error("Hour log export file is locked. Close it and try again.");
      }
      throw error;
    }
  }

  const data = await loadHourLogData(database);
  const { workbook, rowCount } = buildWorkbook(data);
  try {
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await writeFile(filePath, buffer);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "EBUSY" || err?.code === "EPERM" || err?.code === "EACCES") {
      throw new Error("Hour log export file is locked. Close it and try again.");
    }
    throw error;
  }

  return {
    updatedAt: new Date().toISOString(),
    filePath,
    backupPath,
    rowCount,
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

export async function getHourLogExportStatus(): Promise<HourLogExportStatus> {
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

export async function refreshHourLogExport(database: DbClient, force: boolean): Promise<HourLogExportResult | null> {
  const { filePath } = getExportPaths();
  const shouldUpdate = force || (await isExportStale(filePath));
  if (!shouldUpdate) return null;

  const state = getExportState();
  if (state.running) return state.running;

  const runPromise = writeHourLogExport(database)
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

export function ensureHourLogExportScheduler() {
  const state = getExportState();
  if (state.schedulerStarted) return;
  state.schedulerStarted = true;

  const run = async () => {
    try {
      await refreshHourLogExport(db, false);
    } catch (error) {
      console.error("[hour-log-export] scheduled refresh failed", error);
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, SCHEDULER_POLL_MS);
}
