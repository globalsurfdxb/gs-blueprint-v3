# GS Blueprint

Internal project, task, and time management system for GS Digital — where the agency's projects, tasks, and time live.

Built with [Next.js](https://nextjs.org) (App Router), Prisma, and PostgreSQL.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Stack

- **Next.js** (App Router — Server Components + Server Actions)
- **Prisma** ORM on **PostgreSQL**
- **Space Grotesk** (headings) + **Lexend** (body) via `next/font`
- Tailwind CSS with the locked GS design tokens

## Database

Apply migrations:

```bash
npx prisma migrate deploy
```

Migrations live in `prisma/migrations/` and are hand-authored SQL — never edit migration history.
