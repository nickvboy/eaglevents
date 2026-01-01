## Honest Assessment: **Mixed, Leaning Towards Concerning**

Let me break this down:

### The Good (Foundation is Solid)
- **Modern, well-chosen stack**: Next.js 15, tRPC, Drizzle ORM, TypeScript with strict mode
- **Proper database design**: Well-structured schema with appropriate indexes, foreign keys, and cascade rules
- **Security-conscious patterns exist**: 
  - bcrypt for passwords
  - Zod validation everywhere
  - CSRF protection via NextAuth
  - SQL injection protection via Drizzle ORM
  - Database transactions for data integrity
- **Good architecture**: Service layer separation, permission helpers, audit logging infrastructure
- **Environment validation**: Using `@t3-oss/env-nextjs` properly

### The Bad (Critical Gaps)

**The #1 Killer Issue:**
```typescript
// This is in EVERY router - 80+ times!
export const adminRouter = createTRPCRouter({
  dashboard: publicProcedure.query(async ({ ctx }) => { // ❌ PUBLIC!
    // Returns sensitive admin data
  }),
  deleteUser: publicProcedure.mutation(async ({ ctx, input }) => { // ❌ PUBLIC!
    // Anyone can delete users!
  }),
  // ... etc
});
```

**This means RIGHT NOW:**
- Anyone can call `admin.deleteUser` without logging in
- Anyone can access all user data, events, reports
- Anyone can create/modify/delete anything
- Your entire API is wide open

This isn't just "bad" - **this is deployment-blocking dangerous**.

### Other Significant Issues
- Zero rate limiting (brute force attacks trivial)
- Almost no tests (1 file for a multi-thousand line codebase)
- Still named "t3-app-template" everywhere
- Committing logs/data to git
- Migration file conflicts

## The Verdict

**For a side project / learning project**: This is **decent** - shows good understanding of modern patterns.

**For a production application**: This is **not ready** - the security issues are critical.

**The good news**: The foundation suggests you know what you're doing. The authentication middleware exists, it's just not being used. This is fixable - probably 1-2 days of focused work to:
1. Create `protectedProcedure` in `src/server/api/trpc.ts`
2. Replace `publicProcedure` with `protectedProcedure` on sensitive endpoints (most of them)
3. Add rate limiting middleware
4. Clean up the template artifacts

**Bottom line**: You have a **B+ architecture with D- security implementation**. The bones are good, but you can't ship this as-is.

# Task 1: Implement Protected Procedures

You are working on a Next.js application using tRPC and NextAuth. Currently, all tRPC procedures use `publicProcedure`, making the entire API accessible without authentication. Your task is to implement proper authentication middleware.

## Context
- **Framework**: Next.js 15, tRPC v11, NextAuth v4
- **Auth**: NextAuth with JWT strategy, session available in `ctx.session`
- **Files to modify**: `src/server/api/trpc.ts` and all routers in `src/server/api/routers/`

## Task

### Step 1: Create protectedProcedure in `src/server/api/trpc.ts`

Add after the existing `publicProcedure` export:

```typescript
/**
 * Protected procedure - requires authentication
 * 
 * Throws UNAUTHORIZED error if user is not logged in
 */
const enforceUserIsAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({
    ctx: {
      // Infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(enforceUserIsAuthed);
```

### Step 2: Audit and Update Routers

Replace `publicProcedure` with `protectedProcedure` in these routers:

**src/server/api/routers/admin.ts** - ALL procedures should be protected:
- `dashboard`
- `users`
- `createUser`
- `updateUser`
- `deactivateUser`
- `reactivateUser`
- `deleteUser`
- `events`
- `profiles`
- `database.*` (all database operations)
- `reports.*` (all report operations)
- `export.*` (all export operations)
- Any other procedures

**src/server/api/routers/event.ts** - Protect mutations and sensitive queries:
- `create` (mutation)
- `update` (mutation)
- `delete` (mutation)
- `confirmZendesk` (mutation)
- `logHours` (mutation)
- Keep `list`, `get`, `scopeOptions` as `publicProcedure` (they have permission filtering)

**src/server/api/routers/calendar.ts** - Protect all mutations:
- `create` (mutation)
- `update` (mutation)
- `delete` (mutation)
- `setPrimary` (mutation, if exists)
- Keep `list` as `publicProcedure` (it filters by userId)

**src/server/api/routers/profile.ts** - Protect most operations:
- `create` (mutation)
- `update` (mutation)
- `link` (mutation, if exists)
- Keep `search` as `publicProcedure` (it returns limited data)

**src/server/api/routers/facility.ts** - Protect mutations:
- Any create/update/delete operations
- Keep read operations (`list`, `get`) as `publicProcedure`

**src/server/api/routers/theme.ts** - Protect all mutations:
- Palette create/update/delete
- Profile create/update/delete
- Keep read operations as `publicProcedure`

**src/server/api/routers/setup.ts** - Keep ALL as `publicProcedure`:
- These are needed for the onboarding wizard
- They have their own setup status checks

**src/server/api/routers/post.ts** - Protect mutations:
- This appears to be a template file, but protect mutations if used

### Step 3: Import the New Procedure

In each router file, update the import:

```typescript
import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";
```

## Testing

After making changes:

1. Run `pnpm typecheck` to ensure no TypeScript errors
2. Start the dev server: `pnpm dev`
3. Test that:
   - Accessing a protected route while logged out returns 401
   - Accessing a protected route while logged in works
   - Setup wizard still works (no auth required)
   - Login/logout flow still works

## Acceptance Criteria

- [ ] `protectedProcedure` is exported from `src/server/api/trpc.ts`
- [ ] All admin routes use `protectedProcedure`
- [ ] Event/calendar/profile mutations use `protectedProcedure`
- [ ] Setup routes remain using `publicProcedure`
- [ ] Code compiles without TypeScript errors
- [ ] Unauthenticated requests to protected routes return 401

---

# Task 2: Add Rate Limiting

You are adding rate limiting to prevent brute force attacks on authentication endpoints in a Next.js application using NextAuth.

## Context
- **Framework**: Next.js 15, NextAuth v4
- **Goal**: Prevent brute force attacks on login and signup
- **Approach**: Use a simple in-memory rate limiter (production would use Redis)

## Task

### Step 1: Install Dependencies

```bash
pnpm add lru-cache
pnpm add -D @types/lru-cache
```

### Step 2: Create Rate Limiting Utility

Create `src/server/rate-limit.ts`:

