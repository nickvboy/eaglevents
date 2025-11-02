#!/usr/bin/env bash
set -euo pipefail

# create-local-databse.sh
# Creates a local Postgres database if it does not already exist.
#
# It reads connection details from either:
# - DATABASE_URL / POSTGRES_URL (e.g. postgres://user:pass@host:5432/dbname)
# - Standard PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
# - Values exported by a local .env file in the current directory
#
# Notes:
# - Assumes the Postgres server is running locally and the role (user) already exists.
# - Passwords from DATABASE_URL are not URL-decoded. If your password includes
#   special characters, prefer setting PGPASSWORD directly in .env.

DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-postgres}"
DB_PASSWORD="${PGPASSWORD:-}"
DB_NAME="${PGDATABASE:-}"

# Load .env if present (exports variables)
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  # Re-apply defaults in case .env did not define everything
  DB_HOST="${PGHOST:-${DB_HOST}}"
  DB_PORT="${PGPORT:-${DB_PORT}}"
  DB_USER="${PGUSER:-${DB_USER}}"
  DB_PASSWORD="${PGPASSWORD:-${DB_PASSWORD}}"
  DB_NAME="${PGDATABASE:-${DB_NAME}}"
fi

# Parse DATABASE_URL / POSTGRES_URL if provided
URI="${DATABASE_URL:-${POSTGRES_URL:-}}"
if [ -n "${URI}" ]; then
  # Strip scheme (postgres:// or postgresql://)
  URI_NOPROTO="${URI#*://}"
  CREDS="${URI_NOPROTO%@*}"
  HOSTPATH="${URI_NOPROTO#*@}"

  # user[:password]
  USER_PART="${CREDS%%:*}"
  PASS_PART="${CREDS#*:}"
  if [ "${USER_PART}" != "${PASS_PART}" ]; then
    DB_USER="${USER_PART}"
    DB_PASSWORD="${PASS_PART}"
  else
    DB_USER="${CREDS}"
  fi

  # host[:port]/dbname
  HOSTPORT="${HOSTPATH%%/*}"
  DB_NAME="${HOSTPATH#*/}"

  HOST_ONLY="${HOSTPORT%%:*}"
  PORT_ONLY="${HOSTPORT#*:}"
  DB_HOST="${HOST_ONLY}"
  if [ "${HOST_ONLY}" != "${PORT_ONLY}" ]; then
    DB_PORT="${PORT_ONLY}"
  fi
fi

if [ -z "${DB_NAME}" ]; then
  echo "Error: Could not determine database name. Set PGDATABASE or DATABASE_URL in .env." >&2
  exit 1
fi

export PGPASSWORD="${DB_PASSWORD}"
MAINT_DB="${PGMAINT_DB:-postgres}"

echo "Using connection:"
echo "  host=${DB_HOST} port=${DB_PORT} user=${DB_USER} db=${DB_NAME}"

# Check server connectivity
if ! psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${MAINT_DB}" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "Error: Cannot connect to server at ${DB_HOST}:${DB_PORT} as ${DB_USER}." >&2
  echo "Hint: Ensure Postgres is running and credentials are correct (.env)." >&2
  exit 2
fi

# Check if database exists
EXISTS="$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${MAINT_DB}" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")"
if [ "${EXISTS}" = "1" ]; then
  echo "Database '${DB_NAME}' already exists. Nothing to do."
  exit 0
fi

echo "Creating database '${DB_NAME}'..."
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${MAINT_DB}" -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

echo "Database '${DB_NAME}' created."

