import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(16),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Optional: full base URL (including protocol and port) for dev server, e.g. "http://localhost:3000"
    DEV_SERVER: z.string().url().optional(),
    NEXTAUTH_URL: z.string().url().optional(),
    ELASTICSEARCH_NODE: z.string().url().optional(),
    ELASTICSEARCH_USERNAME: z.string().optional(),
    ELASTICSEARCH_PASSWORD: z.string().optional(),
    ELASTICSEARCH_PROFILE_INDEX: z.string().optional(),
    ENABLE_ELASTICSEARCH: z.string().optional(),
    // Prod variants (kept in same .env; used by `pnpm prod <script>`)
    DATABASE_URL_PROD: z.string().url().optional(),
    DEV_SERVER_PROD: z.string().url().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    DEV_SERVER: process.env.DEV_SERVER,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    ELASTICSEARCH_NODE: process.env.ELASTICSEARCH_NODE,
    ELASTICSEARCH_USERNAME: process.env.ELASTICSEARCH_USERNAME,
    ELASTICSEARCH_PASSWORD: process.env.ELASTICSEARCH_PASSWORD,
    ELASTICSEARCH_PROFILE_INDEX: process.env.ELASTICSEARCH_PROFILE_INDEX,
    ENABLE_ELASTICSEARCH: process.env.ENABLE_ELASTICSEARCH,
    DATABASE_URL_PROD: process.env.DATABASE_URL_PROD,
    DEV_SERVER_PROD: process.env.DEV_SERVER_PROD,
    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
