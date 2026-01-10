# EagleEvents

> A comprehensive event management and venue scheduling system for educational facilities, designed to streamline operations, resource allocation, and team coordination.

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![tRPC](https://img.shields.io/badge/tRPC-11-blue)](https://trpc.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development Guide](#development-guide)
- [Project Structure](#project-structure)
- [Core Concepts](#core-concepts)
- [Configuration](#configuration)
- [Database Management](#database-management)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Overview

**EagleEvents** is a full-stack TypeScript application built for university facilities management teams. It provides a centralized platform to manage events, track work hours, coordinate staff assignments, and integrate with external systems like Zendesk for support ticketing.

### What It Does

- **Event Management**: Create, schedule, and track events across multiple calendars
- **Facility Booking**: Reserve buildings, rooms, and equipment
- **Team Coordination**: Assign staff, track hours, and manage workload
- **Access Control**: Role-based permissions (Admin, Manager, Employee) with department/division scopes
- **Integration**: Connect with Zendesk for automated ticketing and confirmations
- **Reporting**: Export hour logs and generate analytics dashboards

### Who It's For

- Facilities management departments
- Event coordination teams
- University operations staff
- Venue managers
- Technical support coordinators

---

## Core Features

### 🗓️ Calendar & Scheduling
- Multi-calendar views (week, month, agenda)
- Drag-and-drop event creation
- Color-coded event categories
- iCalendar (.ics) import/export
- Recurring event support

### 🏢 Facility Management
- Building and room booking
- Resource allocation and conflicts detection
- Virtual event flagging
- Location-based event filtering

### 👥 Team Management
- Role-based access control (RBAC)
- Department and division hierarchies
- Staff assignment to events
- Hour logging and timesheet tracking
- Profile search with Elasticsearch (optional)

### 🎨 Customization
- Department-specific color themes
- Custom form fields per event type
- Configurable event categories
- Themeable UI components

### 📊 Reporting & Analytics
- Hour log exports (Excel)
- Event attendance tracking
- Usage analytics by department
- Historical data visualization

### 🔗 Integrations
- **Zendesk**: Automated ticket creation and confirmation tracking
- **Elasticsearch**: Fast profile search (optional)
- **REST API**: Custom integrations via API routes

---

## Tech Stack

EagleEvents leverages modern, type-safe technologies for performance and developer experience:

### Core Framework
- **Next.js 15** - App Router with React Server Components
- **TypeScript 5.8** - Strict mode for complete type safety
- **React 19** - Latest React features and concurrent rendering

### Backend & API
- **tRPC v11** - End-to-end type-safe API without code generation
- **PostgreSQL** - Robust relational database
- **Drizzle ORM** - Type-safe database queries with zero overhead
- **NextAuth.js** - Authentication with JWT sessions

### Frontend & Styling
- **Tailwind CSS 4** - Utility-first CSS framework
- **Radix UI** - Accessible component primitives
- **React Hook Form** - Performant form management
- **Zod** - Runtime validation and type inference

### Optional Services
- **Elasticsearch 8** - Fast profile search (not required for core functionality)
- **Zendesk API** - Ticketing integration (configurable)

### Development Tools
- **Node test runner** - Built-in testing without external dependencies
- **ESLint** - Code quality and consistency
- **Prettier** - Code formatting
- **pnpm** - Fast, disk-efficient package manager

---

## Prerequisites

Before getting started, ensure you have:

### Required
- **Node.js 18+** - [Download](https://nodejs.org/)
- **PostgreSQL 14+** - [Download](https://www.postgresql.org/download/)
- **pnpm 10+** - Install via `npm install -g pnpm`

### Optional
- **Elasticsearch 8+** - For enhanced profile search ([Download](https://www.elastic.co/downloads/elasticsearch))
- **Git** - For version control

### System Requirements
- **OS**: Windows 10+, macOS 10.15+, or Linux
- **RAM**: 4GB minimum, 8GB recommended
- **Disk**: 500MB for dependencies + database space

---

## Getting Started

Follow these steps to get EagleEvents running locally in under 5 minutes:

### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/yourorg/eaglevents.git
cd eaglevents
pnpm install
```

> **Note**: First install takes 2-3 minutes depending on your connection.

### Step 2: Configure Environment

Create your local environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Database Connection
DATABASE_URL="postgresql://user:password@localhost:5432/eaglevents"

# Authentication (generate secret with: openssl rand -base64 32)
NEXTAUTH_SECRET="your-super-secret-jwt-key-minimum-32-characters"
NEXTAUTH_URL="http://localhost:3000"

# Optional: Search Enhancement
ENABLE_ELASTICSEARCH="false"  # Set to "true" if using Elasticsearch
# ELASTICSEARCH_NODE="http://localhost:9200"
# ELASTICSEARCH_USERNAME="elastic"
# ELASTICSEARCH_PASSWORD="changeme"
```

> **Security**: Never commit `.env` to version control. The `.gitignore` file already excludes it.

### Step 3: Set Up Database

Choose your platform:

**Windows (PowerShell):**
```powershell
.\create-local-database.ps1
```

**Linux/macOS:**
```bash
chmod +x create-local-databse.sh
./create-local-databse.sh
```

**Manual Setup (any platform):**
```bash
createdb eaglevents
pnpm db:migrate
```

> **Troubleshooting**: If `createdb` command not found, ensure PostgreSQL bin directory is in your PATH.

### Step 4: Launch the Application

```bash
pnpm dev
```

The server will start at **http://localhost:3000**

### Step 5: Complete Setup Wizard

1. Navigate to `http://localhost:3000`
2. You'll be redirected to the setup wizard
3. Fill in:
   - Organization name
   - Admin user credentials
   - Department structure (optional)
4. Click "Complete Setup"

Your system is now ready! 🎉

### Next Steps

- **Create test data**: Run `pnpm seed` to populate with sample events
- **Create users**: Use `pnpm user:create` to add team members
- **Explore calendar**: Visit `/calendar` to start managing events

---

## Development Guide

### Development Commands

#### Running the Application

```bash
pnpm dev          # Start development server at localhost:3000
pnpm build        # Create optimized production build
pnpm start        # Run production build locally
pnpm preview      # Build + start in one command
```

#### Code Quality & Testing

```bash
pnpm check        # Run ALL checks (lint + typecheck + format)
pnpm lint         # Run ESLint
pnpm lint:fix     # Auto-fix linting issues
pnpm typecheck    # Validate TypeScript types
pnpm format:check # Check code formatting
pnpm format:write # Apply Prettier formatting
pnpm test         # Run all tests
```

> **Tip**: Always run `pnpm check` before committing to catch issues early.

#### Database Commands

```bash
pnpm db:generate  # Generate migration file from schema changes
pnpm db:migrate   # Apply all pending migrations
pnpm db:push      # Push schema changes directly (dev only - skips migrations)
pnpm db:studio    # Launch Drizzle Studio (visual database explorer)
```

> **Warning**: `db:push` is for development only. Use `db:generate` + `db:migrate` for production.

#### User Management

```bash
pnpm user:create  # Interactive CLI to create user accounts
```

---

## Database Management

### Migrations Workflow

When you modify the database schema in `src/server/db/schema.ts`:

1. **Generate migration**:
   ```bash
   pnpm db:generate
   ```
   This creates a new SQL file in `drizzle/` folder.

2. **Review migration**:
   Open the generated SQL file to verify changes.

3. **Apply migration**:
   ```bash
   pnpm db:migrate
   ```

4. **Commit migration file**:
   ```bash
   git add drizzle/
   git commit -m "Add migration for [feature]"
   ```

### Seeding Test Data

Populate your database with realistic test data for development using the interactive seeding CLI:

#### Seed Modes

The seeding system has four modes:

| Mode | Command | What It Does |
| --- | --- | --- |
| **workspace** | `pnpm seed:workspace` | Creates organization structure: departments, divisions, users, calendars |
| **events** | `pnpm seed:events` | Adds events to existing workspace (requires workspace to exist) |
| **full** | `pnpm seed:full` | Complete seed: workspace + events with default count |
| **revert** | `pnpm seed:revert` | **⚠️ Destructive**: Deletes all seeded data, resets to onboarding |

#### Quick Start Seeding

```bash
# After initial setup, seed everything
pnpm seed:full

# Or use the default command (same as seed:full)
pnpm seed
```

#### Advanced CLI Options

The seeding script (`scripts/seed.ts`) supports these options:

```bash
# Specify mode explicitly
pnpm seed -- --mode workspace
pnpm seed -- --mode events
pnpm seed -- --mode full
pnpm seed -- --mode revert

# Target production database (requires DATABASE_URL_PROD in .env)
pnpm seed -- --target prod
pnpm seed -- --target prod --mode full
pnpm seed:dev              # Explicitly target dev (default)

# Control number of events
pnpm seed -- --events 100          # Create exactly 100 events
pnpm seed -- --mode events --events 50

# Use reproducible random seed (same data every time)
pnpm seed -- --seed 42
pnpm seed -- --mode full --seed 1234

# Target specific departments/divisions
pnpm seed -- --department-events department:12=40,division:15=10
# Creates 40 events in department 12, 10 events in division 15

# Combine multiple options
pnpm seed -- --target prod --events 75 --seed 999
pnpm seed -- --mode events --events 50 --seed 123

# Get help
pnpm seed -- --help
```

#### CLI Options Reference

| Option | Values | Description | Example |
| --- | --- | --- | --- |
| `--mode` | workspace, events, full, revert | Seeding mode | `--mode events` |
| `--target` | dev, prod | Database target (requires DATABASE_URL_PROD) | `--target prod` |
| `--events` | number | Number of events to create | `--events 100` |
| `--seed` | number | Faker random seed for reproducible data | `--seed 42` |
| `--department-events` | scope:id=count,... | Events per department/division | `department:5=20` |

#### Seeding Workflow Examples

**Fresh Start:**
```bash
# 1. Complete setup wizard first
pnpm dev  # Navigate to http://localhost:3000/setup

# 2. Seed full database
pnpm seed:full
```

**Add More Events:**
```bash
# Add 50 more events to existing workspace
pnpm seed:events -- --events 50
```

**Testing with Consistent Data:**
```bash
# Use same seed for reproducible test data
pnpm seed -- --seed 12345
```

**Department-Specific Testing:**
```bash
# Find department IDs in database
pnpm db:studio

# Seed specific departments
pnpm seed:events -- --department-events department:3=30,department:5=20
```

**Seed Production Database:**
```bash
# 1. Add production database URL to .env
# DATABASE_URL_PROD="postgresql://user:pass@prod-server:5432/eaglevents"

# 2. Seed production (e.g., after initial production setup)
pnpm seed -- --target prod --mode full

# 3. Or add specific events to production
pnpm seed -- --target prod --mode events --events 25
```

**Reset Everything:**
```bash
# ⚠️ Warning: This deletes all seeded data!
pnpm seed:revert

# For production (use with extreme caution!)
pnpm seed -- --target prod --mode revert

# Now you can re-run setup wizard
pnpm dev
```

> **Best Practice**: Use `pnpm seed:full` after initial setup to have realistic data for testing. Use `--seed` option when you need consistent test data across runs.

> **Production Seeding**: Use `--target prod` carefully! Always test your seeding commands on dev first. The `revert` mode is destructive and will delete all seeded data.

---

## Project Structure

```
eaglevents/
├── src/
│   ├── app/                      # Next.js App Router (routes & pages)
│   │   ├── _components/          # Shared UI components
│   │   │   ├── AppShell.tsx      # Main layout shell
│   │   │   ├── GlobalSearch.tsx  # Search functionality
│   │   │   ├── SidebarNav.tsx    # Navigation sidebar
│   │   │   └── theme/            # Theming components
│   │   ├── admin/                # Admin dashboard
│   │   │   └── _components/      # Admin-specific UI
│   │   ├── calendar/             # Calendar views & event management
│   │   │   ├── _components/      # Calendar UI (grid, cards, drawers)
│   │   │   └── utils/            # Date helpers, layout logic
│   │   ├── tickets/              # Zendesk ticket integration
│   │   ├── setup/                # Onboarding wizard
│   │   ├── profile/              # User profile pages
│   │   ├── settings/             # User settings
│   │   ├── api/                  # REST API routes
│   │   │   ├── auth/             # NextAuth endpoints
│   │   │   ├── trpc/             # tRPC HTTP handler
│   │   │   └── health/           # Health check endpoint
│   │   ├── layout.tsx            # Root layout
│   │   └── providers.tsx         # Context providers
│   │
│   ├── server/                   # Backend logic
│   │   ├── api/                  # tRPC API layer
│   │   │   ├── root.ts           # Main router composition
│   │   │   ├── routers/          # Feature-specific routers
│   │   │   │   ├── calendar.ts   # Calendar operations
│   │   │   │   ├── event.ts      # Event CRUD
│   │   │   │   ├── admin.ts      # Admin operations
│   │   │   │   └── ...           # Other routers
│   │   │   └── trpc.ts           # tRPC context & middleware
│   │   ├── db/                   # Database layer
│   │   │   ├── index.ts          # Database client
│   │   │   ├── schema.ts         # Drizzle schema definitions
│   │   │   └── health.ts         # DB health checks
│   │   ├── services/             # Business logic layer
│   │   │   ├── calendar.ts       # Calendar business logic
│   │   │   ├── permissions.ts    # Authorization helpers
│   │   │   ├── theme.ts          # Theming service
│   │   │   └── ...               # Other services
│   │   ├── auth.ts               # NextAuth configuration
│   │   └── rate-limit.ts         # Rate limiting utilities
│   │
│   ├── trpc/                     # tRPC React integration
│   │   ├── react.tsx             # React hooks & provider
│   │   ├── server.ts             # Server-side tRPC caller
│   │   └── query-client.ts       # React Query config
│   │
│   ├── types/                    # Shared TypeScript types
│   ├── styles/                   # Global styles
│   ├── config/                   # App configuration
│   ├── middleware.ts             # Next.js middleware (auth, setup checks)
│   └── env.js                    # Environment variable validation
│
├── drizzle/                      # Database migrations (SQL)
│   └── meta/                     # Migration metadata
│
├── scripts/                      # Utility scripts
│   ├── dev.cjs                   # Custom dev server
│   ├── create-user.mjs           # User creation CLI
│   └── seed.ts                   # Database seeding
│
├── public/                       # Static assets
└── [config files]                # TypeScript, ESLint, Prettier, etc.
```

### Key Architectural Patterns

- **App Router**: Server-first rendering with React Server Components
- **tRPC**: Type-safe API calls without manual API routes
- **Colocation**: Feature components live near their routes (`_components/`)
- **Service Layer**: Business logic separated from API routes (`server/services/`)
- **Type Sharing**: Database schema generates TypeScript types automatically

---

## Core Concepts

## Key Concepts

### Authentication & Authorization

**Authentication Flow:**
1. User submits credentials via login form
2. NextAuth validates against database
3. JWT token issued and stored in httpOnly cookie
4. Token includes user ID, role, and business context
5. Middleware validates token on protected routes

**Authorization Model:**

```
Admin (Co-Admin)
├── Full business access
├── Manage departments & divisions
├── User management
├── System settings
└── All manager/employee permissions

Manager
├── Department/division scope
├── Create & edit events
├── Assign staff
├── View reports
└── All employee permissions

Employee
├── View assigned events
├── Log hours
└── View own calendar
```

**Scope Levels:**
- **Business-wide**: Admin sees everything
- **Department-level**: Manager sees their department
- **Division-level**: Manager sees specific division only
- **Individual**: Employee sees only assigned work

> **Implementation**: See `src/server/services/permissions.ts` for detailed authorization logic.

### Multi-Tenancy Architecture

EagleEvents supports multiple organizations in a single database:

- **Data Isolation**: All queries filtered by `businessId`
- **Enforcement**: tRPC middleware automatically scopes all operations
- **Setup**: First-time wizard creates initial business
- **Expansion**: Additional businesses can be created by system admins

```typescript
// Every database query is automatically scoped
const events = await db.query.events.findMany({
  where: eq(schema.events.businessId, ctx.session.user.businessId)
});
```

### Event Lifecycle

Understanding how events flow through the system:

**1. Creation**
- User creates event via calendar interface
- Event details stored: title, time, location, attendees
- Color category assigned based on event type

**2. Assignment**
- Manager assigns technicians to event
- Assigned staff receive notifications
- Event appears on staff member's calendar

**3. Integration**
- Optional: Zendesk ticket created automatically
- Ticket ID linked to event
- Confirmation tracking enabled

**4. Execution**
- Staff log hours worked on event
- Hour logs tracked per person per event
- Notes and details captured

**5. Reporting**
- Data exported for analysis (Excel)
- Metrics: hours worked, event count, utilization
- Archived for historical reference

### Data Model Highlights

**Core Entities:**
- `Business` - Top-level organization
- `Department` & `Division` - Organizational units
- `User` & `Profile` - Authentication + user info
- `Calendar` - Event containers (per department/division)
- `Event` - Scheduled activities
- `EventAssignee` - Staff assignments
- `HourLog` - Time tracking entries
- `Building` & `Room` - Facility resources

**Key Relationships:**
- Users belong to a Business
- Calendars belong to Departments or Divisions
- Events belong to Calendars
- EventAssignees link Users to Events
- HourLogs track time per User per Event

---

## Configuration

### Environment Variables

EagleEvents uses environment variables for configuration. All variables are validated at startup via `src/env.js`.

#### Required Variables

| Variable | Description | Example | How to Generate |
| --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/eaglevents` | Set up Postgres database |
| `NEXTAUTH_SECRET` | JWT signing secret (32+ chars) | `abc123...` | `openssl rand -base64 32` |

#### Optional Variables

| Variable | Description | Default | Notes |
| --- | --- | --- | --- |
| `NEXTAUTH_URL` | Application base URL | `http://localhost:3000` | Update in production |
| `NODE_ENV` | Environment mode | `development` | Auto-set by Next.js |
| `DEV_SERVER` | Dev server override URL | - | For custom dev setup |
| `DEV_SERVER_PROD` | Prod dev server URL | - | For production testing |

#### Elasticsearch (Optional)

| Variable | Description | Default | Required If |
| --- | --- | --- | --- |
| `ENABLE_ELASTICSEARCH` | Enable profile search | `false` | Using search |
| `ELASTICSEARCH_NODE` | Elasticsearch endpoint | - | Enabled |
| `ELASTICSEARCH_USERNAME` | Auth username | - | Auth required |
| `ELASTICSEARCH_PASSWORD` | Auth password | - | Auth required |
| `ELASTICSEARCH_PROFILE_INDEX` | Index name | `profiles` | Custom index |

#### Production Database (For Scripts & Seeding)

| Variable | Description | Example | When Needed |
| --- | --- | --- | --- |
| `DATABASE_URL_PROD` | Production database connection string | `postgresql://user:pass@prod-server:5432/eaglevents` | Running scripts against production: `--target prod` |

**Example `.env` setup:**
```bash
# Development database (default)
DATABASE_URL="postgresql://localhost:5432/eaglevents_dev"

# Production database (for seeding/migrations with --target prod)
DATABASE_URL_PROD="postgresql://prod-server:5432/eaglevents_prod"
```

**Usage:**
```bash
# Seed production database
pnpm seed -- --target prod

# Run migrations on production
# Note: Migrations always use DATABASE_URL by default
# Set DATABASE_URL temporarily or use connection string directly
```

> **Security**: Store production credentials securely. Never commit `.env` to version control.

### Database Configuration

#### Recommended PostgreSQL Settings

```sql
-- Performance tuning
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

-- Connection settings
idle_in_transaction_session_timeout = 300000  -- 5 minutes
statement_timeout = 30000                      -- 30 seconds
```

#### Connection Pooling

Connection pooling is configured in `src/server/db/index.ts`:

```typescript
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,              // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

Adjust these values based on your expected load:
- **Small team (< 10 users)**: `max: 10`
- **Medium team (10-50 users)**: `max: 20`
- **Large team (50+ users)**: `max: 50` + consider read replicas

### Application Configuration

Edit `src/config/app.js` for application-wide settings:

```javascript
export const appConfig = {
  name: 'EagleEvents',
  version: '1.0.0',
  features: {
    enableZendeskIntegration: true,
    enableElasticsearch: process.env.ENABLE_ELASTICSEARCH === 'true',
    enableHourTracking: true,
  },
  limits: {
    maxEventsPerDay: 100,
    maxHoursPerLog: 24,
  },
};
```

---

## Testing

### Running Tests

```bash
pnpm test        # Run all tests
pnpm test:watch  # Watch mode (if configured)
```

### Test Structure

EagleEvents uses Node.js built-in test runner (no Jest/Vitest required):

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert";

describe("CalendarService", () => {
  before(async () => {
    // Setup: create test data
  });

  after(async () => {
    // Teardown: clean up
  });

  it("should create an event", async () => {
    const event = await createEvent({
      title: "Test Event",
      startTime: new Date(),
    });

    assert.strictEqual(event.title, "Test Event");
    assert.ok(event.id);
  });

  it("should handle date conflicts", async () => {
    await assert.rejects(
      async () => createOverlappingEvent(),
      { message: /conflict/i }
    );
  });
});
```

### Test Organization

```
src/
└── server/
    └── services/
        ├── calendar.ts          # Implementation
        └── __tests__/
            └── calendar.test.ts # Tests
```

### Test Coverage Areas

- ✅ **Services**: Business logic (permissions, calendar, theme)
- ✅ **Database**: Schema validation and queries
- ✅ **API**: tRPC router integration
- ⚠️ **UI**: Manual testing via browser (consider Playwright for E2E)

### Writing Tests

**Best Practices:**
1. Test business logic, not implementation details
2. Use descriptive test names
3. One assertion concept per test
4. Clean up test data after each test
5. Mock external services (Elasticsearch, Zendesk)

**Example Test:**

```typescript
describe("Permission Service", () => {
  it("should allow admin to access all departments", async () => {
    const admin = await createTestUser({ role: "admin" });
    const hasAccess = await canAccessDepartment(admin, department.id);
    assert.strictEqual(hasAccess, true);
  });

  it("should restrict employee to assigned events only", async () => {
    const employee = await createTestUser({ role: "employee" });
    const events = await getVisibleEvents(employee);
    assert.ok(events.every(e => e.assignedTo.includes(employee.id)));
  });
});
```

---

## Deployment

**EagleEvents is designed for local development and internal deployment.** It runs on your organization's infrastructure with direct access to your PostgreSQL database and internal network.

### Local Production Build

To run a production build locally for testing:

```bash
# Build the application
pnpm build

# Start production server
pnpm start
```

The production server runs at `http://localhost:3000` with optimizations enabled.

### Running in Production (Internal Server)

For production deployment on an internal server:

**Prerequisites:**
- Node.js 18+ installed
- PostgreSQL 14+ accessible
- Network access configured

**Setup Steps:**

1. **Prepare Environment**
   ```bash
   cd eaglevents
   pnpm install --frozen-lockfile
   ```

2. **Configure Production Environment**
   ```bash
   cp .env.example .env
   # Edit .env with production database and settings
   ```

   Required production values:
   ```bash
   DATABASE_URL="postgresql://user:pass@prod-db-server:5432/eaglevents"
   NEXTAUTH_SECRET="production-secret-32-chars-minimum"
   NEXTAUTH_URL="http://your-server-address:3000"
   NODE_ENV="production"
   ```

3. **Run Migrations**
   ```bash
   pnpm db:migrate
   ```

4. **Build Application**
   ```bash
   pnpm build
   ```

5. **Start Production Server**
   
   **Option A: Direct Start**
   ```bash
   pnpm start
   ```

   **Option B: Using PM2 (Recommended for auto-restart)**
   ```bash
   # Install PM2 globally
   npm install -g pm2

   # Start with PM2
   pm2 start npm --name eaglevents -- start

   # Save PM2 configuration
   pm2 save

   # Setup auto-start on system reboot
   pm2 startup
   ```

   **Option C: Windows Service (using start-prod.bat)**
   ```powershell
   .\start-prod.bat
   ```

### Production Management

**With PM2:**
```bash
pm2 status              # Check application status
pm2 logs eaglevents     # View application logs
pm2 restart eaglevents  # Restart application
pm2 stop eaglevents     # Stop application
pm2 delete eaglevents   # Remove from PM2
```

**Logs:**
Application logs are written to `logs/service.log`

```bash
# View logs
tail -f logs/service.log          # Linux/Mac
Get-Content logs\service.log -Tail 50 -Wait  # Windows PowerShell
```

### Post-Deployment Checklist

After deploying to production:

- [ ] Database migrations applied: `pnpm db:migrate`
- [ ] Environment variables configured correctly
- [ ] Test database connection
- [ ] Create admin user: `pnpm user:create`
- [ ] Complete setup wizard at `/setup`
- [ ] Test authentication login/logout
- [ ] Verify calendar loads and displays events
- [ ] Test event creation and assignment
- [ ] Check hour logging functionality
- [ ] Verify permissions work correctly (Admin/Manager/Employee)
- [ ] Set up database backup schedule
- [ ] Document server access and credentials (securely)
- [ ] Test from different client machines on network

### Updating Production

When deploying updates:

```bash
# 1. Pull latest changes
git pull origin main

# 2. Install any new dependencies
pnpm install

# 3. Run any new migrations
pnpm db:migrate

# 4. Rebuild application
pnpm build

# 5. Restart server
pm2 restart eaglevents
# OR if not using PM2, stop and restart manually
```

### Database Backups

Set up regular PostgreSQL backups:

**Manual Backup:**
```bash
# Windows PowerShell
pg_dump -U postgres eaglevents > "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"

# Linux/Mac
pg_dump eaglevents > "backup_$(date +%Y%m%d_%H%M%S).sql"
```

**Automated Backup (Windows Task Scheduler):**
Create a PowerShell script `backup-db.ps1`:
```powershell
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupPath = "C:\backups\eaglevents_$timestamp.sql"
pg_dump -U postgres eaglevents > $backupPath
```

Schedule this script to run daily via Task Scheduler.

### Monitoring & Maintenance

**Health Check:**
The application provides a health check endpoint:
```bash
curl http://localhost:3000/api/health
```

**Database Health:**
```bash
# Check database connection
pnpm db:studio

# Or connect directly
psql -U postgres eaglevents -c "SELECT version();"
```

**Disk Space:**
Monitor disk usage regularly:
```bash
# Check database size
psql -U postgres -c "SELECT pg_database_size('eaglevents');"

# Check logs directory
du -sh logs/  # Linux/Mac
```

### Troubleshooting Production Issues

**Server won't start:**
1. Check logs: `tail -f logs/service.log` or `pm2 logs`
2. Verify database is accessible
3. Confirm environment variables are set
4. Check port 3000 is available

**Cannot connect from other machines:**
1. Verify firewall allows port 3000
2. Check `NEXTAUTH_URL` uses correct server address (not localhost)
3. Ensure server is listening on `0.0.0.0` not `127.0.0.1`

**Performance issues:**
1. Check database connection pool settings
2. Monitor PostgreSQL performance
3. Review slow query logs
4. Consider database indexing improvements

---

## Troubleshooting

### Common Issues & Solutions

#### Module not found / Dependency errors

**Symptoms:** `Cannot find module 'xyz'` or `ERR_MODULE_NOT_FOUND`

**Solution:**
```bash
# Clean install
rm -rf .next node_modules pnpm-lock.yaml
pnpm install
pnpm dev
```

---

#### Database connection fails

**Symptoms:** `ECONNREFUSED` or `Connection timeout`

**Diagnosis:**
```bash
# Check if PostgreSQL is running
pg_isready

# Test connection directly
psql $DATABASE_URL

# Check PostgreSQL status
sudo systemctl status postgresql  # Linux
brew services list                # macOS
```

**Solutions:**
1. Ensure PostgreSQL is running
2. Verify `DATABASE_URL` format: `postgresql://user:pass@host:port/dbname`
3. Check firewall allows port 5432
4. Verify username/password are correct
5. Ensure database exists: `createdb eaglevents`

---

#### Setup wizard keeps redirecting / loops

**Symptoms:** Can't complete setup, redirects to `/setup` repeatedly

**Diagnosis:**
```bash
# Check database for completed setup
pnpm db:studio
# Look at 'business' table → 'setupCompletedAt' should be NULL
```

**Solutions:**
1. Clear browser cookies and try again
2. Check if setup was actually completed: query `business` table
3. If stuck, manually set `setupCompletedAt`:
   ```sql
   UPDATE business SET "setupCompletedAt" = NOW() WHERE id = 1;
   ```

---

#### TypeScript errors after update

**Symptoms:** Type errors after `git pull` or package update

**Solution:**
```bash
# Clean TypeScript cache
rm -rf node_modules pnpm-lock.yaml tsconfig.tsbuildinfo
pnpm install
pnpm typecheck
```

---

#### Build fails in production

**Symptoms:** `pnpm build` fails with errors

**Common Causes:**
1. **Environment variables missing**: Ensure `.env` is configured
2. **TypeScript errors**: Run `pnpm typecheck` locally first
3. **Linting errors**: Run `pnpm lint` and fix issues
4. **Memory limit**: Increase Node memory: `NODE_OPTIONS=--max-old-space-size=4096 pnpm build`

---

#### Calendar not loading / blank page

**Symptoms:** Calendar shows loading spinner indefinitely

**Solutions:**
1. Check browser console for errors (F12)
2. Verify tRPC endpoints are accessible: visit `/api/health`
3. Check database has calendar data
4. Ensure user has permission to view calendar
5. Try in incognito mode (cache issue)

---

#### "Session token expired" errors

**Symptoms:** Frequent logouts or authentication errors

**Solutions:**
1. Verify `NEXTAUTH_SECRET` is set and consistent
2. Check `NEXTAUTH_URL` matches your domain
3. Clear cookies and log in again
4. In production, ensure HTTPS is enabled

---

#### Slow performance

**Symptoms:** Pages load slowly, queries timeout

**Optimizations:**
1. **Database**: Add indexes to frequently queried columns
2. **Connection pool**: Increase pool size in `src/server/db/index.ts`
3. **PostgreSQL tuning**: Adjust `shared_buffers` and `work_mem`
4. **Caching**: Enable Elasticsearch for profile search
5. **Monitoring**: Use `pg_stat_statements` to identify slow queries

---

#### Can't create users

**Symptoms:** User creation fails with validation errors

**Solutions:**
1. Ensure setup wizard completed successfully
2. Check email format is valid
3. Verify password meets requirements (8+ chars)
4. Use CLI tool: `pnpm user:create`
5. Check database constraints in `schema.ts`

---

### Getting Help

If you're still stuck:

1. **Check logs**: Look in `logs/service.log` for errors
2. **Enable debug mode**: Set `DEBUG=*` environment variable
3. **Database inspection**: Run `pnpm db:studio` to examine data
4. **Restart everything**:
   ```bash
   pm2 restart all          # Production
   # OR
   Ctrl+C and pnpm dev      # Development
   ```

5. **File an issue**: [GitHub Issues](https://github.com/yourorg/eaglevents/issues)
   - Include error messages
   - Describe steps to reproduce
   - Share relevant logs (redact sensitive info)

---

## Contributing

We welcome contributions! Whether it's bug fixes, new features, or documentation improvements, your help makes EagleEvents better for everyone.

### Development Workflow

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/eaglevents.git
   cd eaglevents
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # OR
   git checkout -b fix/bug-description
   ```

3. **Make Changes**
   - Follow existing code patterns
   - Add tests for new functionality
   - Update documentation if needed
   - Keep commits focused and atomic

4. **Run Quality Checks**
   ```bash
   pnpm check        # Lint + TypeScript + format
   pnpm test         # Run test suite
   pnpm build        # Ensure builds successfully
   ```

5. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add user timezone support"
   ```

6. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then open a Pull Request on GitHub.

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear git history:

| Type | Description | Example |
| --- | --- | --- |
| `feat` | New feature | `feat: add recurring events` |
| `fix` | Bug fix | `fix: resolve calendar overflow` |
| `docs` | Documentation only | `docs: update setup instructions` |
| `style` | Code style (formatting) | `style: apply prettier to auth.ts` |
| `refactor` | Code restructure | `refactor: simplify permission logic` |
| `test` | Add/update tests | `test: add calendar service tests` |
| `chore` | Maintenance | `chore: update dependencies` |
| `perf` | Performance improvement | `perf: optimize event queries` |

**Format:**
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Examples:**
```bash
feat(calendar): add drag-and-drop event rescheduling
fix(auth): prevent session expiry during active use
docs(readme): improve deployment instructions
refactor(db): migrate to Drizzle ORM relations API
```

### Pull Request Guidelines

**Before Submitting:**
- [ ] Code follows project style (run `pnpm check`)
- [ ] Tests pass (run `pnpm test`)
- [ ] New features have tests
- [ ] Documentation updated (if applicable)
- [ ] No console warnings or errors
- [ ] Database migrations included (if schema changed)

**PR Description Should Include:**
1. **Summary**: What does this PR do?
2. **Motivation**: Why is this change needed?
3. **Changes**: List of key changes made
4. **Testing**: How was this tested?
5. **Screenshots**: For UI changes
6. **Breaking Changes**: If any (clearly marked)

**Example PR Description:**
```markdown
## Summary
Adds timezone support for events, allowing users to schedule events across different timezones.

## Motivation
Users in different timezones were seeing incorrect event times. This adds per-user timezone settings.

## Changes
- Added `timezone` field to user profile
- Updated event display to convert to user's timezone
- Added timezone selector in settings
- Migration: `0028_user_timezone.sql`

## Testing
- Tested with PST, EST, and UTC timezones
- Verified events display correctly across timezone switches
- All existing tests pass

## Screenshots
[Include screenshots of timezone selector and event display]
```

### Code Style Guidelines

**TypeScript:**
- Use strict mode (enabled by default)
- Prefer `type` over `interface` for simple types
- Use `import type` for type-only imports
- Avoid `any` - use `unknown` if type is truly unknown

**React:**
- Use functional components with hooks
- Prefer Server Components (default in App Router)
- Use Client Components only when needed (`"use client"`)
- Keep components under 200 lines - split if larger

**Naming:**
- PascalCase: Components, types, interfaces
- camelCase: Functions, variables, parameters
- UPPER_SNAKE_CASE: Constants
- kebab-case: File names for routes

**File Organization:**
- Colocate: Keep related files together
- `_components/`: Feature-specific components
- One component per file (generally)
- Index exports for barrel exports

### Database Changes

When modifying the database schema:

1. **Update Schema**
   ```typescript
   // src/server/db/schema.ts
   export const events = pgTable("events", {
     id: serial("id").primaryKey(),
     newField: varchar("new_field", { length: 255 }), // Add field
   });
   ```

2. **Generate Migration**
   ```bash
   pnpm db:generate
   ```

3. **Review Generated SQL**
   Check `drizzle/XXXX_migration_name.sql`

4. **Test Migration**
   ```bash
   pnpm db:migrate  # Apply to local database
   # Test that app still works
   ```

5. **Include in PR**
   Commit both `schema.ts` and the migration SQL file.

### Need Help?

- **Questions**: Open a [Discussion](https://github.com/yourorg/eaglevents/discussions)
- **Bugs**: File an [Issue](https://github.com/yourorg/eaglevents/issues)
- **Ideas**: Start a discussion or open an RFC issue

---

## Performance Optimization

### Database Optimization

EagleEvents includes optimized database indexes for common queries. If you experience slow performance:

**Check Existing Indexes:**
```sql
-- View all indexes
SELECT tablename, indexname, indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename, indexname;
```

**Critical Indexes (already included in migrations):**
```sql
-- Events by calendar and date range
CREATE INDEX idx_events_calendar_date ON events(calendar_id, start_time);

-- Events by building
CREATE INDEX idx_events_building ON events(building_id) WHERE building_id IS NOT NULL;

-- Event assignments
CREATE INDEX idx_event_assignees_user ON event_assignees(user_id);
CREATE INDEX idx_event_assignees_event ON event_assignees(event_id);

-- Hour logs
CREATE INDEX idx_hour_logs_event ON hour_logs(event_id);
CREATE INDEX idx_hour_logs_profile ON hour_logs(profile_id);
```

**Query Optimization Tips:**
- Use `db.query` API for complex joins (Drizzle relational queries provide better performance)
- Paginate large result sets instead of loading everything
- Use `select` to fetch only needed columns
- Filter early in queries to reduce data processing

**Monitor Slow Queries:**
```sql
-- Enable query logging in postgresql.conf
-- log_min_duration_statement = 1000  # Log queries over 1 second

-- View slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;
```

### Connection Pool Configuration

Connection pooling is configured in `src/server/db/index.ts`. Adjust based on your usage:

**Current Settings:**
```typescript
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,                      // Maximum connections
  idleTimeoutMillis: 30000,     // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Timeout for acquiring connection
});
```

**Recommended Pool Sizes:**
- **Small team (< 10 users)**: `max: 10`
- **Medium team (10-50 users)**: `max: 20` (default)
- **Large team (50+ users)**: `max: 50`

**Monitor Connections:**
```sql
-- Check active connections
SELECT count(*) as connections, 
       state, 
       query 
FROM pg_stat_activity 
WHERE datname = 'eaglevents' 
GROUP BY state, query;

-- Check for connection pool exhaustion
SELECT count(*) FROM pg_stat_activity WHERE datname = 'eaglevents';
```

### Application Performance

**React Query Caching:**
tRPC uses React Query under the hood. Adjust cache times in `src/trpc/react.tsx`:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,        // Data fresh for 1 minute
      cacheTime: 5 * 60 * 1000,    // Keep in cache for 5 minutes
    },
  },
});
```

**Server Component Caching:**
Next.js automatically caches Server Components. Force revalidation when needed:

```typescript
import { revalidatePath } from 'next/cache';

// After data changes
revalidatePath('/calendar');
```

**Image Optimization:**
Use Next.js Image component for automatic optimization:

```tsx
import Image from 'next/image';

<Image src="/logo.png" width={200} height={100} alt="Logo" />
```

### Resource Monitoring

**Windows Resource Monitor:**
```powershell
# Check Node.js memory usage
Get-Process node | Select-Object Name, CPU, WorkingSet

# Monitor PostgreSQL
Get-Process postgres | Select-Object Name, CPU, WorkingSet
```

**Linux/Mac:**
```bash
# Check Node.js memory
ps aux | grep node

# Monitor PostgreSQL
ps aux | grep postgres

# Overall system resources
htop  # or top
```

**Database Size:**
```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size('eaglevents'));

-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Security Best Practices

### Authentication
- ✅ JWT tokens with httpOnly cookies
- ✅ CSRF protection (built into NextAuth)
- ✅ Rate limiting on auth endpoints
- ⚠️ Consider 2FA for admin accounts

### Authorization
- ✅ Role-based access control (RBAC)
- ✅ Business-level data isolation
- ✅ Department/division scoping
- ✅ Input validation with Zod

### Data Protection
- ✅ SQL injection prevention (Drizzle ORM)
- ✅ XSS protection (React auto-escaping)
- ✅ Environment variables for secrets
- ⚠️ Implement audit logging for sensitive operations
- ⚠️ Regular database backups

### Production Checklist
- [ ] Use HTTPS in production (required for secure cookies)
- [ ] Set secure `NEXTAUTH_SECRET` (32+ random characters)
- [ ] Enable CORS only for trusted domains
- [ ] Implement rate limiting on API routes
- [ ] Regular security updates (`pnpm update`)
- [ ] Database backups automated
- [ ] Monitor for suspicious activity

---

## FAQ

<details>
<summary><strong>Can I use this for multiple organizations?</strong></summary>

Yes! EagleEvents is multi-tenant by design. Each organization has a separate `businessId`, and all data is automatically isolated. You can run multiple organizations on one installation.
</details>

<details>
<summary><strong>Do I need Elasticsearch?</strong></summary>

No, Elasticsearch is optional. It enhances profile search with fuzzy matching and faster lookups, but isn't required for core functionality. The app works perfectly without it for most use cases.
</details>

<details>
<summary><strong>Can I customize the UI theme per department?</strong></summary>

Yes! Each department can have custom color themes (primary, secondary, accent colors). Edit themes via:
- Admin dashboard (UI)
- Direct database edits in `palette_profiles` table
- Theme API endpoints

See `src/server/services/theme.ts` for implementation details.
</details>

<details>
<summary><strong>How do I backup the database?</strong></summary>

Use PostgreSQL's `pg_dump`:

**Windows:**
```powershell
pg_dump -U postgres eaglevents > "backup_$(Get-Date -Format 'yyyyMMdd').sql"
```

**Linux/Mac:**
```bash
pg_dump eaglevents > "backup_$(date +%Y%m%d).sql"
```

Set up automated backups using Windows Task Scheduler or cron jobs. Keep backups on a separate drive or network location.
</details>

<details>
<summary><strong>Can I integrate with other systems besides Zendesk?</strong></summary>

Yes! The architecture supports custom integrations:
1. Create service in `src/server/services/your-integration.ts`
2. Add configuration to `.env`
3. Expose via tRPC routers in `src/server/api/routers/`
4. Call from frontend using tRPC hooks

The codebase already includes patterns for API integration (Zendesk, Elasticsearch) that you can follow.
</details>

<details>
<summary><strong>How do I migrate data from another event system?</strong></summary>

1. Export data from old system (CSV, JSON, or database dump)
2. Create migration script in `scripts/migrate-from-old-system.ts`
3. Map old schema to EagleEvents schema (see `src/server/db/schema.ts`)
4. Import using seed script patterns or direct database inserts
5. Verify data integrity with test queries
6. Run through app to confirm everything displays correctly
</details>

<details>
<summary><strong>What's the maximum number of events supported?</strong></summary>

EagleEvents efficiently handles tens of thousands of events. Performance depends on:
- Database hardware (RAM, CPU, SSD recommended)
- Proper indexing (included by default in migrations)
- Connection pooling configuration
- Number of concurrent users

Successfully tested with 50,000+ events. Calendar views paginate and filter to maintain performance even with large datasets.
</details>

<details>
<summary><strong>Can I access EagleEvents from mobile devices?</strong></summary>

Yes! The web interface is responsive and works on tablets and phones. Simply access the server URL from your mobile browser. The calendar and event interfaces adapt to smaller screens.

Note: There is no native mobile app currently, but it's on the roadmap.
</details>

<details>
<summary><strong>How do I add new users?</strong></summary>

Three methods:

1. **CLI Tool** (recommended): `pnpm user:create`
2. **Admin Dashboard**: Navigate to Admin → Users → Create User
3. **Signup Page**: Enable if configured, users can self-register at `/signup`

All new users must complete their profile setup after first login.
</details>

<details>
<summary><strong>What happens if the database goes down?</strong></summary>

The application will show connection errors and become unavailable. To recover:

1. Restore database service
2. Application will automatically reconnect (connection pooling handles reconnection)
3. No code changes needed

Prevention:
- Set up database monitoring
- Configure automated PostgreSQL restarts
- Keep regular backups
- Consider PostgreSQL replication for high availability
</details>

---

## Roadmap

### Planned Features

**High Priority:**
- [ ] **Email Notifications** - Event reminders, assignments, and updates via SMTP
- [ ] **Calendar Sync** - Import/export to Google Calendar, Outlook, iCal
- [ ] **Enhanced Reporting Dashboard** - Advanced analytics with charts and visualizations
- [ ] **File Attachments** - Upload documents, images, and files to events
- [ ] **Equipment Tracking** - Manage AV equipment, furniture, and resource inventory
- [ ] **Recurring Events** - Advanced recurrence patterns (weekly, monthly, custom)

**Medium Priority:**
- [ ] **Approval Workflows** - Multi-step event approval process for managers
- [ ] **Audit Logs** - Track all changes to events and data for compliance
- [ ] **Advanced Search** - Full-text search across events, notes, and attendees
- [ ] **Print Views** - Printable schedules, reports, and timesheets
- [ ] **Calendar Conflicts** - Automated detection and resolution suggestions
- [ ] **Custom Fields** - User-defined fields per event type

**Long-term:**
- [ ] **Mobile-Responsive Improvements** - Enhanced mobile web experience
- [ ] **External Calendar Display** - Public-facing event calendars (read-only)
- [ ] **Integration APIs** - REST API for third-party integrations
- [ ] **Advanced Permissions** - Custom roles and fine-grained permissions
- [ ] **Multi-language Support** - Internationalization (i18n)

### Recently Completed

- [x] **Hour Logging System** - Track work hours per event per staff member
- [x] **Zendesk Integration** - Automated ticket creation and tracking
- [x] **Department Theming** - Custom color schemes per department
- [x] **Profile Search** - Optional Elasticsearch integration for fast search
- [x] **Building & Room Management** - Facility booking and location tracking
- [x] **Setup Wizard** - Guided onboarding for first-time setup
- [x] **Export System** - Excel export for hour logs and join tables

Want to contribute to any of these? Check the [Contributing](#contributing) section or open an issue to discuss implementation!

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2026 Your Organization

---

## Acknowledgments

Built with these amazing open-source projects:
- [Next.js](https://nextjs.org/) - React framework
- [tRPC](https://trpc.io/) - End-to-end type safety
- [Drizzle ORM](https://orm.drizzle.team/) - Type-safe database toolkit
- [NextAuth.js](https://next-auth.js.org/) - Authentication
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS
- [Radix UI](https://www.radix-ui.com/) - Accessible components
- [PostgreSQL](https://www.postgresql.org/) - Reliable database

---

## Support & Contact

- **Issues**: [GitHub Issues](https://github.com/yourorg/eaglevents/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourorg/eaglevents/discussions)
- **Documentation**: [Wiki](https://github.com/yourorg/eaglevents/wiki)
- **Email**: support@yourorg.com
- **Website**: https://eaglevents.yourorg.com

---

<div align="center">

**[⬆ Back to Top](#eaglevents)**

Made with ❤️ for facilities management teams everywhere

</div>