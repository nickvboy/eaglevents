import { faker } from "@faker-js/faker";
import { and, eq, inArray } from "drizzle-orm";
import type { Session } from "next-auth";

import type { db } from "~/server/db";
import type { appRouter } from "~/server/api/root";
import { calendars } from "~/server/db/schema";
import { ensurePrimaryCalendars } from "~/server/services/calendar";

type DbClient = typeof db;
type Caller = ReturnType<typeof appRouter.createCaller>;
type EventCreateInput = Parameters<Caller["event"]["create"]>[0];
type SetupStatus = Awaited<ReturnType<Caller["setup"]["status"]>>;
type SeedRoleSummary = SetupStatus["roles"][number];

export type SeedMode = "workspace" | "events" | "full" | "revert";

export type DepartmentEventTarget = {
  scopeType: "department" | "division";
  scopeId: number;
  eventCount: number;
};

export type SeedRunOptions = {
  mode: SeedMode;
  eventCount: number;
  fakerSeed: number | null;
  departmentEventTargets?: DepartmentEventTarget[];
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
const MAX_CONCURRENT_EVENT_REQUESTS = 2;
const CALENDAR_COLORS = ["#22c55e", "#0ea5e9", "#f97316", "#e11d48", "#a855f7", "#14b8a6"];
const PERSONAL_CALENDAR_SAMPLE_RATE = 0.1;
const PERSONAL_CALENDAR_SAMPLE_MAX = 3;
const RATE_LIMIT_RETRY_ATTEMPTS = 6;
const RATE_LIMIT_BACKOFF_MS = 1500;
const ROLE_PRIORITY: Record<SeedRoleSummary["roleType"], number> = {
  admin: 4,
  co_admin: 3,
  manager: 2,
  employee: 1,
};

export function getDefaultEventCount(mode: SeedMode) {
  if (mode === "full") return DEFAULT_FULL_EVENT_COUNT;
  if (mode === "revert") return 0;
  return DEFAULT_EVENT_COUNT;
}

export async function runSeed(options: SeedRunOptions, runtime: SeedRuntime): Promise<SeedRunResult> {
  const log = runtime.log ?? (() => undefined);

  if (options.mode === "revert") {
    await revertSeededData(runtime.db, log);
    return { mode: options.mode, eventCount: options.eventCount, seededEvents: 0 };
  }

  if (options.fakerSeed !== null) {
    faker.seed(options.fakerSeed);
  }

  if (options.mode === "workspace" || options.mode === "full") {
    await seedWorkspace(runtime.db, runtime.createCallerForSession, log);
  }

  let seededEvents = 0;
  if (options.mode === "events" || options.mode === "full") {
    seededEvents = await seedEvents({
      db: runtime.db,
      createCallerForSession: runtime.createCallerForSession,
      ensureCalendarId: runtime.ensureCalendarId,
      eventCount: options.eventCount,
      departmentEventTargets: options.departmentEventTargets ?? [],
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
    await tx.delete(schema.eventCoOwners);
    await tx.delete(schema.events);
    await tx.delete(schema.calendars);
    await tx.delete(schema.organizationRoles);
    await tx.delete(schema.visibilityGrants);
    await tx.delete(schema.auditLogs);
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
  dbClient: DbClient,
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

  await ensureDepartmentCalendars(dbClient, status, log);
  await ensureSamplePersonalCalendars(dbClient, status, log);

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
  db,
  createCallerForSession,
  ensureCalendarId,
  eventCount,
  departmentEventTargets,
  mode,
  log,
}: {
  db: DbClient;
  createCallerForSession: (session?: Session | null) => Promise<Caller>;
  ensureCalendarId: (userId: number) => Promise<number>;
  eventCount: number;
  departmentEventTargets: DepartmentEventTarget[];
  mode: SeedMode;
  log: (message: string) => void;
}) {
  const caller = await createCallerForSession();
  const status = await caller.setup.status();
  if (!status.business) {
    throw new Error("Workspace is not initialized. Seed workspace data first.");
  }
  if (status.roles.length === 0) {
    throw new Error("No users available to assign events.");
  }

  const profilePoolMap = new Map<number, { profileId: number; userId: number; name: string; email: string }>();
  const scopeProfileMap = new Map<string, Map<number, { profileId: number; userId: number; name: string; email: string }>>();

  for (const role of status.roles) {
    if (!role.profile || !role.user) continue;
    let profile = profilePoolMap.get(role.profile.id);
    if (!profile) {
      profile = {
        profileId: role.profile.id,
        userId: role.user.id,
        name: `${role.profile.firstName} ${role.profile.lastName}`,
        email: role.profile.email,
      };
      profilePoolMap.set(role.profile.id, profile);
    }

    const scopeKey = `${role.scopeType}:${role.scopeId}`;
    let scopeBucket = scopeProfileMap.get(scopeKey);
    if (!scopeBucket) {
      scopeBucket = new Map();
      scopeProfileMap.set(scopeKey, scopeBucket);
    }
    scopeBucket.set(profile.profileId, profile);
  }

  const profilePool = Array.from(profilePoolMap.values());
  const businessAdminPool = status.roles
    .filter(
      (role) =>
        role.scopeType === "business" &&
        (role.roleType === "admin" || role.roleType === "co_admin") &&
        role.profile,
    )
    .map((role) => profilePoolMap.get(role.profile!.id))
    .filter(Boolean) as Array<{ profileId: number; userId: number; name: string; email: string }>;

  if (profilePool.length === 0) {
    throw new Error("No profiles linked to users were found.");
  }

  const departmentCalendars = await ensureDepartmentCalendars(db, status, log);
  await ensureSamplePersonalCalendars(db, status, log);

  const buildingPool = status.buildings;
  const departmentLookup = new Map(status.departments.flat.map((dept) => [dept.id, dept]));
  const buildStartDates = mode === "full" ? buildHistoricalStartDates : buildUpcomingStartDates;

  const createEventsForScope = async ({
    ownerPool,
    targetEventCount,
    label,
    calendarId,
  }: {
    ownerPool: Array<{ profileId: number; userId: number; name: string; email: string }>;
    targetEventCount: number;
    label?: string;
    calendarId?: number;
  }) => {
    if (targetEventCount === 0) {
      log(`Skipping event seeding${label ? ` for ${label}` : ""} (requested count 0)`);
      return 0;
    }
    if (ownerPool.length === 0) {
      log(`Skipping event seeding${label ? ` for ${label}` : ""} (no eligible users)`);
      return 0;
    }

    const startDates = buildStartDates(targetEventCount);

    const callerCache = new Map<number, Promise<Caller>>();
    const calendarCache = new Map<number, Promise<number>>();

    const getCallerForOwner = (owner: { userId: number; name: string; email: string }) => {
      let cached = callerCache.get(owner.userId);
      if (!cached) {
        cached = createCallerForSession(buildSession(owner));
        callerCache.set(owner.userId, cached);
      }
      return cached;
    };

    const getCalendarIdForOwner = (owner: { userId: number; name: string; email: string }) => {
      if (calendarId) return Promise.resolve(calendarId);
      let cached = calendarCache.get(owner.userId);
      if (!cached) {
        cached = ensureCalendarId(owner.userId);
        calendarCache.set(owner.userId, cached);
      }
      return cached;
    };

    const seedSpecs = startDates.map((start) => {
      const owner = faker.helpers.arrayElement(ownerPool);
      const durationHours = faker.number.int({ min: 1, max: 4 });
      const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

      const building = buildingPool.length > 0 ? faker.helpers.arrayElement(buildingPool) : null;
      const room = building && building.rooms.length > 0 ? faker.helpers.arrayElement(building.rooms) : null;
      const attendeeIds = faker.helpers
        .arrayElements(
          profilePool.filter((profile) => profile.profileId !== owner.profileId),
          faker.number.int({ min: 0, max: 3 }),
        )
        .map((profile) => profile.profileId);

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

      const zendeskTicketNumber =
        faker.number.int({ min: 0, max: 99 }) < 40 ? faker.string.numeric(6) : undefined;
      const description = faker.lorem.paragraph();
      const confirmZendesk = Boolean(hourLogs) && faker.number.int({ min: 0, max: 99 }) < 50;

      const eventInputBase: Omit<EventCreateInput, "calendarId"> = {
        title: `${faker.company.buzzAdjective()} ${faker.word.words({ count: { min: 1, max: 3 } })}`.replace(
          /\b\w/g,
          (c) => c.toUpperCase(),
        ),
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
      };

      return {
        owner,
        eventInputBase,
        confirmZendesk,
      };
    });

    let createdCount = 0;

    await runWithConcurrency(seedSpecs, MAX_CONCURRENT_EVENT_REQUESTS, async (spec) => {
      const [userCaller, resolvedCalendarId] = await Promise.all([
        getCallerForOwner(spec.owner),
        getCalendarIdForOwner(spec.owner),
      ]);

      const event = await withRateLimitRetry(
        () =>
          userCaller.event.create({
            ...spec.eventInputBase,
            calendarId: resolvedCalendarId,
          }),
        log,
      );

      createdCount += 1;

      if (spec.confirmZendesk) {
        await withRateLimitRetry(() => userCaller.event.confirmZendesk({ eventId: event.id }), log);
      }
    });

    log(`Seeded ${createdCount} events${label ? ` for ${label}` : ""}`);
    return createdCount;
  };

  let seededEvents = 0;
  for (const target of departmentEventTargets) {
    const scopeType = target.scopeType;
    const department = departmentLookup.get(target.scopeId);
    if (!department) {
      log(`Skipping ${scopeType}:${target.scopeId} (department not found)`);
      continue;
    }
    const isDivision = department.parentDepartmentId !== null;
    if (scopeType === "department" && isDivision) {
      log(`Skipping ${department.name} (expected department, found division)`);
      continue;
    }
    if (scopeType === "division" && !isDivision) {
      log(`Skipping ${department.name} (expected division, found department)`);
      continue;
    }

    const scopeKey = buildScopeKey(scopeType, target.scopeId);
    const scopeProfiles = Array.from(scopeProfileMap.get(scopeKey)?.values() ?? []);
    const ownerPool = scopeProfiles.length > 0 ? scopeProfiles : businessAdminPool;
    if (ownerPool.length === 0) {
      log(`Skipping ${department.name} (${scopeType}) (no eligible users)`);
      continue;
    }

    const calendarEntry = departmentCalendars.get(scopeKey);
    if (!calendarEntry) {
      log(`Skipping ${department.name} (${scopeType}) (calendar not found)`);
      continue;
    }

    seededEvents += await createEventsForScope({
      ownerPool,
      targetEventCount: target.eventCount,
      label: `${department.name} (${scopeType})`,
      calendarId: calendarEntry.calendarId,
    });
  }

  if (eventCount === 0 && departmentEventTargets.length === 0) {
    log("Skipping event seeding (requested count 0)");
    return 0;
  }

  if (eventCount > 0) {
    const calendarTargets = Array.from(departmentCalendars.values())
      .map((entry) => {
        const scopeKey = buildScopeKey(entry.scopeType, entry.scopeId);
        const scopeProfiles = Array.from(scopeProfileMap.get(scopeKey)?.values() ?? []);
        const ownerPool = scopeProfiles.length > 0 ? scopeProfiles : businessAdminPool;
        if (ownerPool.length === 0) {
          log(`Skipping ${entry.label} (${entry.scopeType}) (no eligible users)`);
          return null;
        }
        return {
          ...entry,
          ownerPool,
        };
      })
      .filter(Boolean) as Array<{
      calendarId: number;
      scopeType: "department" | "division";
      scopeId: number;
      label: string;
      ownerPool: Array<{ profileId: number; userId: number; name: string; email: string }>;
    }>;

    if (calendarTargets.length > 0) {
      const baseCount = Math.floor(eventCount / calendarTargets.length);
      const remainder = eventCount % calendarTargets.length;
      for (const [index, target] of calendarTargets.entries()) {
        const count = baseCount + (index < remainder ? 1 : 0);
        if (count === 0) continue;
        seededEvents += await createEventsForScope({
          ownerPool: target.ownerPool,
          targetEventCount: count,
          label: `${target.label} (${target.scopeType})`,
          calendarId: target.calendarId,
        });
      }
    } else {
      seededEvents += await createEventsForScope({
        ownerPool: profilePool,
        targetEventCount: eventCount,
      });
    }
  }

  return seededEvents;
}

function buildScopeKey(scopeType: "department" | "division", scopeId: number) {
  return `${scopeType}:${scopeId}`;
}

function pickRoleUserId(roles: SeedRoleSummary[], fallbackUserId: number | null) {
  if (roles.length === 0) return fallbackUserId;
  const sorted = roles
    .slice()
    .filter((role) => role.userId)
    .sort((a, b) => (ROLE_PRIORITY[b.roleType] ?? 0) - (ROLE_PRIORITY[a.roleType] ?? 0));
  return sorted[0]?.userId ?? fallbackUserId;
}

async function ensureDepartmentCalendars(
  dbClient: DbClient,
  status: SetupStatus,
  log: (message: string) => void,
) {
  const scopes = new Map<string, { scopeType: "department" | "division"; scopeId: number; label: string }>();
  for (const department of status.departments.flat) {
    const scopeType = department.parentDepartmentId === null ? "department" : "division";
    const scopeKey = buildScopeKey(scopeType, department.id);
    if (!scopes.has(scopeKey)) {
      scopes.set(scopeKey, { scopeType, scopeId: department.id, label: department.name });
    }
  }

  if (scopes.size === 0) {
    log("No departments found; skipping department calendars.");
    return new Map<string, { calendarId: number; scopeType: "department" | "division"; scopeId: number; label: string }>();
  }

  const existing = await dbClient
    .select({
      id: calendars.id,
      scopeType: calendars.scopeType,
      scopeId: calendars.scopeId,
    })
    .from(calendars)
    .where(and(eq(calendars.isPersonal, false), inArray(calendars.scopeType, ["department", "division"])));

  const byScope = new Map<string, { calendarId: number; scopeType: "department" | "division"; scopeId: number; label: string }>();
  for (const row of existing) {
    if (row.scopeType !== "department" && row.scopeType !== "division") continue;
    const scopeKey = buildScopeKey(row.scopeType, row.scopeId);
    const scope = scopes.get(scopeKey);
    if (!scope) continue;
    byScope.set(scopeKey, { calendarId: row.id, scopeType: row.scopeType, scopeId: row.scopeId, label: scope.label });
  }

  const rolesByScope = new Map<string, SeedRoleSummary[]>();
  for (const role of status.roles) {
    if (role.scopeType !== "department" && role.scopeType !== "division") continue;
    const key = buildScopeKey(role.scopeType, role.scopeId);
    const bucket = rolesByScope.get(key);
    if (bucket) {
      bucket.push(role);
    } else {
      rolesByScope.set(key, [role]);
    }
  }

  const fallbackUserId =
    status.roles.find((role) => role.scopeType === "business" && role.roleType === "admin")?.userId ??
    status.roles.find((role) => role.scopeType === "business" && role.roleType === "co_admin")?.userId ??
    status.roles[0]?.userId ??
    null;

  let createdCount = 0;

  for (const [scopeKey, scope] of scopes) {
    if (byScope.has(scopeKey)) continue;
    const ownerUserId = pickRoleUserId(rolesByScope.get(scopeKey) ?? [], fallbackUserId);
    if (!ownerUserId) {
      log(`Skipping calendar for ${scope.label} (${scope.scopeType}) (no eligible user)`);
      continue;
    }
    const calendarName =
      scope.scopeType === "division" ? `${scope.label} Division Calendar` : `${scope.label} Calendar`;
    const [created] = await dbClient
      .insert(calendars)
      .values({
        userId: ownerUserId,
        name: calendarName,
        color: faker.helpers.arrayElement(CALENDAR_COLORS),
        isPrimary: false,
        isPersonal: false,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      })
      .returning({ id: calendars.id });
    if (created) {
      byScope.set(scopeKey, {
        calendarId: created.id,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        label: scope.label,
      });
      createdCount += 1;
    }
  }

  if (createdCount > 0) {
    log(`Created ${createdCount} department calendars.`);
  }

  return byScope;
}

async function ensureSamplePersonalCalendars(
  dbClient: DbClient,
  status: SetupStatus,
  log: (message: string) => void,
) {
  const userIds = Array.from(new Set(status.roles.map((role) => role.userId)));
  if (userIds.length === 0) return;

  const targetCount = Math.min(
    userIds.length,
    Math.max(1, Math.min(PERSONAL_CALENDAR_SAMPLE_MAX, Math.round(userIds.length * PERSONAL_CALENDAR_SAMPLE_RATE))),
  );

  const existing = await dbClient
    .select({ userId: calendars.userId })
    .from(calendars)
    .where(and(eq(calendars.isPersonal, true), inArray(calendars.userId, userIds)));
  const existingSet = new Set(existing.map((row) => row.userId));
  const candidates = userIds.filter((userId) => !existingSet.has(userId));
  if (candidates.length === 0) return;

  const selected = faker.helpers.shuffle(candidates).slice(0, targetCount);
  if (selected.length === 0) return;

  for (const userId of selected) {
    await ensurePrimaryCalendars(dbClient, userId);
  }
  log(`Ensured personal calendars for ${selected.length} users.`);
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
  const weekDayCycle = shuffleWeekdays();
  let weekdayIndex = 0;

  for (let monthOffset = 0; monthOffset < FULL_SEED_MONTHS && dates.length < eventCount; monthOffset++) {
    const bucketStart = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const bucketEnd = new Date(bucketStart.getFullYear(), bucketStart.getMonth() + 1, 0, 23, 59, 59, 999);
    const remainingMonths = FULL_SEED_MONTHS - monthOffset;
    const remainingEvents = eventCount - dates.length;
    const eventsThisBucket = Math.max(1, Math.floor(remainingEvents / remainingMonths));

    for (let i = 0; i < eventsThisBucket && dates.length < eventCount; i++) {
      const weekday = weekDayCycle[weekdayIndex % weekDayCycle.length] ?? 0;
      weekdayIndex += 1;
      const date = pickDateForWeekdayInRange(bucketStart, bucketEnd, weekday) ?? faker.date.between({ from: bucketStart, to: bucketEnd });
      dates.push(date);
    }
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

function buildUpcomingStartDates(eventCount: number): Date[] {
  const dates: Date[] = [];
  const now = new Date();
  const rangeStart = new Date(now);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + 90);

  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / dayMs));
  const candidateDates: Date[] = [];

  for (let dayOffset = 0; dayOffset <= totalDays; dayOffset++) {
    const day = new Date(rangeStart.getTime() + dayOffset * dayMs);
    const startHourOffset = faker.number.int({ min: 0, max: 8 });
    day.setHours(8 + startHourOffset, 0, 0, 0);
    candidateDates.push(day);
  }

  const weekdays = shuffleWeekdays();
  const weekdayBuckets = new Map<number, Date[]>();
  for (const candidate of candidateDates) {
    const weekday = candidate.getDay();
    const bucket = weekdayBuckets.get(weekday);
    if (bucket) {
      bucket.push(candidate);
    } else {
      weekdayBuckets.set(weekday, [candidate]);
    }
  }

  let weekdayIndex = 0;
  for (let index = 0; index < eventCount; index++) {
    const weekday = weekdays[weekdayIndex % weekdays.length] ?? 0;
    weekdayIndex += 1;
    const bucket = weekdayBuckets.get(weekday) ?? [];
    const candidate =
      bucket.length > 0
        ? bucket.splice(faker.number.int({ min: 0, max: bucket.length - 1 }), 1)[0] ??
          faker.helpers.arrayElement(candidateDates)
        : faker.helpers.arrayElement(candidateDates);
    const jitterHours = faker.number.int({ min: 0, max: 4 });
    const jitterMinutes = faker.number.int({ min: 0, max: 59 });
    dates.push(new Date(candidate.getTime() + jitterHours * hourMs + jitterMinutes * 60 * 1000));
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
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

function shuffleWeekdays() {
  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  return faker.helpers.shuffle(weekdays);
}

function pickDateForWeekdayInRange(start: Date, end: Date, weekday: number) {
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const candidates: Date[] = [];
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getDay() === weekday) {
      const date = new Date(cursor);
      date.setHours(faker.number.int({ min: 8, max: 16 }), faker.number.int({ min: 0, max: 59 }), 0, 0);
      candidates.push(date);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (candidates.length === 0) return null;
  return faker.helpers.arrayElement(candidates);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  const runners = Array.from({ length: safeLimit }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) break;
      await worker(items[current] as T);
    }
  });

  await Promise.all(runners);
}

async function withRateLimitRetry<T>(action: () => Promise<T>, log: (message: string) => void) {
  let attempt = 0;
  while (true) {
    try {
      return await action();
    } catch (error) {
      attempt += 1;
      const message = error instanceof Error ? error.message : String(error);
      const retrySeconds = parseRetryAfterSeconds(message);
      const shouldRetry = message.toLowerCase().includes("too many requests") && attempt <= RATE_LIMIT_RETRY_ATTEMPTS;
      if (!shouldRetry) throw error;
      const delayMs = retrySeconds ? retrySeconds * 1000 : RATE_LIMIT_BACKOFF_MS * attempt;
      log(`Rate limit hit; retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt}).`);
      await sleep(delayMs);
    }
  }
}

function parseRetryAfterSeconds(message: string) {
  const match = /try again in (\d+)s/i.exec(message);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
