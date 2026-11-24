# TissueFlow backend

Node.js + Express + TypeScript API with a PostgreSQL database (Neon), accessed through Prisma.

## First-time setup

1. Install the libraries:
   ```
   cd backend
   npm install
   ```
2. Copy `.env.example` to `.env` and paste your two Neon connection strings into it
   (`DATABASE_URL` with pooling, `DIRECT_URL` without). `.env` is never committed.
3. Create the tables in the database:
   ```
   npm run db:migrate -- --name init
   ```
4. Load the sample lab (the same sample data the website uses; every account's password is 1234):
   ```
   npm run db:seed
   ```
5. Start the server:
   ```
   npm run dev
   ```
   Open http://localhost:4000/api/v1/health — it should say `"status": "ok"` with the record counts.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API and restarts it when code changes |
| `npm run db:migrate` | Applies changes in `prisma/schema.prisma` to the database |
| `npm run db:seed` | Empties the tables and loads the sample lab again |
| `npm run db:studio` | Opens Prisma Studio to look at the tables in the browser |
| `npm run build` / `npm start` | Production build and start (used on Render) |

## Folders

- `prisma/schema.prisma` — all database tables
- `prisma/seed.ts` — loads the sample lab
- `src/config` — settings from `.env`
- `src/db` — database client
- `src/routes` — API endpoints (`/api/v1/...`)
- `src/middleware` — error replies (and later login checks)