```typescript
import { LRUCache } from "lru-cache";

type RateLimitOptions = {
  interval: number; // Time window in milliseconds
  uniqueTokenPerInterval: number; // Max unique tokens (IPs)
};

export class RateLimiter {
  private tokenCache: LRUCache<string, number[]>;
  private interval: number;
  private maxRequests: number;

  constructor(maxRequests: number, options: RateLimitOptions) {
    this.maxRequests = maxRequests;
    this.interval = options.interval;
    this.tokenCache = new LRUCache({
      max: options.uniqueTokenPerInterval,
      ttl: options.interval,
    });
  }

  check(identifier: string): { success: boolean; remaining: number } {
    const now = Date.now();
    const tokenKey = identifier;
    
    const timestamps = this.tokenCache.get(tokenKey) ?? [];
    const windowStart = now - this.interval;
    
    // Filter out timestamps outside the current window
    const recentTimestamps = timestamps.filter((ts) => ts > windowStart);
    
    if (recentTimestamps.length >= this.maxRequests) {
      return { success: false, remaining: 0 };
    }
    
    recentTimestamps.push(now);
    this.tokenCache.set(tokenKey, recentTimestamps);
    
    return {
      success: true,
      remaining: this.maxRequests - recentTimestamps.length,
    };
  }
}

// Login: 5 attempts per 15 minutes
export const loginLimiter = new RateLimiter(5, {
  interval: 15 * 60 * 1000, // 15 minutes
  uniqueTokenPerInterval: 500,
});

// Signup: 3 attempts per hour
export const signupLimiter = new RateLimiter(3, {
  interval: 60 * 60 * 1000, // 1 hour
  uniqueTokenPerInterval: 500,
});

// Helper to get client IP
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  
  return realIp ?? "unknown";
}
```

### Step 3: Apply to Signup Route

Update `src/app/api/signup/route.ts`:

```typescript
import { signupLimiter, getClientIp } from "~/server/rate-limit";

export async function POST(req: Request) {
  // Rate limiting check
  const ip = getClientIp(req);
  const rateLimit = signupLimiter.check(ip);
  
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429 }
    );
  }

  // ... rest of existing code
}
```

### Step 4: Apply to Login (NextAuth)

Update `src/server/auth.ts`:

```typescript
import { loginLimiter, getClientIp } from "~/server/rate-limit";

// Add this at the top of the authorize function
authorize: async (raw, req) => {
  // Rate limiting
  if (req.headers) {
    const headers = new Headers(req.headers as HeadersInit);
    const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
      ?? headers.get("x-real-ip") 
      ?? "unknown";
    
    const rateLimit = loginLimiter.check(ip);
    
    if (!rateLimit.success) {
      console.warn(`Rate limit exceeded for IP: ${ip}`);
      return null; // Return null to show as failed login
    }
  }

  // ... rest of existing authorize code
}
```

**Note**: Update the `authorize` signature to accept `req` as second parameter if not already present.

### Step 5: Add Rate Limit Headers (Optional)

For better UX, add rate limit info to response headers:

```typescript
const response = NextResponse.json({ ok: true });
response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
return response;
```

## Testing

1. Run `pnpm dev`
2. Try logging in with wrong credentials 6 times - the 6th should be blocked
3. Try signing up 4 times in an hour - the 4th should be blocked
4. Wait for the time window to pass and verify you can try again
5. Test that successful logins still work normally

## Acceptance Criteria

- [ ] `src/server/rate-limit.ts` created with limiters
- [ ] Signup route blocks after 3 attempts per hour
- [ ] Login blocks after 5 attempts per 15 minutes
- [ ] Rate limiting uses IP address as identifier
- [ ] Returns 429 status code when rate limited
- [ ] User-friendly error messages displayed

## Production Notes

For production, consider using:
- **Upstash Redis** with `@upstash/ratelimit`
- **Vercel KV** if deploying on Vercel
- Distributed rate limiting for multi-server deployments

---

# Task 3: Fix Timing Attack in Login

You are fixing a timing attack vulnerability in the authentication flow. Currently, the login process takes different amounts of time depending on whether a user exists, which allows attackers to enumerate valid usernames.

## Context
- **File**: `src/server/auth.ts`
- **Issue**: When a user doesn't exist, no bcrypt comparison happens (fast). When a user exists, bcrypt comparison happens (slow). This timing difference reveals whether a username/email is valid.
- **Solution**: Always perform a bcrypt hash comparison, even for non-existent users

## Current Vulnerable Code

```typescript
const user = rows[0];
if (!user) return null; // ❌ Fast path - no bcrypt!
if (!user.isActive) return null;

const ok = await bcrypt.compare(password, user.passwordHash); // Slow path
if (!ok) return null;
```

## Task

### Update the authorize function in `src/server/auth.ts`

Replace the user validation section with:

```typescript
const user = rows[0];

// Always perform bcrypt comparison to prevent timing attacks
// Use a dummy hash if user doesn't exist
const dummyHash = "$2a$10$YourStaticDummyHashHereToPreventTimingAttacks1234567890"; 
const hashToCompare = user?.passwordHash ?? dummyHash;

const ok = await bcrypt.compare(password, hashToCompare);

// Check all conditions after the timing-sensitive operation
if (!user || !user.isActive || !ok) {
  return null;
}

return {
  id: String(user.id),
  name: user.username,
  email: user.email,
};
```

### Generate a Real Dummy Hash (One-Time Setup)

To generate a proper dummy hash for the code above:

```bash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('dummy', 10).then(console.log)"
```

Copy the output and replace `dummyHash` value in the code.

## Why This Works

1. **Before**: `no user → return null (5ms)` vs `wrong password → bcrypt + return null (100ms)`
2. **After**: Both paths take ~100ms because both call `bcrypt.compare()`

This makes it impossible for attackers to determine if a username exists by measuring response time.

## Additional Security Enhancement (Optional)

Add a small random delay to further obfuscate timing:

```typescript
// After all checks, before returning null
if (!user || !user.isActive || !ok) {
  // Add 0-50ms random jitter to further prevent timing analysis
  await new Promise(resolve => 
    setTimeout(resolve, Math.floor(Math.random() * 50))
  );
  return null;
}
```

## Testing

### Manual Testing
1. Start dev server: `pnpm dev`
2. Try logging in with:
   - Non-existent username
   - Existing username with wrong password
   - Existing username with correct password
3. All should feel similar in timing (both failures take ~100-150ms)

### Timing Analysis Test (Advanced)
```typescript
// Test script to verify timing consistency
async function testTimingAttack() {
  const times: number[] = [];
  
  for (let i = 0; i < 20; i++) {
    const start = Date.now();
    await fetch("http://localhost:3000/api/auth/callback/credentials", {
      method: "POST",
      body: JSON.stringify({
        identifier: "nonexistent@example.com",
        password: "wrongpassword",
      }),
    });
    times.push(Date.now() - start);
  }
  
  console.log("Average time:", times.reduce((a, b) => a + b) / times.length);
  console.log("Min:", Math.min(...times), "Max:", Math.max(...times));
  // Min and Max should be within similar range
}
```

## Acceptance Criteria

