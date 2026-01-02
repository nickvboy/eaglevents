# EagleEvents

> Event management and venue scheduling system for educational facilities

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

EagleEvents is a comprehensive event management platform designed for university facilities and venue scheduling. It handles event creation, resource allocation, hour tracking, and Zendesk integration for support ticketing.

### Key Features

- Calendar management with multi-calendar views
- Facility booking for buildings and rooms
- Role-based access (Admin, Manager, Employee)
- Hour tracking with reporting
- Zendesk integration for tickets and confirmations
- Search with optional Elasticsearch
- Themeable UI per department
- Analytics for events, hours, and usage

## Tech Stack

| Layer | Technology |
| --- | --- |
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
- Optional: Elasticsearch 8+ for search features

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

Windows:

```powershell
.\create-local-database.ps1
```

Linux or Mac:

```bash
chmod +x create-local-databse.sh
./create-local-databse.sh
```

Or manually:

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

Development:

```bash
pnpm dev          # Start dev server (localhost:3000)
pnpm build        # Production build
pnpm start        # Start production server
pnpm preview      # Build and start locally
```

Code quality:

```bash
pnpm check        # Lint + TypeScript check
pnpm lint         # ESLint
pnpm lint:fix     # Auto-fix linting issues
pnpm typecheck    # TypeScript validation
pnpm format:check # Check Prettier formatting
pnpm format:write # Apply Prettier formatting
pnpm test         # Run tests
```

Database:

```bash
pnpm db:generate  # Generate migration from schema changes
pnpm db:migrate   # Apply pending migrations
pnpm db:push      # Push schema directly (dev only)
pnpm db:studio    # Open Drizzle Studio
```

User management:

```bash
pnpm user:create  # Create a user account
```

### Database Seeding

Populate your database with realistic test data:

```bash
pnpm seed            # Full seed (workspace + historical events)
pnpm seed:workspace  # Workspace setup only
pnpm seed:events     # Events only (workspace must exist)
pnpm seed:full       # Full seed with 7 years of historical data
pnpm seed:revert     # Delete seeded data and return to onboarding
```

Advanced seeding options:

```bash
pnpm seed -- --target prod
pnpm seed -- --events 100
pnpm seed -- --seed 42
pnpm seed -- --department-events department:12=40,division:15=10
pnpm seed -- --target dev --events 50 --seed 123
```

## Project Structure

```
eaglevents/
+-- src/
¦   +-- app/                    # Next.js App Router
¦   ¦   +-- _components/        # Shared UI
¦   ¦   +-- admin/              # Admin dashboard
¦   ¦   +-- calendar/           # Calendar views
¦   ¦   +-- tickets/            # Ticketing interface
¦   ¦   +-- setup/              # Onboarding wizard
¦   ¦   +-- api/                # REST API routes
¦   +-- server/
¦   ¦   +-- api/                # tRPC routers
¦   ¦   ¦   +-- root.ts         # Main router
¦   ¦   ¦   +-- routers/        # Feature routers
¦   ¦   +-- db/                 # Database client and schema
¦   ¦   +-- services/           # Business logic
¦   +-- trpc/                    # tRPC React hooks
¦   +-- middleware.ts           # Auth + setup middleware
¦   +-- env.js                  # Environment validation
¦   +-- types/                  # Shared TypeScript types
+-- drizzle/                    # Database migrations
+-- scripts/                    # Utility scripts
+-- public/                     # Static assets
```

## Key Concepts

### Authentication and Authorization

- Authentication uses NextAuth with credentials provider
- Sessions use JWT tokens stored in httpOnly cookies
- Authorization is role-based (Admin, Co-Admin, Manager, Employee)
- Scopes can be business-wide, department, or division level

### Multi-Tenancy

- Single database, multiple businesses supported
- Data isolated by `businessId` and enforced via tRPC middleware
- Setup wizard creates the first business

### Permission Model

```text
Admin
+-- Manager
+-- Employee
```

See `src/server/services/permissions.ts` for implementation.

### Event Lifecycle

1. Creation - user creates event via calendar
2. Assignment - event assigned to technician
3. Confirmation - Zendesk ticket confirmed
4. Execution - hour logs track work time
5. Reporting - data exported for analysis

## Configuration

### Environment Variables

Required:

| Variable | Description | Example |
| --- | --- | --- |
| DATABASE_URL | PostgreSQL connection string | postgresql://... |
| NEXTAUTH_SECRET | JWT signing secret (32+ chars) | openssl rand -base64 32 |

Optional:

| Variable | Description | Default |
| --- | --- | --- |
| NEXTAUTH_URL | App base URL | http://localhost:3000 |
| DEV_SERVER | Dev server override | - |
| DEV_SERVER_PROD | Prod dev server override | - |
| ENABLE_ELASTICSEARCH | Enable search | false |
| ELASTICSEARCH_NODE | Elasticsearch endpoint | - |
| ELASTICSEARCH_USERNAME | Elasticsearch username | - |
| ELASTICSEARCH_PASSWORD | Elasticsearch password | - |
| ELASTICSEARCH_PROFILE_INDEX | Elasticsearch profile index | - |
| DATABASE_URL_PROD | Production DB (scripts) | - |

### Database

Recommended PostgreSQL settings:

```sql
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 1GB
```

Connection pooling is configured in `src/server/db/index.ts`.

## Testing

Run tests:

```bash
pnpm test
```

Tests use Node's built-in test runner:

```ts
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
   - DATABASE_URL
   - NEXTAUTH_SECRET
   - NEXTAUTH_URL
4. Deploy

Note: Use external PostgreSQL (Neon, Supabase, Railway). Vercel has no built-in database.

### Docker

```bash
docker build -t eaglevents .

docker run -p 3000:3000 \
  -e DATABASE_URL="..." \
  -e NEXTAUTH_SECRET="..." \
  eaglevents
```

### Traditional VPS

```bash
pnpm build
pm2 start pnpm --name eaglevents -- start
```

## Troubleshooting

### Module not found errors

```bash
rm -rf .next node_modules
pnpm install
pnpm dev
```

### Database connection fails

- Check PostgreSQL is running: `pg_isready`
- Verify DATABASE_URL format
- Test connection: `psql $DATABASE_URL`

### Setup wizard loops

- Check setupCompletedAt in business table
- Clear cookies and try again
- Run `pnpm db:studio` to inspect data

### TypeScript errors after update

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm typecheck
```

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes
3. Run checks: `pnpm check && pnpm test`
4. Commit: `git commit -m "feat: add my feature"`
5. Push and create PR

### Commit Convention

- feat: New feature
- fix: Bug fix
- chore: Maintenance (deps, config)
- docs: Documentation
- refactor: Code restructure
- test: Test updates

## License

MIT (Your Organization)

## Support

- Issues: https://github.com/yourorg/eaglevents/issues
- Docs: https://github.com/yourorg/eaglevents/wiki
- Email: support@yourorg.com