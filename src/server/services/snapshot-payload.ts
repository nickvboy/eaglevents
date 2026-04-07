import {
  auditLogs,
  buildings,
  businesses,
  calendars,
  dateTimes,
  departments,
  eventAttendees,
  eventCoOwners,
  eventHourLogs,
  eventReminders,
  eventRooms,
  eventZendeskConfirmations,
  events,
  organizationRoles,
  posts,
  profiles,
  rooms,
  themePalettes,
  themeProfiles,
  users,
  visibilityGrants,
} from "~/server/db/schema";
import { eq } from "drizzle-orm";
import type { db as dbClient } from "~/server/db";
import { loadDateTimesByIds } from "~/server/services/date-time";

type DbClient = typeof dbClient;

export const SNAPSHOT_VERSION = 4;

export type SnapshotExportActor = {
  userId: number | null;
  email: string | null;
  displayName: string | null;
};

export type SnapshotPayload = {
  version: typeof SNAPSHOT_VERSION;
  exportedAt: string;
  metadata: {
    app: "eaglevents";
    note?: string;
  };
  exportedBy: SnapshotExportActor;
  data: Awaited<ReturnType<typeof loadSnapshotData>>;
};

function serializeTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeRequiredTimestamp(value: Date | string | null | undefined) {
  const serialized = serializeTimestamp(value);
  if (!serialized) {
    throw new Error("Expected timestamp value.");
  }
  return serialized;
}

function serializeDateOnly(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 10) : null;
}

export async function getSnapshotExportActor(
  db: DbClient,
  userIdRaw: number | string | null | undefined,
): Promise<SnapshotExportActor> {
  const userId = typeof userIdRaw === "number" ? userIdRaw : Number(userIdRaw);
  if (!Number.isFinite(userId) || userId <= 0) {
    return {
      userId: null,
      email: null,
      displayName: null,
    };
  }

  const user = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  return {
    userId: user?.id ?? userId,
    email: user?.email ?? null,
    displayName: user?.displayName ?? null,
  };
}

