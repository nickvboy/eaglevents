# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Application
```bash
pnpm dev          # Start development server (uses scripts/dev.cjs)
pnpm build        # Create production build
pnpm start        # Run production server
pnpm preview      # Build and start in one command
```

### Code Quality
```bash
pnpm check        # Run all checks (lint + typecheck + format)
pnpm lint         # ESLint only
pnpm lint:fix     # Auto-fix linting issues
pnpm typecheck    # TypeScript type checking
pnpm format:check # Check Prettier formatting
pnpm format:write # Apply Prettier formatting
pnpm test         # Run Node.js test runner (tsx --test)
```

### Database Operations
```bash
pnpm db:generate  # Generate migration from schema changes
pnpm db:migrate   # Apply pending migrations
pnpm db:push      # Push schema directly (dev only, skips migrations)
pnpm db:studio    # Launch Drizzle Studio (visual DB explorer)
```

**Important**: Always use `db:generate` + `db:migrate` for production. Use `db:push` only in development.

### User Management
```bash
pnpm user:create  # Interactive CLI to create users
```

### Database Seeding
```bash
pnpm seed              # Full seed (workspace + events)
pnpm seed:workspace    # Create org structure only
pnpm seed:events       # Add events to existing workspace
pnpm seed:full         # Explicit full seed
pnpm seed:revert       # Delete all seeded data (destructive!)

# Advanced options
pnpm seed -- --mode events --events 100
pnpm seed -- --target prod  # Use DATABASE_URL_PROD
pnpm seed -- --seed 42      # Reproducible random data
```

## Architecture Overview

### Stack
- **Next.js 15** with App Router and React Server Components
- **tRPC v11** for end-to-end type-safe APIs
- **Drizzle ORM** with PostgreSQL
- **NextAuth.js** for authentication (JWT sessions)
- **Tailwind CSS 4** for styling
- **pnpm** for package management

### Key Patterns

**tRPC Architecture**:
- All API routes are defined in `src/server/api/routers/`
- Router composition happens in `src/server/api/root.ts`
- Three procedure types:
  - `publicProcedure` - No auth required
  - `protectedProcedure` - Requires authentication
  - `protectedRateLimitedProcedure` - Auth + rate limiting
- Context includes `db`, `session`, and `headers`
- SuperJSON handles Date/Map/Set serialization automatically

**Database Layer**:
- Schema defined in `src/server/db/schema.ts`
- Uses `createTable()` helper with prefix `t3-app-template_` (kept for backward compatibility)
- All tables use identity columns for primary keys
- Timestamps use `withTimezone: true`
- Migrations stored in `drizzle/` directory

**Authentication & Authorization**:
- NextAuth.js with credentials provider (bcryptjs)
- Session data includes `userId`, `profileId`, `businessId`, `roles`
- Role system: `admin`, `co_admin`, `manager`, `employee`
- Scope system: `business`, `department`, `division`
- Permission logic in `src/server/services/permissions.ts`
- Middleware in `src/middleware.ts` handles:
  - Setup wizard redirects
  - Authentication checks
  - Sanitizes cross-origin callback URLs

**Multi-Tenancy**:
- All data scoped by `businessId`
- First-time setup creates initial business via wizard
- Setup completion tracked in `businesses.setupCompletedAt`
- Middleware redirects to `/setup` if setup incomplete

**Service Layer Pattern**:
- Business logic lives in `src/server/services/`
- Examples: `calendar.ts`, `permissions.ts`, `theme.ts`, `admin.ts`
- Routers call service functions for complex operations
- Services accept `db` client and session/context data

**Frontend Structure**:
- App Router routes in `src/app/`
- Feature-specific components in `_components/` folders
- Server Components by default, Client Components use `"use client"`
- tRPC hooks via `api.router.procedure.useQuery()` or `useMutation()`

### Important Files

**Configuration**:
- `src/env.js` - Environment variable validation (Zod + @t3-oss/env)
- `src/config/app.js` - App constants, cookie names, table prefix
- `drizzle.config.ts` - Drizzle Kit config (supports --target prod via CT3A_TARGET)

**Core Infrastructure**:
- `src/server/api/trpc.ts` - tRPC initialization, context, procedures
- `src/server/api/root.ts` - Main router composition
- `src/server/db/index.ts` - Database client (Postgres.js pool)
- `src/server/auth.ts` - NextAuth configuration
- `src/middleware.ts` - Setup wizard and auth middleware

**Utilities**:
- `src/server/rate-limit.ts` - LRU-based rate limiting
- `src/server/db/health.ts` - Database health checks
- `src/trpc/react.tsx` - tRPC React hooks, query client setup
- `src/trpc/server.ts` - Server-side tRPC caller

## Common Workflows

### Adding a New Feature

1. **Define Database Schema** (if needed):
   ```typescript
   // src/server/db/schema.ts
   export const newTable = createTable("new_table", (d) => ({
     id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
     businessId: d.integer().notNull().references(() => businesses.id),
     // ... fields
   }));
   ```

2. **Generate Migration**:
   ```bash
   pnpm db:generate
   # Review the generated SQL in drizzle/
   pnpm db:migrate
   ```

3. **Create Service Logic** (optional):
   ```typescript
   // src/server/services/new-feature.ts
   export async function createThing(db: DbClient, input: Input) {
     return await db.insert(newTable).values(input).returning();
   }
   ```

