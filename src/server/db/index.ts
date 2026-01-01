import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

/**
 * Database connection pool configuration
 *
 * Development: 5 connections (sufficient for dev server)
 * Production: 10 connections (adjust based on load testing)
 *
 * Note: Ensure your PostgreSQL max_connections setting can handle
 * (max connections × number of app instances)
 */
const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, {
  // Connection pool configuration
  max: env.NODE_ENV === "production" ? 10 : 5,
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Fail connection attempt after 10 seconds

  // Logging (optional - remove in production for performance)
  ...(env.NODE_ENV === "development" && {
    onnotice: (notice) => {
      void notice; // Suppress Postgres notices in dev.
    },
  }),
});
if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
