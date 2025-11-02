import { type Config } from "drizzle-kit";

import { env } from "~/env";

// Select database URL based on target. When running via scripts/prod.cjs,
// we set CT3A_TARGET=prod so drizzle-kit uses DATABASE_URL_PROD if present.
const useProd = process.env.CT3A_TARGET === "prod";
const dbUrl = useProd && env.DATABASE_URL_PROD ? env.DATABASE_URL_PROD : env.DATABASE_URL;

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
  tablesFilter: ["t3-app-template_*"],
} satisfies Config;