4. **Create tRPC Router**:
   ```typescript
   // src/server/api/routers/new-feature.ts
   import { protectedProcedure, createTRPCRouter } from "~/server/api/trpc";

   export const newFeatureRouter = createTRPCRouter({
     create: protectedProcedure
       .input(z.object({ /* ... */ }))
       .mutation(async ({ ctx, input }) => {
         // Use ctx.db, ctx.session
       }),
   });
   ```

5. **Register Router**:
   ```typescript
   // src/server/api/root.ts
   export const appRouter = createTRPCRouter({
     // ... existing routers
     newFeature: newFeatureRouter,
   });
   ```

6. **Use in Frontend**:
   ```tsx
   const { mutate } = api.newFeature.create.useMutation();
   ```

### Modifying Permissions

Permissions are role-based with scope awareness:
- Check `src/server/services/permissions.ts` for:
  - `getPermissionContext()` - Load user's roles and grants
  - `getVisibleScopes()` - Calculate which departments/divisions user can see
  - `hasCapability()` - Check admin capabilities
  - `canManageUser()` - Check if user can modify another user

**Example**:
```typescript
const permCtx = await getPermissionContext(ctx.db, ctx.session.user.id);
if (!hasCapability(permCtx, "users:manage")) {
  throw new TRPCError({ code: "FORBIDDEN" });
}
```

### Working with Seeding

The seeding system (`scripts/seed.ts`) has four modes:
- `workspace` - Creates business, departments, divisions, calendars, users
- `events` - Adds events to existing workspace
- `full` - Both workspace + events
- `revert` - Deletes all seeded data, resets to pre-setup state

Key seeding functions in `src/server/services/seed.ts`:
- `seedWorkspace()` - Creates org structure
- `seedEvents()` - Generates realistic events using @faker-js/faker
- `revertSeed()` - Cleanup function

### Testing

Uses Node.js built-in test runner:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert";

describe("Feature", () => {
  it("should do something", async () => {
    assert.strictEqual(result, expected);
  });
});
```

Run with: `pnpm test`

## Architecture-Specific Notes

### tRPC Timing Middleware
Development mode adds 100-400ms artificial delay to simulate network latency. This helps catch unwanted request waterfalls. Remove from `src/server/api/trpc.ts` if it becomes annoying.

### Database Connection Pooling
Configured in `src/server/db/index.ts`:
- Default max: 20 connections
- Adjust based on team size (see README for guidance)
- Uses Postgres.js (not node-postgres/pg)

### Custom Dev Server
`scripts/dev.cjs` wraps Next.js dev server and provides custom setup status checks. If modifying startup behavior, edit this file.

### Production Database Target
Scripts support `--target prod` flag which uses `DATABASE_URL_PROD`:
- Set via `CT3A_TARGET=prod` environment variable
- Used by drizzle.config.ts to select database
- Allows running seeds/migrations against production

### Path Aliases
Use `~/` to reference `src/`:
```typescript
import { db } from "~/server/db";
import { type User } from "~/server/db/schema";
```

### Cookie Naming
App uses custom cookie names (prefix: `eaglevents`) to avoid conflicts with other localhost apps. See `src/config/app.js` for cookie configuration.

### Setup Wizard Flow
1. User visits app for first time
2. Middleware detects `businesses.setupCompletedAt` is NULL
3. Redirects to `/setup`
4. Setup wizard (`src/app/setup/`) creates business, admin user, initial structure
5. Sets `setupCompletedAt` timestamp
6. Subsequent visits skip setup

## Database Schema Notes

### Key Tables
- `users` - Authentication accounts
- `profiles` - Extended user info (can exist without user for external contacts)
- `businesses` - Top-level organizations (multi-tenant support)
- `departments` - Organizational units within business
- `divisions` - Sub-units within departments
- `calendars` - Event containers (belong to department/division)
- `events` - Scheduled activities
- `event_assignees` - Many-to-many: users assigned to events
- `hour_logs` - Time tracking per event per profile
- `buildings` & `rooms` - Facility management
- `organization_roles` - Role assignments with scope
- `visibility_grants` - Additional visibility permissions

### Enum Types
- `business_type` - Type of organization
- `organization_role_type` - admin, co_admin, manager, employee
- `organization_scope_type` - business, department, division
- `event_request_category` - Event classification

### Table Prefix
All tables prefixed with `t3-app-template_` for historical reasons. Do not change without data migration.

## Troubleshooting

### Common Issues

**TypeScript errors after pulling changes**:
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm typecheck
```

**Database connection issues**:
- Verify PostgreSQL is running
- Check `DATABASE_URL` format in `.env`
- Test connection: `psql $DATABASE_URL`

**Setup wizard loops**:
- Check `businesses.setupCompletedAt` in database
- Clear browser cookies
- Verify `/api/setup/status` returns correct state

**tRPC procedure not found**:
- Ensure router is registered in `src/server/api/root.ts`
- Check import path in frontend matches router structure
- Restart dev server if types aren't updating

## Code Style

- Use `protectedProcedure` for authenticated endpoints
- Validate inputs with Zod schemas
- Throw `TRPCError` with appropriate codes (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, etc.)
- Use service layer for complex business logic (keep routers thin)
- Add database indexes for frequently queried columns
- Use transactions for multi-step database operations
- Prefer Server Components; use Client Components only when needed
