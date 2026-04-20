import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  aggregateRanked,
  buildCoverageSummary,
  computeDurationStats,
  computeOverlapStats,
  computeRequesterProxy,
  defaultAnalyticsFilters,
  resolveAnalyticsDateRange,
  resolveAnalyticsFrequency,
  type AnalyticsEventFact,
} from "~/server/services/admin-analytics";

function makeEvent(overrides: Partial<AnalyticsEventFact> = {}): AnalyticsEventFact {
  return {
    id: 1,
    title: "Sample event",
    start: new Date("2025-01-10T10:00:00.000Z"),
    end: new Date("2025-01-10T12:00:00.000Z"),
    eventStartTime: new Date("2025-01-10T10:30:00.000Z"),
    eventEndTime: new Date("2025-01-10T11:30:00.000Z"),
    setupTime: new Date("2025-01-10T09:30:00.000Z"),
    buildingId: 10,
    buildingLabel: "LIB - Library",
    roomEntities: [{ roomId: 100, roomLabel: "LIB - Library · Room 101", buildingId: 10, buildingLabel: "LIB - Library" }],
    buildingEntities: [{ buildingId: 10, buildingLabel: "LIB - Library" }],
    calendarId: 1,
    calendarName: "Main",
    calendarOwnerUserId: 12,
    calendarOwnerLabel: "Calendar Owner",
    ownerProfileId: 44,
    ownerProfileLabel: "Owner Person",
    assigneeProfileId: 45,
    assigneeProfileLabel: "Assignee Person",
    scopeType: "business",
    scopeId: 1,
    isVirtual: false,
    isAllDay: false,
    participantCount: 100,
    technicianNeeded: true,
    requestCategory: "fgcu_student_affiliated_event",
    requestCategoryLabel: "FGCU student affiliated",
    eventTypes: ["Recording"],
    hasEventTypes: true,
    requesterKey: "owner_profile:44",
    requesterLabel: "Owner Person",
    requesterSource: "owner_profile",
    attendees: [{ attendeeKey: "profile:77", attendeeLabel: "Taylor Example", profileId: 77, email: "taylor@example.com" }],
    scheduledHours: 2,
    programHours: 1,
    setupLeadHours: 1,
    ...overrides,
  };
}

void describe("admin analytics helpers", () => {
  void it("resolves preset ranges and automatic frequency", () => {
    const filters = defaultAnalyticsFilters();
    const range = resolveAnalyticsDateRange(filters, new Date("2025-03-15T12:00:00.000Z"));
    assert.equal(range.start.toISOString(), "2024-04-01T00:00:00.000Z");
    assert.equal(resolveAnalyticsFrequency(filters, range.start, range.end), "month");
  });

  void it("resolves requester proxy with correct precedence", () => {
    const owner = computeRequesterProxy({
      ownerProfileId: 8,
      ownerProfileLabel: "Owner",
      calendarOwnerUserId: 5,
      calendarOwnerLabel: "Calendar",
      scopeType: "business",
      scopeId: 1,
    });
    assert.equal(owner.requesterSource, "owner_profile");

    const calendarOwner = computeRequesterProxy({
      ownerProfileId: null,
      ownerProfileLabel: null,
      calendarOwnerUserId: 5,
      calendarOwnerLabel: "Calendar",
      scopeType: "business",
      scopeId: 1,
    });
    assert.equal(calendarOwner.requesterSource, "calendar_owner");

    const scoped = computeRequesterProxy({
      ownerProfileId: null,
      ownerProfileLabel: null,
      calendarOwnerUserId: null,
      calendarOwnerLabel: null,
      scopeType: "division",
      scopeId: 3,
    });
    assert.equal(scoped.requesterKey, "scope:division:3");
  });

  void it("computes duration stats and coverage percentages", () => {
    const rows = [
      makeEvent({ id: 1, scheduledHours: 1, participantCount: 50 }),
      makeEvent({ id: 2, scheduledHours: 3, participantCount: null, hasEventTypes: false, eventTypes: ["Uncategorized"] }),
      makeEvent({ id: 3, scheduledHours: 2, participantCount: 25 }),
    ];
    const stats = computeDurationStats(rows, "scheduled");
    assert.equal(stats.median, 2);
    assert.equal(stats.p90, 2.8);

    const coverage = buildCoverageSummary(rows);
    assert.equal(coverage.participantCountCoveragePercent, 66.7);
    assert.equal(coverage.eventTypeCoveragePercent, 66.7);
  });

  void it("ranks attendees using attendee records", () => {
    const rows = [
      makeEvent({ id: 1, attendees: [
        { attendeeKey: "profile:77", attendeeLabel: "Taylor Example", profileId: 77, email: "taylor@example.com" },
        { attendeeKey: "profile:78", attendeeLabel: "Jordan Example", profileId: 78, email: "jordan@example.com" },
      ] }),
      makeEvent({ id: 2, attendees: [
        { attendeeKey: "profile:77", attendeeLabel: "Taylor Example", profileId: 77, email: "taylor@example.com" },
      ] }),
    ];
    const ranked = aggregateRanked(rows, "attendee", "eventCount", 5);
    assert.equal(ranked[0]?.label, "Taylor Example");
    assert.equal(ranked[0]?.value, 2);
    assert.equal(ranked[0]?.share, 66.7);
  });

  void it("treats touching events as non-overlapping", () => {
    const rows = [
      makeEvent({
        id: 1,
        start: new Date("2025-01-10T10:00:00.000Z"),
        end: new Date("2025-01-10T11:00:00.000Z"),
      }),
      makeEvent({
        id: 2,
        start: new Date("2025-01-10T11:00:00.000Z"),
        end: new Date("2025-01-10T12:00:00.000Z"),
      }),
    ];
    const overlap = computeOverlapStats(rows, "system");
    assert.equal(overlap.peakConcurrent, 1);
    assert.equal(overlap.overlapHours, 0);
  });

  void it("computes overlap when events actually intersect", () => {
    const rows = [
      makeEvent({
        id: 1,
        start: new Date("2025-01-10T10:00:00.000Z"),
        end: new Date("2025-01-10T12:00:00.000Z"),
      }),
      makeEvent({
        id: 2,
        start: new Date("2025-01-10T11:00:00.000Z"),
        end: new Date("2025-01-10T13:00:00.000Z"),
      }),
    ];
    const overlap = computeOverlapStats(rows, "system");
    assert.equal(overlap.peakConcurrent, 2);
    assert.equal(overlap.overlapHours, 1);
  });
});
