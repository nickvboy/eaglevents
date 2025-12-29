import { faker } from "@faker-js/faker";
import type { Session } from "next-auth";

import type { db } from "~/server/db";

type DbClient = typeof db;
type Caller = ReturnType<(typeof import("~/server/api/root"))["appRouter"]["createCaller"]>;

export type SeedMode = "workspace" | "events" | "full" | "revert";

export type SeedRunOptions = {
  mode: SeedMode;
  eventCount: number;
  fakerSeed: number | null;
};

export type SeedRunResult = {
  mode: SeedMode;
  eventCount: number;
  seededEvents: number;
};

export type SeedRuntime = {
  db: DbClient;
  createCallerForSession: (session?: Session | null) => Promise<Caller>;
  ensureCalendarId: (userId: number) => Promise<number>;
  log?: (message: string) => void;
};

const businessTypeValues = ["university", "nonprofit", "corporation", "government", "venue", "other"] as const;
const requestCategoryValues = [
  "university_affiliated_request_to_university_business",
  "university_affiliated_nonrequest_to_university_business",
  "fgcu_student_affiliated_event",
  "non_affiliated_or_revenue_generating_event",
] as const;

const FULL_SEED_YEARS = 7;
const FULL_SEED_MONTHS = FULL_SEED_YEARS * 12;
const FULL_MODE_EVENTS_PER_MONTH = 5;
export const DEFAULT_FULL_EVENT_COUNT = FULL_SEED_MONTHS * FULL_MODE_EVENTS_PER_MONTH;
export const DEFAULT_EVENT_COUNT = 15;

export function getDefaultEventCount(mode: SeedMode) {
  if (mode === "full") return DEFAULT_FULL_EVENT_COUNT;
  if (mode === "revert") return 0;
  return DEFAULT_EVENT_COUNT;
}

export async function runSeed(options: SeedRunOptions, runtime: SeedRuntime): Promise<SeedRunResult> {
  const log = runtime.log ?? (() => {});

  if (options.mode === "revert") {
    await revertSeededData(runtime.db, log);
    return { mode: options.mode, eventCount: options.eventCount, seededEvents: 0 };
  }

  if (options.fakerSeed !== null) {
    faker.seed(options.fakerSeed);
  }

  if (options.mode === "workspace" || options.mode === "full") {
    await seedWorkspace(runtime.createCallerForSession, log);
  }

  let seededEvents = 0;
  if (options.mode === "events" || options.mode === "full") {
    seededEvents = await seedEvents({
      createCallerForSession: runtime.createCallerForSession,
      ensureCalendarId: runtime.ensureCalendarId,
      eventCount: options.eventCount,
      mode: options.mode,
      log,
    });
  }

  return { mode: options.mode, eventCount: options.eventCount, seededEvents };
}

export async function revertSeededData(dbClient: DbClient, log: (message: string) => void) {
  const [{ getSetupStatus }, schema] = await Promise.all([import("~/server/services/setup"), import("~/server/db/schema")]);
  const status = await getSetupStatus(dbClient);
  if (!status.business && status.databaseClean) {
    log("Database already appears clean; nothing to revert.");
    return;
  }

  await dbClient.transaction(async (tx) => {
    await tx.delete(schema.eventZendeskConfirmations);
    await tx.delete(schema.eventHourLogs);
    await tx.delete(schema.eventReminders);
    await tx.delete(schema.eventAttendees);
    await tx.delete(schema.events);
    await tx.delete(schema.calendars);
    await tx.delete(schema.organizationRoles);
    await tx.delete(schema.themeProfiles);
    await tx.delete(schema.themePalettes);
    await tx.delete(schema.rooms);
    await tx.delete(schema.buildings);
    await tx.delete(schema.departments);
    await tx.delete(schema.profiles);
    await tx.delete(schema.users);
    await tx.delete(schema.businesses);
  });

  const label = status.business ? ` for ${status.business.name}` : "";
  log(`Removed workspace data${label}. You can rerun the seed to repopulate.`);
}