- [ ] Dummy hash is a valid bcrypt hash
- [ ] `bcrypt.compare()` is called for all code paths
- [ ] All validation checks happen after bcrypt comparison
- [ ] Login with non-existent user takes similar time as wrong password
- [ ] Correct login still works
- [ ] Code passes `pnpm typecheck`

## Security Notes

- This fix prevents **username enumeration** via timing analysis
- Combine with rate limiting (Task 2) for comprehensive protection
- Consider logging failed attempts for security monitoring

---

# Task 4: Fix Migration Files

You have duplicate migration files with the same version number (0017) and a missing migration (0020). This needs to be resolved to ensure database schema consistency.

## Context
- **ORM**: Drizzle ORM
- **Files**: 
  - `drizzle/0017_event_building.sql`
  - `drizzle/0017_harsh_blade.sql`
  - Missing: `drizzle/0020_*.sql`
  - `drizzle/meta/_journal.json`

## Task

### Step 1: Examine the Duplicate Migrations

Read both files to understand what they do:

```bash
# Compare the two files
diff drizzle/0017_event_building.sql drizzle/0017_harsh_blade.sql
```

Or read each file individually.

### Step 2: Determine the Correct Action

**Scenario A: Files are duplicates (same content)**
- Delete `drizzle/0017_harsh_blade.sql`
- Keep `drizzle/0017_event_building.sql`

**Scenario B: Files have different content**
- One is the "real" 0017, the other should be later
- Examine git history to determine which came first:
  ```bash
  git log --all --full-history -- drizzle/0017_harsh_blade.sql
  git log --all --full-history -- drizzle/0017_event_building.sql
  ```
- Rename the later file to `0020_harsh_blade.sql`

### Step 3: Update the Journal

Edit `drizzle/meta/_journal.json`:

1. Ensure migrations are listed in correct order
2. Remove any duplicate entries for 0017
3. If you renamed a file to 0020, update that entry:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    // ... other entries
    {
      "idx": 17,
      "version": "17",
      "when": 1234567890,
      "tag": "0017_event_building",
      "breakpoints": true
    },
    // If 0019 exists
    {
      "idx": 19,
      "version": "19",
      "tag": "0019_fearless_human_torch",
      // ...
    },
    // Add this if you renamed harsh_blade to 0020
    {
      "idx": 20,
      "version": "20",
      "when": 1234567891, // Use appropriate timestamp
      "tag": "0020_harsh_blade",
      "breakpoints": true
    },
    {
      "idx": 21,
      "version": "21",
      "tag": "0021_left_doctor_octopus",
      // ...
    }
  ]
}
```

### Step 4: Investigate Missing Migration 0020

1. Check if 0020 was ever created:
   ```bash
   git log --all --full-history --oneline -- "drizzle/0020_*"
   ```

2. If it was deleted, check why:
   ```bash
   git log --all --full-history --diff-filter=D -- "drizzle/0020_*"
   ```

3. Options:
   - **If 0020 was intentionally deleted**: Document why in a comment
   - **If it was a merge conflict casualty**: Recover it from git history
   - **If it never existed**: This is fine, just ensure journal is sequential

### Step 5: Verify Migration Order

Ensure the sequence is valid:

```bash
ls -1 drizzle/*.sql | sort
```

Should show:
- 0000_...
- 0001_...
- ...
- 0017_event_building.sql (or harsh_blade, pick one)
- 0018_...
- 0019_...
- (0020 if you created/recovered it)
- 0021_...
- 0022_...

### Step 6: Test Migration Application

On a **test database**, apply migrations from scratch:

```bash
# Backup your dev database first!
pnpm db:migrate
```

If errors occur, you may need to:
- Fix foreign key dependencies
- Adjust the order of migrations
- Combine duplicate migrations

## Acceptance Criteria

- [ ] No duplicate migration numbers exist
- [ ] `drizzle/meta/_journal.json` has sequential entries
- [ ] All migration files are referenced in the journal
- [ ] Missing migration (0020) is either restored or documented as intentionally skipped
- [ ] Migrations apply cleanly on a fresh database
- [ ] Git history is clean (no uncommitted changes after fix)

## Documentation

Add a comment in the relevant migration file or create a `drizzle/MIGRATION_NOTES.md`:

```markdown
## Migration 0017 Duplicate Resolution

**Issue**: Two migration files existed with version 0017
- `0017_event_building.sql` - Adds buildingId to events table
- `0017_harsh_blade.sql` - [Describe what it did]

**Resolution**: [Describe what you did]
- Kept: 0017_event_building.sql
- Renamed: 0017_harsh_blade.sql → 0020_harsh_blade.sql
- OR Deleted: 0017_harsh_blade.sql (was duplicate)

**Date**: [Today's date]
```

## Warning

⚠️ **Do not modify existing migrations that have been applied to production!** If production databases have already applied these migrations, you may need a different approach (like creating a new corrective migration).

---

# Task 5: Database Connection Pooling

You need to configure proper database connection pooling to prevent connection exhaustion and optimize performance.

## Context
- **Library**: `postgres-js` (postgres package)
- **Current State**: Using default connection settings
- **File**: `src/server/db/index.ts`
- **Risk**: Unlimited connections could exhaust database resources

## Current Code

```typescript
const conn = globalForDb.conn ?? postgres(env.DATABASE_URL);
if (env.NODE_ENV !== "production") globalForDb.conn = conn;
```

## Task

### Step 1: Update Connection Configuration

Replace the connection initialization in `src/server/db/index.ts`:

```typescript
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

const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, {
  // Connection pool configuration
  max: env.NODE_ENV === "production" ? 10 : 5,
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Fail connection attempt after 10 seconds
  
  // Logging (optional - remove in production for performance)
  ...(env.NODE_ENV === "development" && {
    onnotice: () => {}, // Suppress Postgres notices in dev
  }),
});

if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
```

### Step 2: Add Connection Health Check (Optional but Recommended)

Create `src/server/db/health.ts`:

```typescript
import { db } from "./index";
import { sql } from "drizzle-orm";

export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}> {
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;
    
    return { healthy: true, latencyMs };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### Step 3: Add Health Check Endpoint (Optional)

Create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "~/server/db/health";

export async function GET() {
  const health = await checkDatabaseHealth();
  
  if (!health.healthy) {
    return NextResponse.json(
      { status: "unhealthy", error: health.error },
      { status: 503 }
    );
  }
  
  return NextResponse.json({
    status: "healthy",
    database: {
      connected: true,
      latencyMs: health.latencyMs,
    },
  });
}
```

### Step 4: Optimize for Your Deployment Environment

**For Vercel / Serverless**:
```typescript
max: 1, // Serverless functions should use 1 connection
idle_timeout: 0, // Let the platform manage lifecycle
```

**For Traditional Server (VPS, Docker)**:
```typescript
max: 10, // Can handle more concurrent connections
idle_timeout: 20,
```

**For High-Traffic Production**:
```typescript
max: 20, // Match your database's max_connections limit
idle_timeout: 30,
max_lifetime: 60 * 30, // Recycle connections every 30 minutes
```

### Step 5: Document Configuration

Add comments explaining the configuration choices:

```typescript
/**
 * Database connection pool configuration
 * 
 * Development: 5 connections (sufficient for dev server)
 * Production: 10 connections (adjust based on load testing)
 * 
 * Note: Ensure your PostgreSQL max_connections setting can handle
 * (max connections × number of app instances)
 */
