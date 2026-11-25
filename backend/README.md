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

## Set-up and production

Everyone signed in can read the set-up lists; only the manager can change them.

| Endpoint | Who changes | What it is |
| --- | --- | --- |
| `GET/PUT /api/v1/setup/lab` | manager | Lab name, address, phone |
| `/api/v1/setup/areas`, `/benches`, `/crops`, `/stages`, `/recipes` | manager | List (`GET`), add (`POST`), edit (`PUT /:id`), remove (`DELETE /:id`) |
| `GET /api/v1/setup/alert-rules`, `PUT /alert-rules/:id` | manager | Warning and critical limits |
| `GET/PUT /api/v1/setup/settings` | manager | Forecast assumptions |
| `POST /api/v1/users`, `PUT /api/v1/users/:id` | manager | Add or edit a person (role, zones, left the lab, new password) |

Production. Manager sees everything; a supervisor sees trays on benches in their zones; an operator sees trays
in their own zones plus trays of batches they were given work on today.

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET /api/v1/batches` (`?includeClosed=1`) | all | Batches with live bottles per stage |
| `GET /api/v1/batches/:id` | all | Samples, trays, stage history, losses |
| `POST /api/v1/batches` | manager | Start a batch: samples and first bottles (made into trays of up to 30) |
| `POST /api/v1/batches/:id/split`, `/close` | manager | Move chosen trays into a new part; close a finished batch |
| `GET /api/v1/trays`, `GET /trays/qr/:code` | all | Active trays; find a tray by its QR code |
| `POST /api/v1/trays/:id/subculture` | all | New trays at the next stage, with any loss; an operator's sub-culture becomes a work entry |
| `POST /api/v1/trays/move` | manager, supervisor | Move trays to another bench (own zones only) |
| `GET/POST /api/v1/losses` | all | Losses (contamination) in your zones; record a loss |
| `GET /api/v1/trays/bench-load`, `/trays/handled-by-stage` | all | Trays per bench; bottles handled per stage |

If two people change the same tray at the same moment, the second one gets a message to open the tray again
instead of silently overwriting the first change.

## Daily work

Same rules as the website (`frontend/src/lib/dailyApi.ts`). Changes run one at a time, so two supervisors giving out
the same bottles at the same moment cannot both succeed.

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET/POST /api/v1/daily/attendance` | manager, supervisor | Attendance sheet for a day; mark P / HD / A (today or up to 7 days back) |
| `GET /api/v1/daily/my-attendance?month=`, `/today-attendance` | everyone | Own attendance |
| `GET /api/v1/daily/assign-options?date=` | everyone | Operators, batches with free bottles, benches (who is at each hood), wash count, media |
| `GET /api/v1/daily/assignments?date=` | everyone | Work given that day (operators: their own) |
| `POST`, `PUT /:id`, `DELETE /:id` `/api/v1/daily/assignments` | manager, supervisor | Give, change or remove work (targets, hood limit of 2, typed batch and stage, new batch with crop) |
| `POST /api/v1/daily/assignments/copy-previous` | manager, supervisor | Copy the last working day's work |
| `GET /api/v1/daily/board?date=&areaId=` | manager, supervisor | Target against work done per operator |
| `GET /api/v1/daily/entry-options?date=&operatorId=` | everyone | What the Record work form needs |
| `POST /api/v1/daily/entries` | everyone | Record work by hand (operator: own, today; supervisor: for an operator, up to 7 days back, counts as checked) |
| `GET /api/v1/daily/entries?status=&from=&to=` | everyone | Entries (operators: their own) |
| `POST /api/v1/daily/entries/verify`, `/entries/:id/reject` | manager, supervisor | Accept entries, or send one back with a reason (undone if nothing has used it yet) |
| `GET /api/v1/daily/output?from=&to=&operatorId=&areaId=&kind=&batchId=&stageId=` | everyone | Day totals and totals by operator, zone, work, batch and stage |
| `GET /api/v1/daily/my-output?days=`, `/my-sent-back` | operator | Own day totals; entries sent back in the last 3 days |
| `GET /api/v1/daily/wash` | everyone | Bottles waiting to be washed (plain and contaminated), and added today |

For now each daily-work request reads the lab's working tables whole. That is quick at the size of one lab;
when months of records have built up, the reads will be limited to the dates asked for (Phase 7).

## Results: stock, media, costs, orders, forecast, alerts, reports, zones

Same rules as the website (`opsApi.ts`, `resultsApi.ts`, `forecast.ts`, `alertEngine.ts`, `zonesApi.ts`).

| Endpoint | Who | What it does |
| --- | --- | --- |
| `GET/POST /api/v1/stock/items`, `PUT /stock/items/:id` | manager, supervisor | Stock items (opening stock is recorded) |
| `POST /api/v1/stock/moves` | manager, supervisor | `IN` received, `OUT` used, `ADJ` counted stock (needs a reason) |
| `GET /api/v1/stock/txns?days=` | manager, supervisor | Stock history |
| `GET/POST /api/v1/media/lots`, `GET /media/usable?phase=` | all / manager, supervisor | Media lots (code like B0001/26; chemicals taken out of stock) |
| `GET/PUT /api/v1/costs/month?month=`, `GET /costs/history`, `/costs/batches` | manager | Monthly costs, cost per bottle-round, cost per batch |
| `GET/POST /api/v1/orders`, `POST /orders/check` | manager | Orders; "can we deliver by this date?" from the forecast |
| `POST /api/v1/orders/:id/recheck`, `/cancel`, `/deliveries`; `GET /orders/hardened-stock?cropId=` | manager | Check again, cancel, record plants sent (taken from hardening trays) |
| `GET /api/v1/forecast` | manager | Expected plants, ready dates, cost and profit per batch |
| `GET /api/v1/alerts`, `POST /alerts/acknowledge` | all / manager, supervisor | Alerts in your zones; the checks run when alerts are read (at most once a minute) |
| `GET /api/v1/dashboard` | manager | Manager's home page figures |
| `GET /api/v1/room?hours=` | manager, supervisor | Growth room readings, limits and alerts |
| `GET /api/v1/reports/month?month=`, `/reports/day?date=` | manager, supervisor | Monthly and daily reports (money only for the manager) |
| `GET /api/v1/audit?days=` | manager | Audit log |
| `GET /api/v1/zones`, `/zones/:id` | manager, supervisor | All zones, and one zone's page |
| `GET /api/v1/iot/devices`, `POST /iot/devices/:id/key` | manager | Sensor nodes; make a device key (shown once) |
| `POST /api/v1/iot/readings` | sensor node (`X-Device-Key` header) | `{tempC, humidityPct, lightLux?, recordedAt?}`; room limits are checked at once |

Room readings: until a sensor node has sent any readings, the room pages use the same simulated readings as the
website, and every response says `simulated: true`. Once the ESP32 node sends its first reading, real readings are used.

## Running the website with this server (on your computer)

1. Start the server: `npm run dev` in `backend/`.
2. In `frontend/`, make a file `.env.local` with one line: `VITE_USE_SERVER=1`
3. Start the website: `npm run dev` in `frontend/`, and open http://localhost:5173.

The website then signs in, reads and saves through this server. Its calls go to `/api/v1/…` on the website's own
address and Vite passes them on to `http://localhost:4000`, so the sign-in cookie works without extra settings.
Without `.env.local` (and on Vercel until the server is online) the website keeps using its built-in sample data.
