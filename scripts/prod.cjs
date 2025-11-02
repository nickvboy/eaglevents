#!/usr/bin/env node
/* Run any package script with PROD env overrides from .env
 * Usage: pnpm prod <script> [args...]
 * - If DATABASE_URL_PROD is set, it will override DATABASE_URL
 * - If DEV_SERVER_PROD is set, it will override DEV_SERVER
 */
const { spawn } = require("child_process");

// Apply overrides from current process env (dotenv-cli already loaded .env)
process.env.CT3A_TARGET = 'prod';
if (process.env.DATABASE_URL_PROD) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
}
if (process.env.DEV_SERVER_PROD) {
  process.env.DEV_SERVER = process.env.DEV_SERVER_PROD;
}

let args = process.argv.slice(2);
if (args.length === 0) {
  // Default to running the dev server in prod mode
  args = ["dev"];
}

// Delegate to pnpm run <script> [args...]
// Use shell:true for better Windows compatibility
const child = spawn(
  "pnpm",
  ["run", ...args],
  { stdio: "inherit", shell: true, env: process.env }
);

child.on("exit", (code) => process.exit(code ?? 0));