```

## Configuration Options Reference

```typescript
postgres(connectionString, {
  max: 10,              // Max connections in pool
  idle_timeout: 20,     // Close idle connections after N seconds
  connect_timeout: 10,  // Timeout for initial connection
  max_lifetime: 1800,   // Max connection lifetime in seconds
  prepare: true,        // Use prepared statements (performance boost)
  ssl: false,           // Set to true for production if required
  
  // Advanced options
  transform: {
    undefined: null,    // Convert undefined to NULL
  },
  onnotice: () => {},   // Handle Postgres NOTICE messages
})
```

## Testing

### Verify Connection Pooling

1. Start dev server: `pnpm dev`
2. Open multiple browser tabs and make rapid API calls
3. Check logs - should reuse connections, not create new ones each time

### Test Connection Limits

```typescript
// Create a test script: scripts/test-pool.ts
import { db } from "../src/server/db";

async function testConnectionPool() {
  const promises = [];
  
  // Try to open more connections than pool size
  for (let i = 0; i < 20; i++) {
    promises.push(
      db.execute(sql`SELECT pg_sleep(2), ${i} as num`)
    );
  }
  
  console.time("All queries");
  await Promise.all(promises);
  console.timeEnd("All queries");
  // Should take ~8 seconds (20 queries / 5 connections * 2 sec)
  // Not 40 seconds (if it was serial) or crash (if unlimited)
}

testConnectionPool().catch(console.error);
```

Run with: `tsx scripts/test-pool.ts`

## Monitoring (Production)

Add logging to track connection usage:

```typescript
const conn = globalForDb.conn ?? postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  
  debug: (connection, query, params) => {
    // Log slow queries
    if (query.includes('SLOW_QUERY_MARKER')) {
      console.warn('Slow query detected:', query);
    }
  },
});
```

## Acceptance Criteria

- [ ] Connection pool has explicit `max` limit
- [ ] Timeout values are configured
- [ ] Different settings for dev vs production
- [ ] Code includes comments explaining values
- [ ] Health check endpoint works (optional)
- [ ] Pool behaves correctly under load testing
- [ ] No "too many connections" errors under normal load

## Common Issues

**Issue**: "Too many connections" error
**Solution**: Reduce `max` value or increase PostgreSQL `max_connections`

**Issue**: Slow queries under load
**Solution**: Increase `max` pool size (but watch database resources)

**Issue**: Connection timeout in Vercel
**Solution**: Use `max: 1` for serverless environments

---

# Task 6: Update .gitignore and Remove Tracked Files

You need to prevent logs and export files from being tracked in git. Some files have already been committed and need to be removed from the repository without deleting them locally.

## Context
- **Issue**: `logs/service.log` and `exports/` folder are tracked in git
- **Problem**: Repository bloat, potential sensitive data exposure, merge conflicts
- **Files**: `.gitignore`, committed logs and exports

## Current State

Currently tracked files that shouldn't be:
- `logs/service.log`
- `exports/eaglevents-hour-logs.xlsx`
- `exports/eaglevents-join-table.xlsx`
- `exports/hour-log-backups/*`
- `exports/join-table-backups/*`

Also, `next-env.d.ts` is gitignored but should be committed.

## Task

### Step 1: Update .gitignore

Edit `.gitignore` and make these changes:

```diff
# next.js
/.next/
/out/
-next-env.d.ts

# production
/build

# misc
.DS_Store
*.pem
-*.xls
-*.xlsx
-*.xlsm
-*.xlsb

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*
+
+# Application logs
+/logs
+*.log
+
+# Export files (generated dynamically)
+/exports/**/*.xlsx
+/exports/**/*.xls
+/exports/**/*.xlsm
+/exports/**/*.xlsb
+/exports/**/backups
+
+# Keep export directory structure
+!/exports/.gitkeep

# local env files
```

**Explanation of changes**:
- ✅ Removed `next-env.d.ts` (Next.js types should be committed)
- ✅ Moved Excel file patterns to exports section with more specificity
- ✅ Added `/logs` directory
- ✅ Added `*.log` pattern
- ✅ Added exports directory with pattern matching
- ✅ Added `.gitkeep` exception to maintain folder structure

### Step 2: Create .gitkeep Files

Create empty `.gitkeep` files to preserve directory structure:

```bash
# Windows (PowerShell)
New-Item -ItemType File -Path "logs\.gitkeep" -Force
New-Item -ItemType File -Path "exports\.gitkeep" -Force

# Linux/Mac
touch logs/.gitkeep
touch exports/.gitkeep
```

### Step 3: Remove Files from Git (Keep Locally)

Remove the tracked files from git without deleting them locally:

```bash
# Remove logs from git tracking
git rm --cached logs/service.log

# Remove all xlsx/xls files in exports
git rm --cached -r exports/*.xlsx
git rm --cached -r exports/*.xls
git rm --cached -r exports/**/*.xlsx
git rm --cached -r exports/**/*.xls

# Alternative: Remove entire directories
git rm --cached -r logs/
git rm --cached -r exports/

# Then add back the .gitkeep files
git add logs/.gitkeep
git add exports/.gitkeep
git add .gitignore
```

**Note**: The `--cached` flag means "remove from git index but keep on disk"

### Step 4: Add next-env.d.ts (If It Exists)

If `next-env.d.ts` exists in your project:

```bash
git add next-env.d.ts
```

If it doesn't exist, Next.js will generate it on next build.

### Step 5: Commit Changes

```bash
git status  # Verify the correct files are staged

git commit -m "chore: update gitignore to exclude logs and exports

- Remove logs/ and exports/ from version control
- Keep directory structure with .gitkeep files
- Include next-env.d.ts (Next.js types)
- Prevent accidental commits of generated data files"
```

### Step 6: Verify

```bash
# Ensure the files still exist locally
ls logs/
ls exports/

# Ensure they're no longer tracked
git status  # Should not show logs/ or exports/ as modified

# Ensure .gitkeep files ARE tracked
git ls-files | grep gitkeep
```

### Step 7: Update Documentation (Optional)

Add to `README.md` or create `docs/development.md`:

```markdown
## Generated Files

The following directories contain generated files and are not tracked in git:

- `/logs` - Application logs (service.log, etc.)
- `/exports` - Generated Excel export files
  - `hour-log-backups/` - Backup exports of hour logs
  - `join-table-backups/` - Backup exports of join tables

