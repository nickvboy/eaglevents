# Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.

## Database seeding

The `scripts/seed.ts` helper populates the workspace exclusively through the published tRPC APIs so validations and cascades stay consistent. The full workflow backfills hundreds of events for every month in the last seven years so charts, reports, and timelines behave like a long-lived org.

| Command | Description |
| --- | --- |
| `pnpm seed` | Run the full workflow (workspace + event data) against `DATABASE_URL`. |
| `pnpm seed:workspace` | Only run the setup flow (business, buildings, departments, admins). |
| `pnpm seed:events` | Only add ticket/event data; expects the workspace to exist. |
| `pnpm seed:full` | Explicit equivalent of `pnpm seed` (generates historical data across the last 7 years). |
| `pnpm seed:revert` | Delete seeded workspace data and return to the onboarding state. |

All variants accept the CLI options below via `--` arguments, e.g. `pnpm seed -- --target prod --events 25 --seed 42`.

- `--target dev|prod` &mdash; switch between `DATABASE_URL` (default) and `DATABASE_URL_PROD`.
- `--mode workspace|events|full` &mdash; automatically set by the convenience scripts above.
- `--events <count>` &mdash; number of fake events to create when the mode includes events (default ~420 for `full` to cover every month of the last 7 years, 15 otherwise).
- `--seed <number>` &mdash; pass a deterministic Faker seed when you want reproducible output.
- `--mode revert` &mdash; wipe seeded workspace data (same as running `pnpm seed:revert`).

Each run inspects the current setup status: missing steps are created (business, buildings, departments, admin/manager/employee roles), and `setup.completeSetup` is executed once prerequisites are satisfied. Event seeding impersonates the generated users through the same routers: calendars are resolved via `ensurePrimaryCalendars`, tickets are created with `event.create`, and Zendesk confirmations are issued through `event.confirmZendesk`.
