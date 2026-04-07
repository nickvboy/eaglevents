import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  __snapshotExportTestUtils,
  getSnapshotExportStatus,
} from "~/server/services/snapshot-export";
import type { SnapshotPayload } from "~/server/services/snapshot-payload";

const BASE_PAYLOAD: SnapshotPayload = {
  version: 4 as const,
  exportedAt: "2026-04-02T12:00:00.000Z",
  metadata: {
    app: "eaglevents" as const,
    note: "Automatic scheduled snapshot export",
  },
  exportedBy: {
    userId: null,
    email: null,
    displayName: null,
  },
  data: {
    users: [],
    posts: [],
    profiles: [],
    businesses: [],
    departments: [],
    buildings: [],
    rooms: [],
    dateTimes: [],
    themePalettes: [],
    themeProfiles: [],
    organizationRoles: [],
    visibilityGrants: [],
    calendars: [],
    events: [],
    eventRooms: [],
    eventCoOwners: [],
    eventAttendees: [],
    eventReminders: [],
    eventHourLogs: [],
    eventZendeskConfirmations: [],
    auditLogs: [],
  },
};

async function withTempCwd(fn: (tempDir: string) => Promise<void>) {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eaglevents-snapshot-export-"));
  process.chdir(tempDir);
  try {
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function waitFor(condition: () => boolean, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition.");
}

void test("snapshot export refresh writes files, backups, and status metadata", async () => {
  await withTempCwd(async () => {
    let buildCount = 0;
    const buildPayload = async () => {
      buildCount += 1;
      return {
        ...BASE_PAYLOAD,
        exportedAt: buildCount === 1 ? "2026-04-02T12:00:00.000Z" : "2026-04-02T13:00:00.000Z",
      };
    };

    const first = await __snapshotExportTestUtils.refreshSnapshotExportWithBuilder(true, buildPayload);
    assert.ok(first);
    assert.equal(first.snapshotVersion, 4);
    const firstContents = await fs.readFile(first.filePath, "utf8");
    assert.match(firstContents, /2026-04-02T12:00:00\.000Z/);

    const second = await __snapshotExportTestUtils.refreshSnapshotExportWithBuilder(true, buildPayload);
    assert.ok(second);
    assert.ok(second.backupPath);
    const backupContents = await fs.readFile(second.backupPath, "utf8");
    assert.match(backupContents, /2026-04-02T12:00:00\.000Z/);

    const status = await getSnapshotExportStatus();
    assert.equal(status.exists, true);
    assert.equal(status.snapshotVersion, 4);
    assert.ok(status.lastUpdatedAt);
    assert.ok(status.nextScheduledAt);
  });
});

void test("snapshot export skips non-forced refresh when the export is still fresh", async () => {
  await withTempCwd(async () => {
    const created = await __snapshotExportTestUtils.refreshSnapshotExportWithBuilder(true, async () => BASE_PAYLOAD);
    assert.ok(created);

    let buildCount = 0;
    const skipped = await __snapshotExportTestUtils.refreshSnapshotExportWithBuilder(false, async () => {
      buildCount += 1;
      return BASE_PAYLOAD;
    });

    assert.equal(skipped, null);
    assert.equal(buildCount, 0);
  });
});

void test("snapshot export shares an in-flight refresh promise", async () => {
  await withTempCwd(async () => {
    let resolvePayload: (value: SnapshotPayload) => void = () => undefined;
    let hasResolvePayload = false;
    let buildCount = 0;
    const builder = () =>
      new Promise<SnapshotPayload>((resolve) => {
        buildCount += 1;
        resolvePayload = resolve;
        hasResolvePayload = true;
      });

    const firstPromise = __snapshotExportTestUtils.refreshSnapshotExportWithBuilder(true, builder);
    const secondPromise = __snapshotExportTestUtils.refreshSnapshotExportWithBuilder(true, builder);

    await waitFor(() => hasResolvePayload);
    assert.equal(buildCount, 1);

    resolvePayload(BASE_PAYLOAD);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.deepEqual(first, second);
  });
});
