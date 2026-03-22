# ParkKean

Campus parking assistant built with Node.js, Express, SQLite, and vanilla HTML/CSS/JS.

The app serves a dashboard of campus parking lots, allows students to submit status reports, and keeps a simple leaderboard of community contributions.

## Getting Started

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the development server with hot reload:
   ```sh
   npm run dev
   ```
   or start the production server without nodemon:
   ```sh
   npm start
   ```
3. Open `http://localhost:3000` in your browser.

The first run seeds `data/parkkean.db` with example lots and users. New reports and leaderboard points are persisted in the SQLite database.

## Availability Estimates

ParkKean now keeps availability estimates completely in-house—no external API is required or queried.

- A new `lot_history` table stores historical occupancy patterns for every lot, broken down by day of week and hour of day. The database is seeded with realistic defaults and can be tuned directly in SQLite if campus trends change.
- Every call to `/api/lots` or `/api/lots/refresh` blends the historical percentage with the most recent community reports. Fresh reports heavily influence the estimate; older reports gradually taper off and the system falls back to historical trends.
- The resulting `lots` payload includes an `estimate` object (with blended percentages and report weighting) and a `source` block that explains when the snapshot was generated.
- When users submit a report, their status immediately updates the underlying lot record, earns leaderboard points, and feeds the estimation engine.

## Coordinates & Walking Estimates

- Each entry in `lots` now stores `latitude`/`longitude`. The default seed uses campus-friendly coordinates, and `ensureLotCoordinateColumns()` backfills any older databases.
- A new `buildings` table captures the major academic buildings (Harwood Arena, GLAB, Liberty Hall, etc.) along with their coordinates.
- `building_lot_walks` stores precomputed walking times from every building to every parking lot. These values are seeded from the local coordinates so you don’t need an external routing API.
- `GET /api/lots` and `POST /api/lots/refresh` accept an optional `username` query string. When provided, the server grabs the user’s saved GPS point, snaps it to the nearest building, and looks up the curated walk time from that building to each lot. Those minutes surface in the response as `walk_minutes_from_user`.
- The UI prefers those personalized estimates wherever it previously showed a static “walk time” so students immediately see how far each lot is from their approximate position. Without a user location, it falls back to the configured average walk minutes.
- Because the coordinates are now part of every response, you can drop them into any mapping library (Leaflet, Mapbox GL, Google Maps, etc.) to render lot markers without additional API work.

## Front-End Indicators

The header badge now reads "Estimated availability" and includes a tooltip showing whether the current snapshot includes recent reports. Lot cards and the admin dashboard also label their occupancy as estimates so users know the numbers are trend-based.

## Location Sharing

Users can optionally press the “Share location” button in the dashboard header. When granted, the browser’s geolocation API captures latitude/longitude + accuracy, which is securely persisted in SQLite (`users.last_latitude`, `users.last_longitude`, etc.). The UI shows when the last update occurred and whether any accuracy data was provided, so admins can quickly confirm if a report came from on-campus or elsewhere. No third-party map SDKs or tracking libraries are involved—everything stays local to ParkKean.

## API Overview

- `GET /api/lots` – list lots with estimated occupancy derived from historical data + reports. Accepts `?username=...` to include walking estimates based on a user’s saved location.
- `POST /api/lots/refresh` – force a fresh estimate cycle without touching any external services (also supports `?username=...`).
- `POST /api/reports` – submit a user report and award points.
- `GET /api/leaderboard` – top reporters.
- `POST /api/users` / `GET /api/users/:username` – lightweight user registration and lookup.
- `POST /api/users/:username/location` – store a user’s latest device location (lat/lng/accuracy).

## Development Notes

- The estimation engine runs entirely on the server with SQLite—no third-party parking APIs are required.
- All tables are created automatically on boot. To reset, delete `data/parkkean.db` and restart the server.
- The UI and REST endpoints operate offline by default; only your own client requests hit the Node server.

## Netlify + Supabase Deployment

This repo now includes a Netlify function API runtime at `netlify/functions/api.js` that uses Supabase Postgres.

1. In Supabase, open SQL Editor and run:
   - `supabase/migrations/202603070001_init.sql`
   - (optional) `supabase/seed.sql`
2. In Netlify, import this repo and keep:
   - Publish directory: `public`
   - Functions directory: `netlify/functions` (already set in `netlify.toml`)
3. In Netlify Site Settings -> Environment Variables, add:
   - `SUPABASE_DB_URL` (direct Postgres connection string from Supabase)
   - `PK_FORCE_BOOTSTRAP=true` (optional, one-time if you want to force a full re-bootstrap)
4. Deploy. Netlify routes `/api/*` to `/.netlify/functions/api/:splat` and serves the frontend from `public/`.

Notes:
- Local dev via `npm start` still runs the original SQLite server in `server.js`.
- Netlify uses the Supabase-backed function runtime, preserving the same API paths used by `public/app.js`.

## Vercel Deployment (No Supabase)

The Vercel API runtime at `api/[...path].js` now uses SQLite and does not require any external database account.

1. In Vercel, import this repo.
2. Deploy. `vercel.json` keeps API/static files and rewrites unmatched SPA routes to `index.html`.
3. Optional environment variables:
   - `PK_DB_DIR` (defaults to `/tmp` on Vercel)
   - `PK_FORCE_BOOTSTRAP=true` (optional, one-time if you want to force a full re-bootstrap)

Notes:
- The frontend still serves from `public/`.
- `api/[...path].js` is the runtime used by Vercel for `/api/*`.
- Guest mode works by default, so users can interact with the app without creating an account.
