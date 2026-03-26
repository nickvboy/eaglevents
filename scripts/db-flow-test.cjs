#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");
const dotenv = require("dotenv");
const postgres = require("postgres");

const rawTarget = process.argv[2] ?? "both";
const target = rawTarget === "prod" ? "prod" : rawTarget === "dev" ? "dev" : rawTarget === "both" ? "both" : null;

if (!target) {
  console.error("Usage: node scripts/db-flow-test.cjs <dev|prod|both>");
  process.exit(1);
}

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const confirmToken = "RUN DB FLOW TESTS";

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    shell: true,
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });

  if (options.capture) {
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  return { status: result.status ?? 1 };
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function askForConfirmation() {
  const describedTarget =
    target === "both" ? "dev and prod" : target;
  console.log(`About to run destructive database flow tests against ${describedTarget}.`);
  console.log("This runner may drop and recreate the target database.");
  console.log(`Type exactly: ${confirmToken}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question("> ", (value) => {
      rl.close();
      resolve(value.trim());
    });
  });

  if (answer !== confirmToken) {
    console.error("Confirmation did not match. Aborting.");
    process.exit(1);
  }
}

function getTargetDbUrl(currentTarget) {
  const value = currentTarget === "prod" ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
  if (!value) {
    throw new Error(currentTarget === "prod" ? "DATABASE_URL_PROD is not set in .env" : "DATABASE_URL is not set in .env");
  }
  return new URL(value);
}

async function withSql(currentTarget, fn) {
  const sql = postgres(getTargetDbUrl(currentTarget).toString(), { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

async function databaseExists(currentTarget) {
  const dbUrl = getTargetDbUrl(currentTarget);
  const maintenanceUrl = new URL(dbUrl.toString());
  maintenanceUrl.pathname = "/postgres";
  const sql = postgres(maintenanceUrl.toString(), { max: 1 });
  try {
    const rows = await sql`select exists(select 1 from pg_database where datname = ${dbUrl.pathname.replace(/^\//, "")}) as present`;
    return Boolean(rows[0]?.present);
  } finally {
    await sql.end();
  }
}

async function hasTable(currentTarget, schemaName, tableName) {
  return withSql(currentTarget, async (sql) => {
    const rows = await sql`
      select exists(
        select 1
        from information_schema.tables
        where table_schema = ${schemaName}
          and table_name = ${tableName}
      ) as present
    `;
    return Boolean(rows[0]?.present);
  });
}

async function countAppTables(currentTarget) {
  return withSql(currentTarget, async (sql) => {
    const rows = await sql`
      select count(*)::int as count
      from information_schema.tables
      where table_schema = 'public'
        and table_name like 't3-app-template\_%' escape '\'
    `;
    return Number(rows[0]?.count ?? 0);
  });
}

async function dropMigrationsTable(currentTarget) {
  await withSql(currentTarget, async (sql) => {
    await sql.unsafe('DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations";');
  });
}

async function verifyInitializedState(currentTarget) {
  assertCondition(await databaseExists(currentTarget), "Expected database to exist.");
  assertCondition(await hasTable(currentTarget, "drizzle", "__drizzle_migrations"), "Expected drizzle.__drizzle_migrations to exist.");
  assertCondition(await hasTable(currentTarget, "public", "t3-app-template_business"), "Expected t3-app-template_business to exist.");
  assertCondition(await hasTable(currentTarget, "public", "t3-app-template_user"), "Expected t3-app-template_user to exist.");
  assertCondition(await hasTable(currentTarget, "public", "t3-app-template_calendar"), "Expected t3-app-template_calendar to exist.");
}

async function runTargetFlow(currentTarget) {
  const dbUrl = getTargetDbUrl(currentTarget);
  const databaseName = dbUrl.pathname.replace(/^\//, "");
  const dbHost = dbUrl.hostname;
  const dbPort = dbUrl.port || "5432";
  const createArgs = [".\\create-local-database.ps1", "-Target", currentTarget];
  const dropArgs = [".\\drop-local-database.ps1", "-Target", currentTarget];
  const migrateScript = currentTarget === "prod" ? "db:migrate:prod" : "db:migrate:dev";

  console.log(`\n=== Testing ${currentTarget}: ${dbHost}:${dbPort}/${databaseName} ===`);
  console.log("\n[1/4] Missing database should fail migration.");
  let result = runCommand("powershell", dropArgs, { capture: false });
  assertCondition(result.status === 0, "Failed to drop database at start of test.");
  result = runCommand("pnpm", [migrateScript], { capture: true });
  assertCondition(result.status !== 0, "Expected migrate to fail when database is missing.");
  assertCondition(result.stdout.includes("does not exist") || result.stderr.includes("does not exist"), "Missing database failure message was not emitted.");

  console.log("\n[2/4] Empty database should bootstrap successfully.");
  result = runCommand("powershell", createArgs, { capture: false });
  assertCondition(result.status === 0, "Failed to create database.");
  assertCondition(await databaseExists(currentTarget), "Expected database to exist after create script.");
  assertCondition((await countAppTables(currentTarget)) === 0, "Expected newly created database to start empty.");
  result = runCommand("pnpm", [migrateScript], { capture: false });
  assertCondition(result.status === 0, "Expected migrate to bootstrap empty database.");
  await verifyInitializedState(currentTarget);

  console.log("\n[3/4] Initialized database should migrate cleanly.");
  result = runCommand("pnpm", [migrateScript], { capture: false });
  assertCondition(result.status === 0, "Expected migrate to succeed on initialized database.");
  await verifyInitializedState(currentTarget);

  console.log("\n[4/4] Repairable database should reconcile in place.");
  await dropMigrationsTable(currentTarget);
  assertCondition(!(await hasTable(currentTarget, "drizzle", "__drizzle_migrations")), "Expected migrations table to be removed for repair test.");
  assertCondition(await hasTable(currentTarget, "public", "t3-app-template_business"), "Expected app tables to remain for repair test.");
  result = runCommand("pnpm", [migrateScript], { capture: false });
  assertCondition(result.status === 0, "Expected migrate to repair an existing database in place.");
  await verifyInitializedState(currentTarget);

  console.log(`\nDatabase flow tests passed for ${currentTarget}: ${dbHost}:${dbPort}/${databaseName}`);
}

async function main() {
  await askForConfirmation();
  const targets = target === "both" ? ["dev", "prod"] : [target];
  for (const currentTarget of targets) {
    await runTargetFlow(currentTarget);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
