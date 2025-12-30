import "dotenv/config";
import "tsconfig-paths/register";

import type { Session } from "next-auth";

import { getDefaultEventCount, runSeed } from "~/server/services/seed";
import type { DepartmentEventTarget } from "~/server/services/seed";

type SeedMode = "workspace" | "events" | "full" | "revert";
type TargetDb = "dev" | "prod";

type CliOptions = {
  mode: SeedMode;
  target: TargetDb;
  eventCount: number;
  fakerSeed: number | null;
  departmentEventTargets: DepartmentEventTarget[];
};

type Caller = ReturnType<(typeof import("~/server/api/root"))["appRouter"]["createCaller"]>;

const ARG_HELP = `
Usage: pnpm tsx scripts/seed.ts [--mode workspace|events|full|revert] [--target dev|prod] [--events <count>] [--seed <number>] [--department-events <scope:id=count,...>]

Examples:
  pnpm tsx scripts/seed.ts --mode full
  pnpm tsx scripts/seed.ts --mode events --events 25
  pnpm tsx scripts/seed.ts --mode events --department-events department:12=40,division:15=10
  pnpm tsx scripts/seed.ts --mode full --target prod --seed 1234
  pnpm tsx scripts/seed.ts --mode revert
`.trim();

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  configureDatabaseTarget(options.target);

  try {
    const [{ db }] = await Promise.all([import("~/server/db")]);

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

    await runSeed(
      {
        mode: options.mode,
        eventCount: options.eventCount,
        fakerSeed: options.fakerSeed,
        departmentEventTargets: options.departmentEventTargets,
      },
      {
        db,
        createCallerForSession,
        ensureCalendarId,
        log: console.log,
      },
    );

    console.log("Seeding completed.");
  } catch (error) {
    console.error("Seeding failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  let mode: SeedMode = "full";
  let target: TargetDb = "dev";
  let eventCount: number | null = null;
  let eventCountProvided = false;
  let fakerSeed: number | null = null;
  let departmentEventTargets: DepartmentEventTarget[] = [];

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
    if (arg.startsWith("--department-events=")) {
      departmentEventTargets = mergeDepartmentEventTargets(
        departmentEventTargets,
        parseDepartmentEventTargets(arg.split("=")[1] ?? ""),
      );
      continue;
    }
    if (arg === "--department-events") {
      const value = argv[i + 1];
      if (!value) throw new Error("--department-events expects a value");
      i += 1;
      departmentEventTargets = mergeDepartmentEventTargets(departmentEventTargets, parseDepartmentEventTargets(value));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!eventCountProvided) {
    eventCount = getDefaultEventCount(mode);
  }
  if (eventCount! < 0) {
    throw new Error("--events must be zero or positive");
  }

  return { mode, target, eventCount: eventCount!, fakerSeed, departmentEventTargets };
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

function parseDepartmentEventTargets(value: string): DepartmentEventTarget[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const entries = trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
  const results: DepartmentEventTarget[] = [];

  for (const entry of entries) {
    const [scopePart, countPart] = entry.split("=");
    if (!scopePart || countPart === undefined) {
      throw new Error(`Invalid --department-events entry "${entry}". Expected <scopeType>:<scopeId>=<count>.`);
    }
    const [scopeType, scopeIdRaw] = scopePart.split(":");
    if (scopeType !== "department" && scopeType !== "division") {
      throw new Error(`Invalid scope type "${scopeType}" in --department-events (use department or division).`);
    }
    const scopeId = parseIntSafe(scopeIdRaw ?? "", "--department-events");
    if (scopeId <= 0) {
      throw new Error(`Invalid scope id "${scopeIdRaw}" in --department-events.`);
    }
    const eventCount = parseIntSafe(countPart, "--department-events");
    if (eventCount < 0) {
      throw new Error("Department event count must be zero or positive.");
    }
    results.push({ scopeType, scopeId, eventCount });
  }

  return results;
}

function mergeDepartmentEventTargets(
  existing: DepartmentEventTarget[],
  incoming: DepartmentEventTarget[],
): DepartmentEventTarget[] {
  const merged = new Map<string, DepartmentEventTarget>();
  for (const target of existing) {
    merged.set(`${target.scopeType}:${target.scopeId}`, target);
  }
  for (const target of incoming) {
    const key = `${target.scopeType}:${target.scopeId}`;
    const current = merged.get(key);
    if (current) {
      merged.set(key, { ...current, eventCount: current.eventCount + target.eventCount });
    } else {
      merged.set(key, target);
    }
  }
  return Array.from(merged.values());
}

function configureDatabaseTarget(target: TargetDb) {
  if (target === "prod") {
    const prodUrl = process.env.DATABASE_URL_PROD;
    if (!prodUrl) {
      throw new Error("DATABASE_URL_PROD is not set");
    }
    process.env.DATABASE_URL = prodUrl;
    console.log("Using production database URL");
  } else {
    const devUrl = process.env.DATABASE_URL;
    if (!devUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    console.log("Using development database URL");
  }
}

void main();
