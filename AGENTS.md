# Repository Guidelines

## Project Structure & Module Organization
- Frontend routes and layouts live in `src/app`, using the Next.js App Router; shared UI sits in `src/app/_components` and feature folders (e.g., `calendar`, `tickets`).
- Server logic, tRPC routers, and data helpers live in `src/server`; shared types in `src/types`, styling tokens in `src/styles`, and request middleware in `src/middleware.ts`.
- Database schema and migrations are managed with Drizzle; SQL migrations reside in `drizzle/` with config in `drizzle.config.ts`.
- Public assets are in `public/`. Environment handling is in `src/env.js`. Local helper scripts live in `scripts/` alongside database setup scripts like `create-local-database.ps1` and `start-database.sh`.

## Build, Test, and Development Commands
- Install deps with `pnpm install` (repository uses `pnpm`).
- `pnpm dev` runs the custom dev server script (`scripts/dev.cjs`) for local development.
- `pnpm build` compiles the app; `pnpm preview` runs the built app via `next start`.
- `pnpm check` runs linting plus TypeScript without emit; individual commands: `pnpm lint`, `pnpm lint:fix`, and `pnpm typecheck`.
- `pnpm test` executes `node:test` suites via `tsx` under `src/**/*.test.ts`.
- Database: `pnpm db:generate` (generate migrations), `pnpm db:migrate` (apply locally), `pnpm db:push` (sync schema), `pnpm db:studio` (Drizzle Studio). Use `pnpm user:create` to seed a user after configuring `.env`.

## Coding Style & Naming Conventions
- TypeScript-first, strict mode enabled. Prefer type-only imports (`import type`) and the `~/` alias for `src/`.
- React components and hooks use PascalCase; route segments follow lowercase folder names. Keep modules small and colocate feature utilities.
- Prettier with Tailwind plugin enforces formatting; run `pnpm format:write`. ESLint rules protect Drizzle writes and warn on unused vars; fix with `pnpm lint:fix` when possible.



## Commit & Pull Request Guidelines
- Commit messages in this repo use concise, imperative headlines that describe the behavior change (e.g., `Improve calendar overflow handling`). Keep the first line focused; add detail in the body when needed (migrations, breaking changes, screenshots).
- For PRs, include: summary of intent, notable UI/UX changes with screenshots, linked issue or ticket, tests run (`pnpm check` / `pnpm test`), and migration notes (`drizzle/` updates plus any setup steps). Ensure `.env` values stay local and secrets never reach commits.

## Security & Configuration Tips
- Copy `.env.example` to `.env` and fill required keys (auth, database, search). Never commit `.env`.
- Use the provided database scripts for local Postgres setup before running Drizzle commands. After schema edits, regenerate and commit the SQL migration files in `drizzle/`.