export async function seedWorkspace(
  createCallerForSession: (session?: Session | null) => Promise<Caller>,
  log: (message: string) => void,
) {
  const caller = await createCallerForSession();
  let status = await caller.setup.status();

  if (!status.business) {
    const name = `${faker.company.name()} Events`;
    const type = faker.helpers.arrayElement(businessTypeValues);
    log(`Creating business: ${name} (${type})`);
    await caller.setup.createBusiness({ name, type });
    status = await caller.setup.status();
  } else {
    log(`Skipping business (already exists as ${status.business.name})`);
  }

  if (status.buildings.length === 0) {
    const buildingInputs = createBuildingInputs();
    log(`Adding ${buildingInputs.length} buildings with rooms`);
    await caller.setup.createBuildings({ buildings: buildingInputs });
    status = await caller.setup.status();
  } else {
    log(`Skipping buildings (already have ${status.buildings.length})`);
  }

  if (status.departments.flat.length === 0) {
    const departmentInputs = createDepartmentInputs();
    log(`Adding ${departmentInputs.departments.length} departments/divisions`);
    await caller.setup.createDepartments(departmentInputs);
    status = await caller.setup.status();
  } else {
    log(`Skipping departments (already have ${status.departments.flat.length})`);
  }

  if (status.missingAdmins.length > 0) {
    log(`Generating default users for ${status.missingAdmins.length} scopes`);
    await caller.setup.createDefaultUsers();
    status = await caller.setup.status();
  } else {
    log("All scopes already have admins");
  }

  if (status.needsSetup && status.readyForCompletion) {
    log("Completing setup");
    await caller.setup.completeSetup(undefined);
  } else if (!status.needsSetup) {
    log("Setup already completed");
  } else {
    log("Setup not ready for completion yet. Rerun once prerequisites exist.");
  }
}

export async function seedEvents({
  createCallerForSession,
  ensureCalendarId,
  eventCount,
  mode,
  log,
}: {
  createCallerForSession: (session?: Session | null) => Promise<Caller>;
  ensureCalendarId: (userId: number) => Promise<number>;
  eventCount: number;
  mode: SeedMode;
  log: (message: string) => void;
}) {
  if (eventCount === 0) {
    log("Skipping event seeding (requested count 0)");
    return 0;
  }

  const caller = await createCallerForSession();
  const status = await caller.setup.status();
  if (!status.business) {
    throw new Error("Workspace is not initialized. Seed workspace data first.");
  }
  if (status.roles.length === 0) {
    throw new Error("No users available to assign events.");
  }

  const profilePool = Array.from(
    status.roles.reduce((acc, role) => {
      if (!role.profile || !role.user) return acc;
      if (!acc.has(role.profile.id)) {
        acc.set(role.profile.id, {
          profileId: role.profile.id,
          userId: role.user.id,
          name: `${role.profile.firstName} ${role.profile.lastName}`,
          email: role.profile.email,
        });
      }
      return acc;
    }, new Map<number, { profileId: number; userId: number; name: string; email: string }>()),
  ).map(([, value]) => value);

  if (profilePool.length === 0) {
    throw new Error("No profiles linked to users were found.");
  }

  const buildingPool = status.buildings;
  const createdEvents: Array<{ id: number; summary: string }> = [];
  const startDates =
    mode === "full" ? buildHistoricalStartDates(eventCount) : buildUpcomingStartDates(eventCount);

  for (const start of startDates) {
    const owner = faker.helpers.arrayElement(profilePool);
    const session = buildSession(owner);
    const userCaller = await createCallerForSession(session);
    const calendarId = await ensureCalendarId(owner.userId);

    const durationHours = faker.number.int({ min: 1, max: 4 });
    const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

    const building = buildingPool.length > 0 ? faker.helpers.arrayElement(buildingPool) : null;
    const room = building && building.rooms.length > 0 ? faker.helpers.arrayElement(building.rooms) : null;
    const attendeeIds = faker.helpers.arrayElements(
      profilePool.filter((profile) => profile.profileId !== owner.profileId),
      faker.number.int({ min: 0, max: 3 }),
    ).map((profile) => profile.profileId);

    const includeHours = faker.number.int({ min: 0, max: 99 }) < 65;
    const hourLogs =
      includeHours && faker.number.int({ min: 0, max: 99 }) > 30
        ? (() => {
            const minutes = faker.number.int({ min: 30, max: durationHours * 60 });
            return [
              {
                startTime: start,
                endTime: new Date(start.getTime() + minutes * 60 * 1000),
              },
            ];
          })()
        : undefined;

    const zendeskTicketNumber = faker.number.int({ min: 0, max: 99 }) < 40 ? `ZD${faker.string.numeric(6)}` : undefined;
    const description = faker.lorem.paragraph();
    const event = await userCaller.event.create({
      calendarId,
      title: `${faker.company.buzzAdjective()} ${faker.word.words({ count: { min: 1, max: 3 } })}`.replace(/\b\w/g, (c) => c.toUpperCase()),
      description,
      location: building && room ? `${building.acronym} ${room.roomNumber}` : faker.location.streetAddress(),
      buildingId: building?.id ?? null,
      isAllDay: false,
      startDatetime: start,
      endDatetime: end,
      assigneeProfileId: owner.profileId,
      attendeeProfileIds: attendeeIds,
      participantCount: faker.number.int({ min: 10, max: 250 }),
      technicianNeeded: faker.number.int({ min: 0, max: 99 }) < 50,
      requestCategory: faker.helpers.arrayElement(requestCategoryValues),
      equipmentNeeded: faker.number.int({ min: 0, max: 99 }) < 60 ? faker.commerce.productDescription() : undefined,
      eventStartTime: new Date(start.getTime() - 30 * 60 * 1000),
      eventEndTime: new Date(end.getTime() + 30 * 60 * 1000),
      setupTime: new Date(start.getTime() - 60 * 60 * 1000),
      zendeskTicketNumber,
      hourLogs,
    });

    createdEvents.push({ id: event.id, summary: event.title });

    if (hourLogs && faker.number.int({ min: 0, max: 99 }) < 50) {
      await userCaller.event.confirmZendesk({ eventId: event.id });
    }
  }

  log(`Seeded ${createdEvents.length} events`);
  return createdEvents.length;
}

