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
| `npm test` | Runs all backend tests (uses the database in your `.env`; puts changed passwords back) |
| `npm run test:unit` | Runs only the small tests that need no database |
| `npm run typecheck` | Checks the TypeScript code for type errors |
| `npm run build` / `npm start` | Production build and start (used on Render) |

## Folders

- `prisma/schema.prisma` — all database tables
- `prisma/seed.ts` — loads the sample lab
- `src/config` — settings from `.env`
- `src/db` — database client
- `src/routes` — API endpoints (`/api/v1/...`)
- `src/middleware` — error replies, login and role checks
- `src/lib` — small helpers (tokens, passwords, limits, email)
- `src/services` — sign-in session logic
- `tests` — backend tests

## Login and access

Sign in with phone number and password. The reply has a short **access token** (15 minutes) that the
website sends with every request as `Authorization: Bearer <token>`. A long **refresh token** (30 days)
is kept in an httpOnly cookie that page scripts cannot read; the database stores only its hash.

| Endpoint | Who | What it does |
| --- | --- | --- |
| `POST /api/v1/auth/login` | anyone | `{phone, password}` → access token + user, sets the cookie |
| `POST /api/v1/auth/refresh` | cookie | New access token; the cookie is swapped for a new one |
| `POST /api/v1/auth/logout` | cookie | Signs out this device |
| `POST /api/v1/auth/logout-all` | signed in | Signs out every device |
| `GET /api/v1/auth/me` | signed in | The signed-in user |
| `POST /api/v1/auth/change-password` | signed in | `{currentPassword, newPassword}`; other devices are signed out |
| `POST /api/v1/auth/forgot-password` | anyone | `{login}` (phone or email) → emails a reset link (30 minutes, one use) |
| `POST /api/v1/auth/reset-password` | link | `{token, newPassword}`; all devices are signed out |
| `GET /api/v1/users` | manager, supervisor | Manager: everyone. Supervisor: people in their zones. Operator: not allowed |

Rules:
- New passwords: at least 8 characters, with a letter and a number, not containing the phone number.
- 5 wrong passwords for one phone number (or 20 from one network address) block sign-in for 15 minutes.
- If an old refresh token is used again, every device of that user is signed out (the token may have been copied).
- Without `RESEND_API_KEY`, reset emails are not sent; the link is printed in the terminal running `npm run dev`.
  The sample accounts have no email: add one in `npm run db:studio` (table `app_user`) to try it.
