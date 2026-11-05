# IoT Enabled Automated Tissue Management System – frontend

React 18 + TypeScript + Tailwind CSS, built with Vite. The app runs on **sample data** kept in the browser
(`src/lib/mockData.ts`) until the backend (Node/Express + PostgreSQL) is ready.

## Run it (Mac)
```
cd ~/Documents/TissueFlow/frontend/frontend
npm install        # first time only, or when package.json changes
npm run dev        # then open http://localhost:5173
```
Stop with Control + C. Do not use VS Code's "Go Live" button; it cannot run this app.

Other commands:
- `npm run typecheck` – checks the TypeScript for mistakes
- `npm run build` – makes the final website in `dist/` (for hosting, e.g. Vercel)

## Demo accounts (password 1234)
| Role | Phone | Sees |
|---|---|---|
| Manager | 9000000001 | whole lab |
| Supervisor A | 9000000002 | Washing, Media preparation |
| Supervisor B | 9000000003 | Inoculation, Incubation |
| Operator (Asha) | 9000000004 | own work (phone screens) |

Changes you make are kept in the browser. **Lab, zones, benches → Reset sample data** goes back to the start.

## What is where
| Folder | What it holds |
|---|---|
| `src/lib/types.ts` | Shape of every record (matches the database tables in the design) |
| `src/lib/mockData.ts` | Sample data |
| `src/lib/api.ts` | The one door every page uses for data, plus the audit log |
| `src/lib/productionApi.ts`, `dailyApi.ts`, `opsApi.ts`, `resultsApi.ts` | Fake API, by area of the app |
| `src/lib/forecast.ts` | Growth, forecast, cost per bottle-round, batch cost, “can we deliver?” |
| `src/lib/alertEngine.ts` | Alert checks against Set-up → Alert limits |
| `src/lib/iot.ts` | Sensor readings (simulated until the ESP32 node is connected) |
| `src/config/nav.ts` | Sidebar menu for each role |
| `src/components/ui` | Buttons, cards, inputs, tables, badges, pop-ups |
| `src/components/charts` | Line and bar charts |
| `src/pages/...` | One file per screen |

## Screens by role
- **Manager:** dashboard · batches · trays and QR labels · contamination · daily work · stock and media · orders ·
  monthly costs · forecast and profit · room monitoring · alerts · reports (daily and monthly; print/PDF, Excel) ·
  lab set-up · crops, stages, media, alert limits · users · audit log
- **Supervisor:** zone dashboard · attendance · give work · check entries · batches · trays · losses · media and stock ·
  room monitoring · alerts · reports (own zones only)
- **Operator (phone):** today’s work · scan tray (camera) · report loss · my output · my attendance · alerts

## Connecting the backend later
Pages never touch the sample data directly; they only call `api.something(...)`. When the backend is ready,
each function in the `src/lib/*Api.ts` files is replaced by a `fetch('/api/...')` call that returns the same shape.
The forecast, alert checks and audit log move to the server, and the ESP32 node posts readings to `/api/iot/readings`
instead of `src/lib/iot.ts` simulating them. No page needs to change.

## Notes for the report
- Sensor readings, customers, costs and order rates in the sample data are made-up demo values.
- Forecast survival rates (rooting 90 %, hardening 85 %) are example values; set real ones in Orders → Forecast assumptions.