These directories are preserved in the repository via `.gitkeep` files.
```

## Handling Team Members

If others have these files tracked, they'll need to run:

```bash
git pull
git rm --cached -r logs/ exports/
```

Or simply:
```bash
git pull
git clean -fd  # Removes untracked files (use with caution)
```

## Testing

1. Modify `logs/service.log` - should not appear in `git status`
2. Add a new file in `exports/` - should not appear in `git status`
3. Run `pnpm build` - verify `next-env.d.ts` is present and tracked
4. Clone repo in new location - verify folders exist but are empty (except .gitkeep)

## Acceptance Criteria

- [ ] `.gitignore` updated with logs and exports patterns
- [ ] `next-env.d.ts` removed from `.gitignore`
- [ ] `logs/.gitkeep` created and committed
- [ ] `exports/.gitkeep` created and committed
- [ ] All log files removed from git tracking
- [ ] All export xlsx files removed from git tracking
- [ ] Local files still exist on disk
- [ ] `git status` shows clean working tree
- [ ] Changes committed with clear commit message

## Rollback Plan

If something goes wrong:

```bash
# Restore files from last commit
git checkout HEAD -- logs/ exports/

# Re-add to tracking
git add logs/ exports/
```

## Additional Patterns to Consider

If you have other generated files, add them too:

```gitignore
# Database backups
*.sql.gz
*.dump

# Temporary files
/tmp
*.tmp