export async function loadSnapshotData(db: DbClient) {
  const [
    userRows,
    postRows,
    profileRows,
    businessRows,
    buildingRows,
    roomRows,
    departmentRows,
    paletteRows,
    themeProfileRows,
    organizationRoleRows,
    calendarRows,
    dateTimeRows,
    eventRows,
    eventRoomRows,
    eventCoOwnerRows,
    attendeeRows,
    reminderRows,
    hourLogRows,
    confirmationRows,
    visibilityGrantRows,
    auditLogRows,
  ] = await Promise.all([
    db.select().from(users).orderBy(users.id),
    db.select().from(posts).orderBy(posts.id),
    db.select().from(profiles).orderBy(profiles.id),
    db.select().from(businesses).orderBy(businesses.id),
    db.select().from(buildings).orderBy(buildings.id),
    db.select().from(rooms).orderBy(rooms.id),
    db.select().from(departments).orderBy(departments.id),
    db.select().from(themePalettes).orderBy(themePalettes.id),
    db.select().from(themeProfiles).orderBy(themeProfiles.id),
    db.select().from(organizationRoles).orderBy(organizationRoles.id),
    db.select().from(calendars).orderBy(calendars.id),
    db.select().from(dateTimes).orderBy(dateTimes.id),
    db.select().from(events).orderBy(events.id),
    db.select().from(eventRooms).orderBy(eventRooms.id),
    db.select().from(eventCoOwners).orderBy(eventCoOwners.id),
    db.select().from(eventAttendees).orderBy(eventAttendees.id),
    db.select().from(eventReminders).orderBy(eventReminders.id),
    db.select().from(eventHourLogs).orderBy(eventHourLogs.id),
    db.select().from(eventZendeskConfirmations).orderBy(eventZendeskConfirmations.id),
    db.select().from(visibilityGrants).orderBy(visibilityGrants.id),
    db.select().from(auditLogs).orderBy(auditLogs.id),
  ]);

  const eventDateTimeIds = Array.from(
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
  const eventDateTimeRows = eventDateTimeIds.length > 0 ? await loadDateTimesByIds(db, eventDateTimeIds) : [];
  const eventDateTimeMap = new Map(eventDateTimeRows.map((row) => [row.id, row]));

  return {
    users: userRows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      isActive: row.isActive,
      deactivatedAt: serializeTimestamp(row.deactivatedAt),
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    posts: postRows.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    profiles: profileRows.map((row) => ({
      id: row.id,
      userId: row.userId ?? null,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phoneNumber: row.phoneNumber,
      affiliation: row.affiliation ?? null,
      dateOfBirth: serializeDateOnly(row.dateOfBirth ?? null),
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    businesses: businessRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      timeZone: row.timeZone,
      dateFormatConfig: row.dateFormatConfig,
      setupCompletedAt: serializeTimestamp(row.setupCompletedAt),
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    buildings: buildingRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      acronym: row.acronym,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    rooms: roomRows.map((row) => ({
      id: row.id,
      buildingId: row.buildingId,
      roomNumber: row.roomNumber,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    departments: departmentRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      parentDepartmentId: row.parentDepartmentId ?? null,
      name: row.name,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    themePalettes: paletteRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      description: row.description,
      tokens: row.tokens,
      isDefault: row.isDefault,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    themeProfiles: themeProfileRows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      label: row.label,
      description: row.description,
      paletteId: row.paletteId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    organizationRoles: organizationRoleRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      profileId: row.profileId,
      roleType: row.roleType,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    calendars: calendarRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      color: row.color,
      isPrimary: row.isPrimary,
      isPersonal: row.isPersonal,
      isArchived: row.isArchived,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    dateTimes: dateTimeRows.map((row) => ({
      id: row.id,
      instantUtc: serializeRequiredTimestamp(row.instantUtc),
      timeZone: row.timeZone,
      dateKey: row.dateKey,
      fullDate: serializeDateOnly(row.fullDate),
      calendarDate: serializeDateOnly(row.calendarDate),
      dayOfWeekNumber: row.dayOfWeekNumber,
      dayOfWeekName: row.dayOfWeekName,
      year: row.year,
      quarter: row.quarter,
      month: row.month,
      monthLabel: row.monthLabel,
      monthName: row.monthName,
      monthShortName: row.monthShortName,
      isoWeekYear: row.isoWeekYear,
      isoWeek: row.isoWeek,
      isoWeekLabel: row.isoWeekLabel,
      dayOfMonth: row.dayOfMonth,
      dayOfYear: row.dayOfYear,
      weekOfYear: row.weekOfYear,
      dayOfWeekIso: row.dayOfWeekIso,
      dayLabel: row.dayLabel,
      monthNumber: row.monthNumber,
      quarterNumber: row.quarterNumber,
      yearMonthKey: row.yearMonthKey,
      yearMonthLabel: row.yearMonthLabel,
      yearQuarterLabel: row.yearQuarterLabel,
      weekStartDate: serializeDateOnly(row.weekStartDate),
      weekEndDate: serializeDateOnly(row.weekEndDate),
      monthStartDate: serializeDateOnly(row.monthStartDate),
      monthEndDate: serializeDateOnly(row.monthEndDate),
      quarterStartDate: serializeDateOnly(row.quarterStartDate),
      quarterEndDate: serializeDateOnly(row.quarterEndDate),
      yearStartDate: serializeDateOnly(row.yearStartDate),
      yearEndDate: serializeDateOnly(row.yearEndDate),
      isWeekday: row.isWeekday,
      isWeekend: row.isWeekend,
      isBusinessDay: row.isBusinessDay,
      isMonthStart: row.isMonthStart,
      isMonthEnd: row.isMonthEnd,
      isQuarterStart: row.isQuarterStart,
      isQuarterEnd: row.isQuarterEnd,
      isYearStart: row.isYearStart,
      isYearEnd: row.isYearEnd,
      hour24: row.hour24,
      minute: row.minute,
      second: row.second,
      isoDate: row.isoDate,
      isoDateTime: row.isoDateTime,
      usDate: row.usDate,
      usDateTime: row.usDateTime,
      dateIsoFormat: row.dateIsoFormat,
      dateUsFormat: row.dateUsFormat,
      dateLongFormat: row.dateLongFormat,
      monthYearText: row.monthYearText,
      quarterYearLabel: row.quarterYearLabel,
      previousDate: serializeDateOnly(row.previousDate),
      nextDate: serializeDateOnly(row.nextDate),
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
    events: eventRows.map((row) => ({
      id: row.id,
      calendarId: row.calendarId,
      buildingId: row.buildingId ?? null,
      assigneeProfileId: row.assigneeProfileId ?? null,
      ownerProfileId: row.ownerProfileId ?? null,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      eventCode: row.eventCode,
      title: row.title,
      description: row.description ?? null,
      location: row.location ?? null,
      isVirtual: row.isVirtual,
      isAllDay: row.isAllDay,
      startDateTimeId: row.startDateTimeId,
      endDateTimeId: row.endDateTimeId,
      eventStartDateTimeId: row.eventStartDateTimeId ?? null,
      eventEndDateTimeId: row.eventEndDateTimeId ?? null,
      setupDateTimeId: row.setupDateTimeId ?? null,
      startDatetime: serializeRequiredTimestamp(eventDateTimeMap.get(row.startDateTimeId)?.instantUtc),
      endDatetime: serializeRequiredTimestamp(eventDateTimeMap.get(row.endDateTimeId)?.instantUtc),
      recurrenceRule: row.recurrenceRule ?? null,
      participantCount: row.participantCount ?? null,
      technicianNeeded: row.technicianNeeded,
      requestCategory: row.requestCategory ?? null,
      equipmentNeeded: row.equipmentNeeded ?? null,
      requestDetails: row.requestDetails ?? null,
      eventStartTime: serializeTimestamp(
        row.eventStartDateTimeId ? eventDateTimeMap.get(row.eventStartDateTimeId)?.instantUtc : null,
      ),
      eventEndTime: serializeTimestamp(
        row.eventEndDateTimeId ? eventDateTimeMap.get(row.eventEndDateTimeId)?.instantUtc : null,
      ),
      setupTime: serializeTimestamp(
        row.setupDateTimeId ? eventDateTimeMap.get(row.setupDateTimeId)?.instantUtc : null,
      ),
      zendeskTicketNumber: row.zendeskTicketNumber ?? null,
      isArchived: row.isArchived,
      createdAt: serializeRequiredTimestamp(row.createdAt),
      updatedAt: serializeTimestamp(row.updatedAt),
    })),
    eventRooms: eventRoomRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      roomId: row.roomId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
    eventCoOwners: eventCoOwnerRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      profileId: row.profileId,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
    eventAttendees: attendeeRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      profileId: row.profileId ?? null,
      email: row.email,
      responseStatus: row.responseStatus,
    })),
    eventReminders: reminderRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      reminderMinutes: row.reminderMinutes,
    })),
    eventHourLogs: hourLogRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      loggedByProfileId: row.loggedByProfileId ?? null,
      startTime: serializeRequiredTimestamp(row.startTime),
      endTime: serializeRequiredTimestamp(row.endTime),
      durationMinutes: row.durationMinutes,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
    eventZendeskConfirmations: confirmationRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      profileId: row.profileId,
      confirmedAt: serializeRequiredTimestamp(row.confirmedAt),
    })),
    visibilityGrants: visibilityGrantRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      createdByUserId: row.createdByUserId ?? null,
      reason: row.reason,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
    auditLogs: auditLogRows.map((row) => ({
      id: row.id,
      businessId: row.businessId ?? null,
      actorUserId: row.actorUserId ?? null,
      actorProfileId: row.actorProfileId ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      scopeType: row.scopeType ?? null,
      scopeId: row.scopeId ?? null,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: serializeRequiredTimestamp(row.createdAt),
    })),
  };
}

export async function buildSnapshotPayload(
  db: DbClient,
  options?: {
    note?: string;
    actor?: SnapshotExportActor | null;
    exportedAt?: string;
  },
): Promise<SnapshotPayload> {
  const note = options?.note?.trim() ? options.note.trim() : undefined;
  const actor = options?.actor ?? null;
  return {
    version: SNAPSHOT_VERSION,
    exportedAt: options?.exportedAt ?? new Date().toISOString(),
    metadata: {
      app: "eaglevents",
      ...(note ? { note } : {}),
    },
    exportedBy: {
      userId: actor?.userId ?? null,
      email: actor?.email ?? null,
      displayName: actor?.displayName ?? null,
    },
    data: await loadSnapshotData(db),
  };
}
