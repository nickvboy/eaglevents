import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSnapshotImport } from "~/server/services/snapshot-import";

const BASE_TIMESTAMP = "2026-04-07T12:00:00.000Z";

function createMinimalSnapshot(version: 2 | 3 | 4) {
  return {
    version,
    exportedAt: BASE_TIMESTAMP,
    metadata: {
      app: "eaglevents" as const,
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
      buildings: [],
      rooms: [],
      departments: [],
      themePalettes: [],
      themeProfiles: [],
      organizationRoles: [],
      calendars: [],
      events: [],
      eventRooms: [],
      eventCoOwners: [],
      eventAttendees: [],
      eventReminders: [],
      eventHourLogs: [],
      eventZendeskConfirmations: [],
      visibilityGrants: [],
      auditLogs: [],
    },
  };
}

void test("normalizeSnapshotImport applies legacy defaults for missing optional sections", () => {
  const normalized = normalizeSnapshotImport(createMinimalSnapshot(2));

  assert.deepEqual(normalized.data.dateTimes, []);
  assert.deepEqual(normalized.data.eventRooms, []);
  assert.deepEqual(normalized.data.events, []);
});

void test("normalizeSnapshotImport preserves supported legacy versions", () => {
  const normalizedV3 = normalizeSnapshotImport(createMinimalSnapshot(3));
  const normalizedV4 = normalizeSnapshotImport(createMinimalSnapshot(4));

  assert.equal(normalizedV3.version, 3);
  assert.equal(normalizedV4.version, 4);
});
