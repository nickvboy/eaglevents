import "dotenv/config";
import "tsconfig-paths/register";

import { faker } from "@faker-js/faker";
import type { Session } from "next-auth";

type SeedMode = "workspace" | "events" | "full" | "revert";
type TargetDb = "dev" | "prod";
type DbModule = typeof import("~/server/db");
type DbClient = DbModule["db"];

type CliOptions = {
  mode: SeedMode;
  target: TargetDb;
  eventCount: number;
  fakerSeed: number | null;
};

type Caller = ReturnType<(typeof import("~/server/api/root"))["appRouter"]["createCaller"]>;

const businessTypeValues = ["university", "nonprofit", "corporation", "government", "venue", "other"] as const;
const requestCategoryValues = [
  "university_affiliated_request_to_university_business",
  "university_affiliated_nonrequest_to_university_business",
  "fgcu_student_affiliated_event",
  "non_affiliated_or_revenue_generating_event",
] as const;

const ARG_HELP = `
Usage: pnpm tsx scripts/seed.ts [--mode workspace|events|full|revert] [--target dev|prod] [--events <count>] [--seed <number>]

Examples:
  pnpm tsx scripts/seed.ts --mode full
  pnpm tsx scripts/seed.ts --mode events --events 25
  pnpm tsx scripts/seed.ts --mode full --target prod --seed 1234
  pnpm tsx scripts/seed.ts --mode revert
`.trim();

const FULL_SEED_YEARS = 7;
const FULL_SEED_MONTHS = FULL_SEED_YEARS * 12;
const FULL_MODE_EVENTS_PER_MONTH = 5;
const DEFAULT_FULL_EVENT_COUNT = FULL_SEED_MONTHS * FULL_MODE_EVENTS_PER_MONTH;

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  configureDatabaseTarget(options.target);

  try {
    const [{ db }] = await Promise.all([import("~/server/db")]);

    if (options.mode === "revert") {
      await revertSeededData(db);
      return;
    }

    if (options.fakerSeed !== null) {
      faker.seed(options.fakerSeed);
    }

    const [{ appRouter }, { createTRPCContext }, { ensurePrimaryCalendars }] = await Promise.all([
      import("~/server/api/root"),
      import("~/server/api/trpc"),
      import("~/server/services/calendar"),
    ]);

    const buildHeaders = () => {
      const headers = new Headers();
      headers.set("x-trpc-source", "seed-script");
      headers.set("x-seed-mode", options.mode);
      return headers;
    };

    const createCallerForSession = async (session?: Session | null): Promise<Caller> => {
      const context = await createTRPCContext({
        headers: buildHeaders(),
        session: session ?? null,
      });
      return appRouter.createCaller(context);
    };

    const ensureCalendarId = async (userId: number) => {
      const calendars = await ensurePrimaryCalendars(db, userId);
      const primary = calendars.find((cal) => cal.isPrimary) ?? calendars[0];
      if (!primary) {
        throw new Error(`Failed to resolve calendar for user ${userId}`);
      }
      return primary.id;
    };

    if (options.mode === "workspace" || options.mode === "full") {
      await seedWorkspace(createCallerForSession);
    }

    if (options.mode === "events" || options.mode === "full") {
      await seedEvents({
        createCallerForSession,
        ensureCalendarId,
        eventCount: options.eventCount,
        mode: options.mode,
      });
    }

    console.log("✅ Seeding completed");
  } catch (error) {
    console.error("❌ Seeding failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  let mode: SeedMode = "full";
  let target: TargetDb = "dev";
  let eventCount: number | null = null;
  let eventCountProvided = false;
  let fakerSeed: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      // pnpm forwards a literal `--` when double-dashed arguments are used in scripts; skip it.
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(ARG_HELP);
      process.exit(0);
    }
    if (arg.startsWith("--mode=")) {
      mode = parseMode(arg.split("=")[1] ?? "");
      continue;
    }
    if (arg === "--mode") {
      const value = argv[i + 1];
      if (!value) throw new Error("--mode expects a value");
      i += 1;
      mode = parseMode(value);
      continue;
    }
    if (arg.startsWith("--target=")) {
      target = parseTarget(arg.split("=")[1] ?? "");
      continue;
    }
    if (arg === "--target") {
      const value = argv[i + 1];
      if (!value) throw new Error("--target expects a value");
      i += 1;
      target = parseTarget(value);
      continue;
    }
    if (arg.startsWith("--events=")) {
      eventCount = parseIntSafe(arg.split("=")[1] ?? "", "--events");
      eventCountProvided = true;
      continue;
    }
    if (arg === "--events") {
      const value = argv[i + 1];
      if (!value) throw new Error("--events expects a value");
      i += 1;
      eventCount = parseIntSafe(value, "--events");
      eventCountProvided = true;
      continue;
    }
    if (arg.startsWith("--seed=")) {
      fakerSeed = parseIntSafe(arg.split("=")[1] ?? "", "--seed");
      continue;
    }
    if (arg === "--seed") {
      const value = argv[i + 1];
      if (!value) throw new Error("--seed expects a value");
      i += 1;
      fakerSeed = parseIntSafe(value, "--seed");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!eventCountProvided) {
    eventCount = mode === "full" ? DEFAULT_FULL_EVENT_COUNT : mode === "revert" ? 0 : 15;
  }
  if (eventCount! < 0) {
    throw new Error("--events must be zero or positive");
  }

  return { mode, target, eventCount: eventCount!, fakerSeed };
}

