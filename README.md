# Job Application Tracker

An AI-powered job application tracker built as a monorepo.

- **Frontend:** Next.js (App Router) + Tailwind CSS → Vercel
- **Backend:** Node.js + Express (REST API) → Railway
- **Database:** PostgreSQL (local for now, AWS RDS later)
- **ORM:** Prisma
- **Auth:** Firebase Auth (email/password + Google OAuth) — _not wired up yet_
- **Language:** TypeScript throughout

> **Status: Phase 1** — Local PostgreSQL + Prisma schema + a basic Express server.
> No Firebase, no AWS, and no frontend UI yet.

## Repository Structure

```
.
├── client/        # Next.js frontend (placeholder for now)
├── server/        # Express backend + Prisma
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (tested with 22)
- [PostgreSQL](https://www.postgresql.org/) 14+ running locally
- npm

## 1. Database setup (local PostgreSQL)

Create a database for the project:

```bash
# Using psql
createdb job_tracker
```

or from inside `psql`:

```sql
CREATE DATABASE job_tracker;
```

## 2. Server setup (`/server`)

```bash
cd server
cp .env.example .env          # then edit DATABASE_URL to match your local Postgres
npm install
npm run prisma:generate       # generate the Prisma client
npm run prisma:migrate        # create tables (dev migration)
npm run seed                  # load seed data
npm run dev                   # start the server on http://localhost:5000
```

Verify the health check:

```bash
curl http://localhost:5000/health
# { "status": "ok" }
```

### Useful server scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Express server in watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run seed` | Seed the database |

## 3. Client setup (`/client`)

> Phase 1 only contains a placeholder app — no UI has been built yet.

```bash
cd client
cp .env.example .env.local    # set NEXT_PUBLIC_API_URL=http://localhost:5000
npm install
npm run dev                   # http://localhost:3000
```

## Environment variables

Each package has its own `.env.example`. Copy it to `.env` (server) or `.env.local` (client)
and fill in the values:

- `server/.env.example`
- `client/.env.example`

## Roadmap

- **Phase 1 (current):** Local Postgres + Prisma schema + basic Express server ✅
- **Phase 2:** Firebase Auth integration
- **Phase 3:** Frontend UI (Next.js + Tailwind)
- **Phase 4:** AI resume tailoring + insights, AWS S3 + RDS
