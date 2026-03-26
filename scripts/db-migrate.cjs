#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const dotenv = require("dotenv");

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
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set in .env");
    process.exit(1);
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

try {
  const url = new URL(process.env.DATABASE_URL);
  console.log(`Migrating ${target} database: ${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`);
} catch {
  console.log(`Migrating ${target} database`);
}

const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate", "--config", "drizzle.config.ts"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