# IDE specific (if not already present)
.vscode/settings.json
.idea/workspace.xml
```

---

# Task 7: Rename Project from Template

Your codebase still uses the template name "t3-app-template" throughout. This task updates it to "eaglevents" (or your chosen name) while preserving database compatibility.

## Context
- **Current name**: `t3-app-template`
- **New name**: `eaglevents` (or specify your preferred name)
- **Risk**: Renaming database tables is destructive
- **Approach**: Update code, document table names for backward compatibility

## Files to Update

### Step 1: Update package.json

**File**: `package.json`

```diff
{
-  "name": "t3-app-template",
+  "name": "eaglevents",
   "version": "0.1.0",
   "private": true,
```

Also consider updating:
```diff
-  "version": "0.1.0",
+  "version": "1.0.0",
```

### Step 2: Document Table Prefix (DO NOT RENAME TABLES)

**File**: `src/server/db/schema.ts`

⚠️ **IMPORTANT**: Do NOT change the actual table prefix if databases already exist. Instead, document it:

```typescript
/**
 * Multi-project schema feature from Drizzle ORM.
 * 
 * Table prefix: t3-app-template_
 * Note: This prefix is retained for backward compatibility with existing databases.
 * New deployments could use 'eaglevents_' but existing installations must keep
 * the original prefix to avoid data loss.
 * 
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `t3-app-template_${name}`);
```

**Alternative** (if this is a fresh deployment with no production data):

```typescript
export const createTable = pgTableCreator((name) => `eaglevents_${name}`);
```

Then create a migration:
```bash
pnpm db:generate
# This will create a migration renaming all tables
```

### Step 3: Update README.md

**File**: `README.md`

Replace the template content with project-specific documentation:

```markdown
# EagleEvents

Event management system for facilities and venue scheduling.

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **API**: tRPC v11
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: NextAuth.js (JWT strategy)
- **UI**: React 19, Tailwind CSS 4
- **Search**: Elasticsearch (optional)

## Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- pnpm 10+

### Installation

1. Clone the repository
```bash
git clone <your-repo-url>
cd eaglevents
```

2. Install dependencies
```bash
pnpm install
```

3. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your database credentials and secrets
```

4. Create local database
```bash
# Windows
.\create-local-database.ps1

# Linux/Mac
./create-local-database.sh
```

5. Run migrations
```bash
pnpm db:migrate
```

6. Start development server
```bash
pnpm dev
```

Visit http://localhost:3000 and complete the setup wizard.

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm check` | Run linting and type checking |
| `pnpm test` | Run test suite |
| `pnpm db:generate` | Generate migration files |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Open Drizzle Studio |

### Database Seeding

The `scripts/seed.ts` helper populates the workspace through tRPC APIs.

| Command | Description |
|---------|-------------|
| `pnpm seed` | Run full workflow (workspace + events) |
| `pnpm seed:workspace` | Only setup flow (business, buildings, departments, admins) |
| `pnpm seed:events` | Only add event data (workspace must exist) |
| `pnpm seed:full` | Generate 7 years of historical data |
| `pnpm seed:revert` | Delete seeded data and return to onboarding |

Options:
- `--target dev|prod` - Switch between DATABASE_URL and DATABASE_URL_PROD
- `--events <count>` - Number of events to generate
- `--seed <number>` - Deterministic Faker seed

Example:
```bash
pnpm seed -- --target dev --events 50 --seed 42
```

## Project Structure

```
src/
├── app/              # Next.js App Router pages
│   ├── _components/  # Shared UI components
│   ├── calendar/     # Calendar feature
│   ├── tickets/      # Ticketing feature
│   ├── admin/        # Admin dashboard
│   └── setup/        # Onboarding wizard
├── server/
│   ├── api/          # tRPC routers
│   ├── db/           # Database client and schema
│   └── services/     # Business logic layer
├── types/            # Shared TypeScript types
└── styles/           # Global styles and themes
```

## Environment Variables

Required variables (copy from `.env.example`):

- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_SECRET` - Secret for JWT signing (generate with `openssl rand -base64 32`)
- `NEXTAUTH_URL` - Your app URL (http://localhost:3000 for dev)

Optional:
- `ELASTICSEARCH_NODE` - Elasticsearch endpoint for search
- `ELASTICSEARCH_USERNAME` - Elasticsearch username
- `ELASTICSEARCH_PASSWORD` - Elasticsearch password

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

### Docker

```bash
docker build -t eaglevents .
docker run -p 3000:3000 --env-file .env eaglevents
```

## Contributing

1. Create a feature branch
2. Make changes
3. Run `pnpm check` to validate
4. Submit a pull request

## License

[Your License Here]
```

### Step 4: Update Cookie Names (Optional)

**File**: `src/server/auth.ts`

```diff
cookies: {
  sessionToken: {
    name:
      useSecureCookies
-        ? "__Secure-t3app.session-token"
-        : "t3app.session-token",
+        ? "__Secure-eaglevents.session-token"
+        : "eaglevents.session-token",
```

Update all cookie names:
- `t3app.csrf-token` → `eaglevents.csrf-token`
- `t3app.nonce` → `eaglevents.nonce`
- `t3app.state` → `eaglevents.state`
- `t3app.pkce` → `eaglevents.pkce`
- `t3app.callback-url` → `eaglevents.callback-url`

**File**: `src/middleware.ts`

```diff
cookies: {
  sessionToken: {
    name:
      process.env.NODE_ENV === "production"
-        ? "__Secure-t3app.session-token"
-        : "t3app.session-token",
+        ? "__Secure-eaglevents.session-token"
+        : "eaglevents.session-token",
```

### Step 5: Update package.json Metadata

Add useful metadata:

```json
{
  "name": "eaglevents",
  "version": "1.0.0",
  "description": "Event management system for facilities and venue scheduling",
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/eaglevents"
  },
  "keywords": ["events", "scheduling", "facilities", "venue-management"],
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=10.0.0"
  }
}
```

### Step 6: Search for Other References

Search the codebase for any remaining references:

```bash
# Windows PowerShell
Select-String -Path "src\**\*.ts","src\**\*.tsx" -Pattern "t3-app|t3app"

# Linux/Mac
grep -r "t3-app\|t3app" src/
```

Update any findings (comments, logs, etc.)

## Testing

1. Run type checking: `pnpm typecheck`
2. Run linting: `pnpm lint`
3. Build the project: `pnpm build`
4. Start dev server: `pnpm dev`
5. Verify:
   - App loads correctly
   - Authentication works
   - Database queries work
   - No console errors about cookies or sessions

## Cookie Migration Note

If you change cookie names, existing users will be logged out. Consider:

1. **Announce it**: Tell users they'll need to log in again
2. **Keep both**: Support both old and new cookie names temporarily
3. **Clear cookies**: Provide a logout-all endpoint

## Acceptance Criteria

- [ ] `package.json` name is "eaglevents"
- [ ] README.md has project-specific content
- [ ] Table prefix documented (or migrated if safe)
- [ ] Cookie names updated
- [ ] No references to "t3-app" remain in user-facing code
- [ ] Project builds successfully
- [ ] Authentication still works

## Commit Message

```bash
git add package.json README.md src/
git commit -m "chore: rebrand from t3-app-template to eaglevents

- Update package.json name and metadata
- Rewrite README with project-specific documentation
- Update cookie names for consistency
- Document table prefix retention for backward compatibility"
```

---

# Task 8: Write Project-Specific README

Your README.md currently contains generic T3 Stack template documentation. Replace it with comprehensive, project-specific documentation for EagleEvents.

## Context
- **Current**: Generic T3 template docs
- **Need**: Project overview, setup instructions, development guide
- **Audience**: New developers joining the project, deployment engineers, future you

## Task

Create a new `README.md` with the following structure:

```markdown
# EagleEvents

> Event management and venue scheduling system for educational facilities

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

EagleEvents is a comprehensive event management platform designed for university facilities and venue scheduling. It handles event creation, resource allocation, hour tracking, and Zendesk integration for support ticketing.

### Key Features

- 📅 **Calendar Management** - Multi-calendar support with Outlook-style views
- 🏢 **Facility Booking** - Building and room reservation system
- 👥 **Role-Based Access** - Granular permissions (Admin, Manager, Employee)
- ⏱️ **Hour Tracking** - Event hour logging and reporting
- 🎫 **Zendesk Integration** - Automatic ticket creation and confirmation
- 🔍 **Search** - Elasticsearch-powered profile and event search
- 🎨 **Themeable** - Per-department color schemes and branding
- 📊 **Analytics** - Event statistics, hour logs, and usage reports

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5.8 (strict mode) |
| API | tRPC v11 |
| Database | PostgreSQL + Drizzle ORM |
| Auth | NextAuth.js (JWT) |
| UI | React 19, Tailwind CSS 4 |
| Search | Elasticsearch 8 (optional) |
| Validation | Zod |
| Testing | Node test runner |

## Prerequisites

- Node.js 18 or higher
- PostgreSQL 14 or higher  
- pnpm 10 or higher
- (Optional) Elasticsearch 8+ for search features

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourorg/eaglevents.git
cd eaglevents
pnpm install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` and configure:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/eaglevents"

# Auth (generate with: openssl rand -base64 32)
NEXTAUTH_SECRET="your-super-secret-jwt-key-here"
NEXTAUTH_URL="http://localhost:3000"

# Optional: Elasticsearch
ENABLE_ELASTICSEARCH="true"
ELASTICSEARCH_NODE="http://localhost:9200"
ELASTICSEARCH_USERNAME="elastic"
ELASTICSEARCH_PASSWORD="changeme"
```

### 3. Database Setup

**Windows:**
```powershell
.\create-local-database.ps1
```

**Linux/Mac:**
```bash
chmod +x create-local-database.sh
./create-local-database.sh
```

**Or manually:**
```bash
createdb eaglevents
pnpm db:migrate
```

### 4. Start Development Server

```bash
pnpm dev
```

Visit http://localhost:3000 and complete the setup wizard to create your first organization.

## Development

### Available Commands

#### Development
```bash
pnpm dev          # Start dev server (localhost:3000)
pnpm build        # Production build
pnpm start        # Start production server
pnpm preview      # Build and start locally
```

#### Code Quality
```bash
pnpm check        # Lint + TypeScript check
pnpm lint         # ESLint
pnpm lint:fix     # Auto-fix linting issues
pnpm typecheck    # TypeScript validation
pnpm format:check # Check Prettier formatting
pnpm format:write # Apply Prettier formatting
pnpm test         # Run tests
```

#### Database
```bash
pnpm db:generate  # Generate migration from schema changes
pnpm db:migrate   # Apply pending migrations
pnpm db:push      # Push schema directly (dev only)
pnpm db:studio    # Open Drizzle Studio (database GUI)
```

#### User Management
```bash
pnpm user:create  # Create a user account
```

### Database Seeding

Populate your database with realistic test data:

```bash
# Full seed (workspace + 7 years of events)
pnpm seed

# Just workspace setup (business, departments, users)
pnpm seed:workspace

# Just events (workspace must exist)
pnpm seed:events

# Revert all seeded data
pnpm seed:revert
```

#### Advanced Seeding Options

```bash
# Seed production database
pnpm seed -- --target prod

# Custom event count
pnpm seed -- --events 100

# Deterministic data (same seed = same data)
pnpm seed -- --seed 42

# Combined
pnpm seed -- --target dev --events 50 --seed 123
```

## Project Structure

```
eaglevents/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── _components/        # Shared UI (AppShell, Navigation)
│   │   ├── admin/              # Admin dashboard
│   │   ├── calendar/           # Calendar views
│   │   ├── tickets/            # Ticketing interface
│   │   ├── setup/              # Onboarding wizard
│   │   └── api/                # REST API routes
│   ├── server/
│   │   ├── api/                # tRPC routers
│   │   │   ├── root.ts         # Main router
│   │   │   └── routers/        # Feature routers
│   │   ├── db/
│   │   │   ├── index.ts        # Database client
│   │   │   └── schema.ts       # Drizzle schema
│   │   └── services/           # Business logic
│   │       ├── permissions.ts  # Authorization
│   │       ├── calendar.ts     # Calendar helpers
│   │       └── setup.ts        # Onboarding logic
│   ├── middleware.ts           # Auth + setup middleware
│   ├── env.js                  # Environment validation
│   └── types/                  # Shared TypeScript types
├── drizzle/                    # Database migrations
├── scripts/                    # Utility scripts
└── public/                     # Static assets
```

## Key Concepts

### Authentication & Authorization

- **Authentication**: Handled by NextAuth with credentials provider
- **Session**: JWT tokens stored in httpOnly cookies
- **Authorization**: Role-based (Admin, Co-Admin, Manager, Employee)
- **Scopes**: Business-wide, Department, or Division level

### Multi-Tenancy

- Single database, multiple businesses supported
- Data isolated by `businessId` and enforced via tRPC middleware
- Setup wizard creates the first business

### Permission Model

```typescript
Admin        // Full access across business
├── Manager  // Department-level management
└── Employee // Limited to assigned events
```

See `src/server/services/permissions.ts` for implementation.

### Event Lifecycle

1. **Creation** - User creates event via calendar
2. **Assignment** - Event assigned to technician
3. **Confirmation** - Zendesk ticket confirmed
4. **Execution** - Hour logs track work time
5. **Reporting** - Data exported for analysis

## Configuration

### Environment Variables

#### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `NEXTAUTH_SECRET` | JWT signing secret (32+ chars) | `openssl rand -base64 32` |

#### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXTAUTH_URL` | App base URL | `http://localhost:3000` |
| `DEV_SERVER` | Dev server override | - |
| `ENABLE_ELASTICSEARCH` | Enable search | `false` |
| `ELASTICSEARCH_NODE` | ES endpoint | - |
| `DATABASE_URL_PROD` | Production DB (scripts) | - |

### Database

**Recommended PostgreSQL settings:**

```sql
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 1GB
```

**Connection pooling** is configured in `src/server/db/index.ts`:
- Dev: 5 connections
- Prod: 10 connections

## Testing

### Run Tests

```bash
pnpm test
```

### Writing Tests

Tests use Node's built-in test runner:

```typescript
// src/server/services/__tests__/example.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";

describe("MyService", () => {
  it("should do something", () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

## Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables:
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
4. Deploy

**Note**: Use external PostgreSQL (Neon, Supabase, Railway) - Vercel has no database.

### Docker

```dockerfile
# Build
docker build -t eaglevents .

# Run
docker run -p 3000:3000 \
  -e DATABASE_URL="..." \
  -e NEXTAUTH_SECRET="..." \
  eaglevents
```

### Traditional VPS

```bash
# Build
pnpm build

# Run with PM2
pm2 start pnpm --name eaglevents -- start

# Or direct
pnpm start
```

## Troubleshooting

### "Module not found" errors
```bash
rm -rf .next node_modules
pnpm install
pnpm dev
```

### Database connection fails
- Check PostgreSQL is running: `pg_isready`
- Verify `DATABASE_URL` format
- Test connection: `psql $DATABASE_URL`

### Setup wizard loops
- Check `setupCompletedAt` in business table
- Clear cookies and try again
- Run: `pnpm db:studio` to inspect data

### TypeScript errors after update
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm typecheck
```

## Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes
3. Run checks: `pnpm check && pnpm test`
4. Commit: `git commit -m "feat: add my feature"`
5. Push and create PR

### Commit Convention

- `feat:` New feature
- `fix:` Bug fix
- `chore:` Maintenance (deps, config)
- `docs:` Documentation
- `refactor:` Code restructure
- `test:` Test updates

## License

MIT © [Your Organization]

## Support

- **Issues**: https://github.com/yourorg/eaglevents/issues
- **Docs**: https://github.com/yourorg/eaglevents/wiki
- **Email**: support@yourorg.com
```

## Acceptance Criteria

- [ ] README.md replaced with project-specific content
- [ ] All sections are relevant to EagleEvents (no T3 template content)
- [ ] Setup instructions are accurate and tested
- [ ] Commands and scripts match actual `package.json`
- [ ] Links and badges updated (or removed if not applicable)
- [ ] Project structure reflects actual directories
- [ ] Troubleshooting section included
- [ ] Markdown formatting is correct

## Commit

```bash
git add README.md
git commit -m "docs: write comprehensive project README

Replace T3 template documentation with EagleEvents-specific guide:
- Project overview and features
- Complete setup instructions
- Development workflow
- Database seeding guide
- Deployment options
- Troubleshooting section"
```

---

# Task 9: Fix Filename Typo

You have a typo in a shell script filename that should be corrected.

## Context
- **Current**: `create-local-databse.sh`
- **Correct**: `create-local-database.sh`
- **Issue**: Missing letter 'a' in "database"

## Task

### Step 1: Check Git History

First, verify if this file is tracked in git:

```bash
git log --all --oneline -- create-local-databse.sh
```

### Step 2: Rename the File

**Option A: File is NOT in git yet**

```bash
# Windows (PowerShell)
Rename-Item -Path "create-local-databse.sh" -NewName "create-local-database.sh"

# Linux/Mac
mv create-local-databse.sh create-local-database.sh
```

Then add it:
```bash
git add create-local-database.sh
```

**Option B: File IS tracked in git**

Use `git mv` to preserve history:

```bash
git mv create-local-databse.sh create-local-database.sh
```

### Step 3: Update References

Search for any references to the old filename:

```bash
# Windows (PowerShell)
Select-String -Path "README.md","*.md","*.sh","*.ps1" -Pattern "databse"

# Linux/Mac  
grep -r "databse" . --include="*.md" --include="*.sh" --include="*.ps1"
```

Update any found references:
- `README.md` (if it mentions the script)
- `package.json` (if there's a script referencing it)
- Documentation files
- Other setup scripts

### Step 4: Verify Script Still Works

Test the renamed script:

```bash
# Linux/Mac
chmod +x create-local-database.sh
./create-local-database.sh --help

# Or run it if safe
./create-local-database.sh
```

### Step 5: Check for Similar Typos

While you're at it, search for other potential typos:

```bash
# Common typos
grep -ri "databse\|databas\|dtabase" .
grep -ri "sevrer\|serevr" .
grep -ri "conifg\|cofig" .
```

## Testing

1. Verify old filename is gone:
   ```bash
   ls -la create-local-databse.sh  # Should fail
   ```

2. Verify new filename exists:
   ```bash
   ls -la create-local-database.sh  # Should succeed
   ```

3. Test script execution:
   ```bash
   ./create-local-database.sh --help
   ```

4. Check git status:
   ```bash
   git status
   # Should show rename, not delete + add
   ```

## Commit

```bash
git add .
git commit -m "fix: correct typo in database setup script filename

Renamed: create-local-databse.sh → create-local-database.sh"
```

Or if using `git mv`:

```bash
git commit -m "fix: correct typo in database setup script filename

Renamed: create-local-databse.sh → create-local-database.sh
Git history preserved through git mv"
```

## Acceptance Criteria

- [ ] File renamed from `create-local-databse.sh` to `create-local-database.sh`
- [ ] Git history preserved (if file was tracked)
- [ ] All references updated in docs
- [ ] Script still executes correctly
- [ ] No other typos found in filenames
- [ ] Changes committed

## Additional Notes

If you find the same typo in the Windows PowerShell version, fix that too:
- Check for: `create-local-databse.ps1`
- Should be: `create-local-database.ps1`

---

# Task 10: Remove or Make Optional Development Delay

Your tRPC configuration adds an artificial 100-500ms delay to every request in development. This is intended to simulate network latency but makes development unnecessarily slow.

## Context
- **File**: `src/server/api/trpc.ts`
- **Issue**: Random 100-500ms delay on EVERY tRPC call in dev mode
- **Impact**: Slow development experience, harder to debug fast interactions
- **Goal**: Make it optional or remove it entirely

## Current Code

```typescript
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});
```

## Task - Choose One Approach

### Option 1: Remove Delay Entirely (Recommended)

**Simplest solution** - just remove the delay:

```typescript
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();
  
  const result = await next();
  
  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);
  
  return result;
});
```

### Option 2: Make It Opt-In via Environment Variable

Keep the delay but require explicit enablement:

```typescript
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  // Only delay if explicitly enabled
  if (t._config.isDev && process.env.ENABLE_DEV_DELAY === "true") {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    console.log(`[TRPC] Artificial delay: ${waitMs}ms`);
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});
```

Then update `.env.example`:

```bash
# Development: Simulate network latency (optional)
# ENABLE_DEV_DELAY=true
```

### Option 3: Make It Configurable

Allow custom delay ranges via environment variables:

```typescript
const DEV_DELAY_MIN = parseInt(process.env.DEV_DELAY_MIN ?? "0", 10);
const DEV_DELAY_MAX = parseInt(process.env.DEV_DELAY_MAX ?? "0", 10);

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev && DEV_DELAY_MAX > 0) {
    const range = DEV_DELAY_MAX - DEV_DELAY_MIN;
    const waitMs = Math.floor(Math.random() * range) + DEV_DELAY_MIN;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    console.log(`[TRPC] Artificial delay: ${waitMs}ms`);
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});
```

`.env.example`:
```bash
# Development: Simulate network latency (ms)
# DEV_DELAY_MIN=100
# DEV_DELAY_MAX=500
```

### Option 4: Only Delay Specific Endpoints

Keep delay but only for specific patterns:

```typescript
const DELAYED_PATHS = [
  /^event\.create/,
  /^admin\./,
  // Add patterns you want to test with delay
];

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (
    t._config.isDev && 
    process.env.ENABLE_DEV_DELAY === "true" &&
    DELAYED_PATHS.some(pattern => pattern.test(path))
  ) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});
```

## Recommendation

**For most developers: Use Option 1** (remove entirely)

Use Option 2 if:
- You're testing loading states
- You're working on offline-first features
- You're demonstrating the app and want realistic feel

Use Option 3 if:
- You need to test various network conditions
- You're doing performance profiling

Use Option 4 if:
- You only care about specific slow endpoints

## Implementation

### Step 1: Choose and Apply Your Option

Edit `src/server/api/trpc.ts` with your chosen approach.

### Step 2: Update .env.example (If Using Options 2-4)

Add relevant environment variable documentation:

```bash
# ======================
# Development Options
# ======================

# Simulate network latency in development (optional)
# Useful for testing loading states and optimistic updates
# ENABLE_DEV_DELAY=true
# DEV_DELAY_MIN=100
# DEV_DELAY_MAX=500
```

### Step 3: Update Documentation

Add to `README.md` under Development section (if using options 2-4):

```markdown
### Simulating Network Latency

To test loading states and slow networks:

```bash
# Enable artificial delay (100-500ms per request)
ENABLE_DEV_DELAY=true pnpm dev
```

Or configure in `.env`:
```bash
ENABLE_DEV_DELAY=true
DEV_DELAY_MIN=100  # Minimum delay in ms
DEV_DELAY_MAX=500  # Maximum delay in ms
```
```

### Step 4: Test

1. Start dev server: `pnpm dev`
2. Open the app and interact with it
3. Verify:
   - **Option 1**: Fast responses (no delay)
   - **Option 2**: Fast by default, slow with `ENABLE_DEV_DELAY=true`
   - **Option 3**: Configurable delays work
   - **Option 4**: Only specified paths delayed

4. Check console logs:
   ```
   [TRPC] event.list took 15ms to execute  # Should be fast
   ```

## Alternative: Keep Logging, Remove Delay

If you like the timing logs but not the delay:

```typescript
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  
  // Log slow queries only
  if (duration > 1000) {
    console.warn(`[TRPC] ⚠️  Slow query: ${path} took ${duration}ms`);
  } else if (duration > 100) {
    console.log(`[TRPC] ${path} took ${duration}ms`);
  }
  
  return result;
});
```

## Acceptance Criteria

- [ ] Artificial delay removed OR made opt-in
- [ ] Development server feels faster
- [ ] Timing logs still work (optional)
- [ ] Environment variables documented (if added)
- [ ] README updated (if relevant)
- [ ] Code passes `pnpm typecheck`

## Testing Checklist

- [ ] Load a page with multiple tRPC calls - should feel instant
- [ ] Submit a form - should respond quickly
- [ ] Enable delay (if opt-in) - should be noticeably slower
- [ ] Console logs show timing info
- [ ] No TypeScript errors

## Commit Message

**For Option 1 (Remove):**
```bash
git commit -m "perf: remove artificial dev delay from tRPC middleware

Removed 100-500ms random delay that slowed down development.
Kept timing logs for performance monitoring."
```

**For Option 2 (Opt-In):**
```bash
git commit -m "perf: make dev delay opt-in via ENABLE_DEV_DELAY

Changed artificial delay from always-on to opt-in for better DX.
Useful for testing loading states when needed."
```

---

# Summary Checklist

Use this to track completion of all tasks:

```markdown
## Security (Critical)
- [ ] Task 1: Implement Protected Procedures
- [ ] Task 2: Add Rate Limiting
- [ ] Task 3: Fix Timing Attack in Login

## Data Integrity (High Priority)
- [ ] Task 4: Fix Migration Files
- [ ] Task 5: Database Connection Pooling
- [ ] Task 6: Update .gitignore

## Code Quality (Medium Priority)
- [ ] Task 7: Rename Project from Template
- [ ] Task 8: Write Project-Specific README
- [ ] Task 9: Fix Filename Typo
- [ ] Task 10: Remove/Make Optional Dev Delay

## Post-Completion
- [ ] Run `pnpm check` (no errors)
- [ ] Run `pnpm build` (successful)
- [ ] Test authentication (login/logout works)
- [ ] Test protected routes (401 when not logged in)
- [ ] Test rate limiting (blocks after threshold)
- [ ] All tests pass (`pnpm test`)
```