#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const dotenv = require("dotenv");
const postgres = require("postgres");

const target = process.argv[2] === "prod" ? "prod" : "dev";
const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

if (target === "prod") {
  if (!process.env.DATABASE_URL_PROD) {
    console.error("DATABASE_URL_PROD is not set in .env");
    process.exit(1);
  }
  process.env.CT3A_TARGET = "prod";
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
} else {
  process.env.CT3A_TARGET = "dev";
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const dbUrl = new URL(process.env.DATABASE_URL);

function spawnNodeScript(scriptName) {
  const result = spawnSync("node", [path.resolve(process.cwd(), "scripts", scriptName), target], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  return result.status ?? 1;
}

async function databaseExists() {
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

async function inspectDatabaseState() {
  const sql = postgres(dbUrl.toString(), { max: 1 });

  try {
    const rows = await sql`
      select
        exists(
          select 1
          from information_schema.tables
          where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
        ) as "hasMigrationTable",
        exists(
          select 1
          from information_schema.tables
          where table_schema = 'public' and table_name = 't3-app-template_business'
        ) as "hasBusinessTable",
        exists(
          select 1
          from information_schema.tables
          where table_schema = 'public' and table_name = 't3-app-template_user'
        ) as "hasUserTable",
        exists(
          select 1
          from information_schema.tables
          where table_schema = 'public' and table_name = 't3-app-template_calendar'
        ) as "hasCalendarTable",
        (
          select count(*)
          from information_schema.tables
          where table_schema = 'public' and table_name like 't3-app-template\_%' escape '\'
        )::int as "appTableCount"
    `;

    const state = rows[0];
    if (!state) return "repairable_database";

    const hasSentinelTables =
      Boolean(state.hasBusinessTable) && Boolean(state.hasUserTable) && Boolean(state.hasCalendarTable);

    if (!hasSentinelTables && Number(state.appTableCount ?? 0) === 0) {
      return "empty_database";
    }

    if (Boolean(state.hasMigrationTable) && hasSentinelTables) {
      return "initialized_database";
    }

    return "repairable_database";
  } finally {
    await sql.end();
  }
}

async function main() {
  const databaseName = dbUrl.pathname.replace(/^\//, "");
  console.log(`Ensuring ${target} database is ready: ${dbUrl.hostname}:${dbUrl.port || "5432"}/${databaseName}`);

  if (!(await databaseExists())) {
    console.error(
      target === "prod"
        ? `Database ${databaseName} does not exist. Create it explicitly before running pnpm db:migrate:prod.`
        : `Database ${databaseName} does not exist. Create it explicitly with .\\create-local-database.ps1 -Target dev before running pnpm db:migrate:dev.`,
    );
    process.exit(1);
  }

  const state = await inspectDatabaseState();
  console.log(`Detected state: ${state}`);

  if (state === "empty_database" || state === "repairable_database") {
    console.log("Reconciling schema and migration history in place.");
    const code = spawnNodeScript("db-init.cjs");
    process.exit(code);
  }

  if (state === "initialized_database") {
    const code = spawnNodeScript("db-migrate.cjs");
    process.exit(code);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
