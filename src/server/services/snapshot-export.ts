import fs from "fs";
import path from "path";
import { copyFile, mkdir, stat, writeFile } from "fs/promises";

import { db } from "~/server/db";
import { buildSnapshotPayload, SNAPSHOT_VERSION, type SnapshotPayload } from "~/server/services/snapshot-payload";
import type { db as dbClient } from "~/server/db";

type DbClient = typeof dbClient;

const EXPORT_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SCHEDULER_POLL_MS = 60 * 60 * 1000;
const EXPORT_DIR_NAME = "exports";
const BACKUP_DIR_NAME = "snapshot-backups";
const MAIN_FILENAME = "eaglevents-snapshot.json";
const SYSTEM_NOTE = "Automatic scheduled snapshot export";

export type SnapshotExportResult = {
  updatedAt: string;
  filePath: string;
  backupPath: string | null;
  byteSize: number;
  snapshotVersion: number;
};

export type SnapshotExportStatus = {
  filePath: string;
  backupDirectory: string;
  exists: boolean;
  lastUpdatedAt: string | null;
  nextScheduledAt: string | null;
  intervalHours: number;
  snapshotVersion: number;
};

type SnapshotExportState = {
  running: Promise<SnapshotExportResult> | null;
  schedulerStarted: boolean;
};

type SnapshotPayloadBuilder = () => Promise<SnapshotPayload>;

const GLOBAL_STATE_KEY = "__snapshotExportState";

function getExportState(): SnapshotExportState {
  const globalState = globalThis as typeof globalThis & { [GLOBAL_STATE_KEY]?: SnapshotExportState };
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

async function writeSnapshotExport(buildPayload: SnapshotPayloadBuilder): Promise<SnapshotExportResult> {
  const { exportDir, backupDir, filePath } = getExportPaths();
  await mkdir(exportDir, { recursive: true });

  let backupPath: string | null = null;
  if (fs.existsSync(filePath)) {
    await mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `eaglevents-snapshot-${formatBackupTimestamp(new Date())}.json`);
    try {
      await copyFile(filePath, backupPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "EBUSY" || err?.code === "EPERM" || err?.code === "EACCES") {
        throw new Error("Snapshot export file is locked. Close it and try again.");
      }
      throw error;
    }
  }

  const payload = await buildPayload();
  const contents = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    await writeFile(filePath, contents, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "EBUSY" || err?.code === "EPERM" || err?.code === "EACCES") {
      throw new Error("Snapshot export file is locked. Close it and try again.");
    }
    throw error;
  }

  return {
    updatedAt: payload.exportedAt,
    filePath,
    backupPath,
    byteSize: Buffer.byteLength(contents, "utf8"),
    snapshotVersion: payload.version,
  };
}

async function refreshSnapshotExportWithBuilder(
  force: boolean,
  buildPayload: SnapshotPayloadBuilder,
): Promise<SnapshotExportResult | null> {
  const { filePath } = getExportPaths();
  const shouldUpdate = force || (await isExportStale(filePath));
  if (!shouldUpdate) return null;

  const state = getExportState();
  if (state.running) return state.running;

  const runPromise = writeSnapshotExport(buildPayload)
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

export async function getSnapshotExportStatus(): Promise<SnapshotExportStatus> {
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
    snapshotVersion: SNAPSHOT_VERSION,
  };
}

export async function refreshSnapshotExport(database: DbClient, force: boolean): Promise<SnapshotExportResult | null> {
  return refreshSnapshotExportWithBuilder(force, async () =>
    buildSnapshotPayload(database, {
      note: SYSTEM_NOTE,
      actor: null,
    }),
  );
}

export function ensureSnapshotExportScheduler() {
  const state = getExportState();
  if (state.schedulerStarted) return;
  state.schedulerStarted = true;

  const run = async () => {
    try {
      await refreshSnapshotExport(db, false);
    } catch (error) {
      console.error("[snapshot-export] scheduled refresh failed", error);
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, SCHEDULER_POLL_MS);
}

export const __snapshotExportTestUtils = {
  getExportPaths,
  refreshSnapshotExportWithBuilder,
};
