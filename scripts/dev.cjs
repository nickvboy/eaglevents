#!/usr/bin/env node
/* Launch Next dev server using port derived from DEV_SERVER if present. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const WINDOWS_WATCHPACK_SCAN_ERROR =
  /Watchpack Error \(initial scan\): Error: EINVAL: invalid argument, lstat 'C:\\(?:DumpStack\.log\.tmp|hiberfil\.sys|pagefile\.sys|swapfile\.sys)'/i;

function readEnvValue(key, preferProcessEnv = false) {
  // In prod wrapper we prefer process.env (set by scripts/prod.cjs).
  if (preferProcessEnv && process.env[key]) return process.env[key];
  const files = [".env.local", ".env"];
  for (const file of files) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, "utf8");
    // match start-of-line key = value with optional whitespace
    const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m");
    const match = content.match(re);
    if (match) {
      let v = match[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  if (!preferProcessEnv && process.env[key]) return process.env[key];
  return undefined;
}

function resolveDevServer() {
  const isProdWrap = process.env.CT3A_TARGET === "prod";
  if (isProdWrap) {
    // Prefer values passed through env by prod wrapper
    if (process.env.DEV_SERVER) return process.env.DEV_SERVER;
    if (process.env.DEV_SERVER_PROD) return process.env.DEV_SERVER_PROD;
    // Fall back to files
    const fromFileProd = readEnvValue("DEV_SERVER_PROD", false);
    if (fromFileProd) return fromFileProd;
    const fromFile = readEnvValue("DEV_SERVER", false);
    if (fromFile) return fromFile;
    return undefined;
  }
  // Dev mode: prefer process.env override, else files
  return process.env.DEV_SERVER ?? readEnvValue("DEV_SERVER", false);
}

const devServer = resolveDevServer();
let port;
if (devServer) {
  try {
    const u = new URL(devServer);
    if (u.port) port = u.port; // force port from DEV_SERVER if present
  } catch {}
}
if (!port && process.env.PORT) {
  port = process.env.PORT;
}

// Start Next dev; pass explicit port when provided
const args = ["dev"]; // Next will pick engine; -p enforces port
if (port) args.push("-p", String(port));

const cmd = "next"; // resolved from node_modules/.bin via shell
const child = spawn(cmd, args, {
  stdio: ["inherit", "pipe", "pipe"],
  shell: true,
  env: port ? { ...process.env, PORT: String(port) } : process.env,
});

if (child.stdout) {
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
}

if (child.stderr) {
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    const filtered = text
      .split(/\r?\n/)
      .filter((line) => line.length > 0 && !WINDOWS_WATCHPACK_SCAN_ERROR.test(line));

    if (filtered.length > 0) {
      process.stderr.write(`${filtered.join("\n")}${text.endsWith("\n") ? "\n" : ""}`);
    }
  });
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