function parseMode(value: string): SeedMode {
  if (value === "workspace" || value === "events" || value === "full" || value === "revert") return value;
  throw new Error("Invalid --mode. Expected workspace|events|full|revert");
}

function parseTarget(value: string): TargetDb {
  if (value === "dev" || value === "prod") return value;
  throw new Error("Invalid --target. Expected dev|prod");
}

function parseIntSafe(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for ${flag}`);
  }
  return parsed;
}

function configureDatabaseTarget(target: TargetDb) {
  if (target === "prod") {
    const prodUrl = process.env.DATABASE_URL_PROD;
    if (!prodUrl) {
      throw new Error("DATABASE_URL_PROD is not set");
    }
    process.env.DATABASE_URL = prodUrl;
    console.log("🔌 Using production database URL");
  } else {
    const devUrl = process.env.DATABASE_URL;
    if (!devUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    console.log("🔌 Using development database URL");
  }
}

async function revertSeededData(dbClient: DbClient) {
  const [{ getSetupStatus }, schema] = await Promise.all([import("~/server/services/setup"), import("~/server/db/schema")]);
  const status = await getSetupStatus(dbClient);
  if (!status.business && status.databaseClean) {
    console.log("ℹ️ Database already appears clean; nothing to revert.");
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
  console.log(`🧹 Removed workspace data${label}. You can rerun pnpm seed to repopulate.`);
}

async function seedWorkspace(createCallerForSession: (session?: Session | null) => Promise<Caller>) {
  const caller = await createCallerForSession();
  let status = await caller.setup.status();

  if (!status.business) {
    const name = `${faker.company.name()} Events`;
    const type = faker.helpers.arrayElement(businessTypeValues);
    console.log(`🏢 Creating business: ${name} (${type})`);
    await caller.setup.createBusiness({ name, type });
    status = await caller.setup.status();
  } else {
    console.log(`ℹ️ Business already exists (${status.business.name})`);
  }

  if (status.buildings.length === 0) {
    const buildingInputs = createBuildingInputs();
    console.log(`🏗️ Adding ${buildingInputs.length} buildings with rooms`);
    await caller.setup.createBuildings({ buildings: buildingInputs });
    status = await caller.setup.status();
  } else {
    console.log(`ℹ️ Skipping buildings (already have ${status.buildings.length})`);
  }

  if (status.departments.flat.length === 0) {
    const departmentInputs = createDepartmentInputs();
    console.log(`🏬 Adding ${departmentInputs.departments.length} departments/divisions`);
    await caller.setup.createDepartments(departmentInputs);
    status = await caller.setup.status();
  } else {
    console.log(`ℹ️ Skipping departments (already have ${status.departments.flat.length})`);
  }

  if (status.missingAdmins.length > 0) {
    console.log(`👥 Generating default users for ${status.missingAdmins.length} scopes`);
    await caller.setup.createDefaultUsers();
    status = await caller.setup.status();
  } else {
    console.log("ℹ️ All scopes already have admins");
  }

  if (status.needsSetup && status.readyForCompletion) {
    console.log("✅ Completing setup");
    await caller.setup.completeSetup();
  } else if (!status.needsSetup) {
    console.log("ℹ️ Setup already completed");
  } else {
    console.log("⚠️ Setup not ready for completion yet. Rerun once prerequisites exist.");
  }
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

async function seedEvents({
  createCallerForSession,
  ensureCalendarId,
  eventCount,
  mode,
}: {
  createCallerForSession: (session?: Session | null) => Promise<Caller>;
  ensureCalendarId: (userId: number) => Promise<number>;
  eventCount: number;
  mode: SeedMode;
}) {
  if (eventCount === 0) {
    console.log("ℹ️ Skipping event seeding (requested count 0)");
    return;
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
  const hourMs = 60 * 60 * 1000;
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

  console.log(`📅 Seeded ${createdEvents.length} events`);
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

void main();
