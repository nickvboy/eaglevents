import assert from "node:assert/strict";
import test from "node:test";

import { __eventTransferTestUtils } from "~/server/services/event-transfer";

void test("event transfer workbook exposes human-readable and hidden columns", () => {
  const headers = __eventTransferTestUtils.WORKBOOK_COLUMNS.map((column) => column.header);

  assert.deepEqual(headers.slice(0, 8), [
    "Action",
    "Event ID",
    "Title",
    "Description",
    "Start Date",
    "Start Time",
    "End Date",
    "End Time",
  ]);
  assert.ok(headers.includes("Attendee Profile IDs"));
  assert.ok(headers.includes("Request Details Version"));
});

void test("event transfer workbook marks hidden machine-key columns as hidden", () => {
  const sheet = __eventTransferTestUtils.buildWorkbookSheetRows([
    {
      action: "Update",
      eventId: "42",
      title: "Sample Event",
      description: "",
      startDate: "2026-04-10",
      startTime: "09:00",
      endDate: "2026-04-10",
      endTime: "10:00",
      allDay: "No",
      virtual: "No",
      calendar: "Operations",
      building: "Library",
      rooms: "101 [8]",
      locationOverride: "",
      assignee: "Taylor Example <taylor@example.com>",
      coOwners: "",
      attendees: "Taylor Example <taylor@example.com>",
      participantCount: "5",
      technicianNeeded: "No",
      requestCategory: "",
      equipmentNeeded: "",
      equipmentOtherDetails: "",
      eventTypes: "",
      eventTypeOtherDetails: "",
      setupTime: "",
      zendeskTicket: "",
      recurrenceRule: "",
      status: "Existing",
      eventCode: "1234567",
      lastUpdated: "",
      importNotes: "",
      templateVersion: "1",
      calendarId: "3",
      buildingId: "6",
      roomIds: "8",
      assigneeProfileId: "12",
      coOwnerProfileIds: "",
      attendeeProfileIds: "12",
      requestDetailsVersion: "2",
    },
  ]);

  const hiddenColumns = (sheet["!cols"] ?? [])
    .map((column, index) => ({ hidden: column.hidden, header: __eventTransferTestUtils.WORKBOOK_COLUMNS[index]?.header }))
    .filter((column) => column.hidden)
    .map((column) => column.header);

  assert.deepEqual(hiddenColumns, [
    "Template Version",
    "Calendar ID",
    "Building ID",
    "Room IDs",
    "Assignee Profile ID",
    "Co-Owner Profile IDs",
    "Attendee Profile IDs",
    "Request Details Version",
  ]);
});

void test("event transfer workbook row mapping requires workbook headers", () => {
  const sheet = __eventTransferTestUtils.buildWorkbookSheetRows([
    {
      action: "Update",
      eventId: "42",
      title: "Sample Event",
      description: "",
      startDate: "2026-04-10",
      startTime: "09:00",
      endDate: "2026-04-10",
      endTime: "10:00",
      allDay: "No",
      virtual: "No",
      calendar: "Operations",
      building: "",
      rooms: "",
      locationOverride: "",
      assignee: "",
      coOwners: "",
      attendees: "Taylor Example <taylor@example.com>",
      participantCount: "",
      technicianNeeded: "No",
      requestCategory: "",
      equipmentNeeded: "",
      equipmentOtherDetails: "",
      eventTypes: "",
      eventTypeOtherDetails: "",
      setupTime: "",
      zendeskTicket: "",
      recurrenceRule: "",
      status: "Existing",
      eventCode: "1234567",
      lastUpdated: "",
      importNotes: "",
      templateVersion: "1",
      calendarId: "3",
      buildingId: "",
      roomIds: "",
      assigneeProfileId: "",
      coOwnerProfileIds: "",
      attendeeProfileIds: "12",
      requestDetailsVersion: "",
    },
  ]);

  const rows = __eventTransferTestUtils.mapWorksheetRows(sheet);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.record.Title, "Sample Event");
  assert.equal(rows[0]?.record["Attendee Profile IDs"], "12");
});

void test("event transfer workbook date helpers round-trip local date/time intent", () => {
  const utc = __eventTransferTestUtils.zonedDateTimeToUtc(
    { year: 2026, month: 4, day: 10, hour: 9, minute: 30, second: 0 },
    "America/New_York",
  );

  assert.equal(__eventTransferTestUtils.formatDateInTimeZone(utc, "America/New_York"), "2026-04-10");
  assert.equal(__eventTransferTestUtils.formatTimeInTimeZone(utc, "America/New_York"), "09:30");
});

void test("event transfer workbook list parsing uses semicolons for visible values", () => {
  assert.deepEqual(__eventTransferTestUtils.splitVisibleList("One; Two ; Three"), ["One", "Two", "Three"]);
  assert.deepEqual(__eventTransferTestUtils.splitHiddenIdList("5|8|13"), [5, 8, 13]);
});

void test("event transfer workbook parses visible profile tokens for lookup or creation", () => {
  assert.deepEqual(
    __eventTransferTestUtils.parseProfileImportToken("Taylor Example <taylor@example.com>"),
    {
      raw: "Taylor Example <taylor@example.com>",
      displayName: "Taylor Example",
      email: "taylor@example.com",
    },
  );

  assert.deepEqual(__eventTransferTestUtils.parseProfileImportToken("taylor@example.com"), {
    raw: "taylor@example.com",
    displayName: null,
    email: "taylor@example.com",
  });
});

void test("event transfer workbook derives valid fallback names for auto-created profiles", () => {
  assert.deepEqual(
    __eventTransferTestUtils.deriveProfileNameParts(
      __eventTransferTestUtils.parseProfileImportToken("Taylor Example <taylor@example.com>"),
    ),
    {
      firstName: "Taylor",
      lastName: "Example",
    },
  );

  assert.deepEqual(
    __eventTransferTestUtils.deriveProfileNameParts(
      __eventTransferTestUtils.parseProfileImportToken("solo@example.com"),
    ),
    {
      firstName: "solo",
      lastName: "Imported",
    },
  );
});
