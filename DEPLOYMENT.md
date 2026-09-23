# Deployment (Vercel)

GS Blueprint is a Next.js 16 (App Router) app using Prisma 7 + PostgreSQL.

## Environment variables (set in Vercel → Project → Settings → Environment Variables)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (e.g. a Neon/Supabase/RDS Postgres). Used by Prisma. |
| `NEXTAUTH_SECRET` | Secret used to sign/verify the `gsd_session` JWT. Generate a strong random value. |
| `NEXTAUTH_URL` | The deployed base URL (e.g. `https://your-app.vercel.app`). |
| `CRON_SECRET` | Bearer token protecting the cron job routes. Vercel automatically sends `Authorization: Bearer $CRON_SECRET` to scheduled cron requests when this is set. |
| `BLOB_READ_WRITE_TOKEN` | Auto-provisioned when you connect a **Vercel Blob** store (Storage tab). Required for bug-image uploads (`@vercel/blob`). |

## Build

The Prisma client is generated into `src/generated/prisma`, which is **gitignored**.
`package.json` has a `postinstall: prisma generate` hook, so Vercel regenerates it
after `npm install` — no manual step needed. Build command stays the default `next build`.

## Database migrations

Migrations live in `prisma/migrations` (hand-authored, additive). Run against the
production database **once per deploy that adds a migration**:

```bash
DATABASE_URL="<prod-url>" npx prisma migrate deploy
```

Run this before/at release time (e.g. as a Vercel deploy hook or manually). Do **not**
use `prisma migrate dev` against production.

## Scheduled jobs (Vercel Cron)

`vercel.json` schedules two daily notification sweeps (PRD 8.7):

- `/api/jobs/overdue-sweep` — 03:00 UTC (07:00 Dubai)
- `/api/jobs/due-tomorrow-sweep` — 14:00 UTC (18:00 Dubai)

Adjust the cadence in `vercel.json` as needed. Both require `CRON_SECRET` to be set.

## First-run data

The app expects seeded org structure (clusters, pods, roles, users). Point it at the
existing database, or seed a fresh one before first use.