function createBuildingInputs() {
  const count = faker.number.int({ min: 2, max: 3 });
  const inputs: { name: string; acronym: string; rooms: string[] }[] = [];
  const usedAcronyms = new Set<string>();

  for (let i = 0; i < count; i++) {
    let acronym: string;
    do {
      acronym = faker.string.alpha({ length: faker.number.int({ min: 3, max: 5 }), casing: "upper" });
    } while (usedAcronyms.has(acronym));
    usedAcronyms.add(acronym);

    const name = `${faker.company.buzzAdjective()} ${faker.helpers.arrayElement(["Hall", "Center", "Auditorium", "Annex"])}`;
    const roomCount = faker.number.int({ min: 3, max: 6 });
    const rooms = Array.from({ length: roomCount }, () => `${faker.number.int({ min: 100, max: 699 })}${faker.helpers.arrayElement(["", "A", "B"])}`.trim());

    inputs.push({
      name,
      acronym,
      rooms: Array.from(new Set(rooms)),
    });
  }
  return inputs;
}

function createDepartmentInputs() {
  const departmentCount = faker.number.int({ min: 2, max: 3 });
  const departments = Array.from({ length: departmentCount }, () => ({
    name: `${faker.company.catchPhraseNoun()} Department`,
    divisions: faker.helpers.maybe(
      () =>
        Array.from({ length: faker.number.int({ min: 1, max: 2 }) }, () => ({
          name: `${faker.commerce.department()} Division`,
        })),
      { probability: 0.8 },
    ) ?? [],
  }));
  return {
    departments: departments.map((dept) => ({
      name: dept.name,
      divisions: dept.divisions && dept.divisions.length > 0 ? dept.divisions : undefined,
    })),
  };
}

function buildHistoricalStartDates(eventCount: number): Date[] {
  const dates: Date[] = [];
  const now = new Date();

  for (let monthOffset = 0; monthOffset < FULL_SEED_MONTHS && dates.length < eventCount; monthOffset++) {
    const bucketStart = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const bucketEnd = new Date(bucketStart.getFullYear(), bucketStart.getMonth() + 1, 0, 23, 59, 59, 999);
    const remainingMonths = FULL_SEED_MONTHS - monthOffset;
    const remainingEvents = eventCount - dates.length;
    const eventsThisBucket = Math.max(1, Math.floor(remainingEvents / remainingMonths));

    for (let i = 0; i < eventsThisBucket && dates.length < eventCount; i++) {
      dates.push(faker.date.between({ from: bucketStart, to: bucketEnd }));
    }
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

function buildUpcomingStartDates(eventCount: number): Date[] {
  const dates: Date[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;

  for (let index = 0; index < eventCount; index++) {
    const startDayOffset = faker.number.int({ min: 0, max: 90 });
    const startHourOffset = faker.number.int({ min: 0, max: 8 });
    dates.push(new Date(now + startDayOffset * dayMs + startHourOffset * hourMs));
  }

  return dates;
}

function buildSession(profile: { userId: number; name: string; email: string }): Session {
  const now = Date.now();
  return {
    user: {
      id: String(profile.userId),
      email: profile.email,
      name: profile.name,
    },
    expires: new Date(now + 60 * 60 * 1000).toISOString(),
  };
}
