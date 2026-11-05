# IoT Enabled Automated Tissue Management System (TissueFlow)

Final-year B.Tech CSE project, IGDTUW. Team: Kanika Chouhan, Khushi Chaudhary, Mahima Yadav, Jasman Kaur. Guide: Prof. SRN Reddy.

A web system for plant tissue culture labs: batch and tray tracking with QR labels, daily work and attendance,
contamination analysis, stock and media, orders with a "can we deliver?" check, forecast of plants, cost and profit,
and room monitoring from an IoT sensor node (ESP32 + DHT22).

| Folder | What it is |
|---|---|
| `frontend/` | React + TypeScript + Tailwind (Vite). Runs on sample data until the backend is ready. See `frontend/README.md`. |
| `backend/` | Node/Express + PostgreSQL (coming next). |

## Run the frontend
```
cd frontend
npm install
npm run dev     # http://localhost:5173
```

## Deploy (Vercel)
Import this repository in Vercel and set **Root Directory** to `frontend`. Vercel finds Vite by itself
(build command `npm run build`, output folder `dist`). `frontend/vercel.json` makes page links like `/m/batches` work on refresh.
