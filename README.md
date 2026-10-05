# HOS Trip Planner

A full-stack **Hours of Service (HOS)** trip planning application for commercial drivers. Enter current location, pickup, dropoff, and cycle hours used; the backend computes routes via **OpenRouteService**, simulates driving against **US-style HOS limits**, and returns **stops** and **daily log** segments. The **React** frontend shows an interactive map and ELD-style log sheets.

| Environment | URL |
|-------------|-----|
| **Live app** | [spotter-hos-app.vercel.app](https://spotter-hos-app.vercel.app) |
| **API (production)** | [spotter-hos-app-e2aab.containers.snapdeploy.app](https://spotter-hos-app-e2aab.containers.snapdeploy.app) |
| **Source** | [github.com/SyedHaider037/spotter-hos-app](https://github.com/SyedHaider037/spotter-hos-app) |

> The production API runs on a free tier that sleeps after about 15 minutes idle. The first request after a quiet period can take 30–60 seconds while it wakes up; the app shows a notice while it waits.

---

## Features

- **Trip planning form**: current location, pickup, dropoff, and cycle hours used
- **Route-aware simulation**: distances from OpenRouteService (geocode → directions)
- **Stops timeline**: breaks, rest, fuel, pickup/dropoff markers with times and durations
- **Daily logs**: duty-status segments grouped by date for ELD-style visualization
- **Interactive map** (React + Leaflet): stop markers with popups and route visualization
- **ELD log grids** (HTML Canvas): one sheet per day, 24-hour grid, four duty rows
- **JSON API**: single planning endpoint for integrations and the SPA

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **Backend** | Python 3, **Django 6**, **Django REST Framework**, Gunicorn, Docker |
| **Frontend** | **React** 19, Create React App, **react-leaflet** / Leaflet |
| **Routing / maps** | [OpenRouteService](https://openrouteservice.org/) (geocoding + directions) |
| **Config** | Environment variables (`python-dotenv` loads `backend/.env` locally) |
| **CORS** | `django-cors-headers` with an explicit, environment-driven origin allowlist |

---

## Repository layout

```
spotter-hos-app/
├── backend/          # Django project + trip app + HOS / routing services (Dockerfile included)
├── frontend/         # React SPA
├── docs/             # PRD, architecture notes, task breakdown
├── LICENSE           # MIT
└── README.md         # This file
```

---

## Run locally

### Prerequisites

- Python **3.12+** (Django 6 requires it)
- Node.js **18+** and npm
- An **OpenRouteService** API key ([openrouteservice.org](https://openrouteservice.org/))

### 1. Backend

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` with real values. The app **refuses to start without `DJANGO_SECRET_KEY`**. Generate one with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

For local development also set `DJANGO_DEBUG=True` (it defaults to `False`). See [Environment variables](#environment-variables) for the full list.

```bash
python manage.py migrate   # optional: the app has no models; this just silences the unapplied-migrations warning
python manage.py runserver
```

API base (local): **http://localhost:8000**

Run the tests (they mock the routing service, so no API key or network is needed):

```bash
python manage.py test trip
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # points the app at http://localhost:8000
npm start
```

The dev server defaults to **http://localhost:3000**, which is also the default CORS origin the backend allows. Without `.env.local`, the frontend calls the deployed production API.

---

## Environment variables

### Backend (`backend/.env` locally, platform settings in production)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ORS_API_KEY` | Yes | _(empty)_ | OpenRouteService key. Without it every plan request returns a 400 error. |
| `DJANGO_SECRET_KEY` | Yes | _(none)_ | Django secret key. Startup fails if it is missing. |
| `DJANGO_DEBUG` | No | `False` | Set to `True` only for local development. |
| `DJANGO_ALLOWED_HOSTS` | No | `localhost,127.0.0.1` | Comma-separated hostnames. In production, include the deployed API hostname. |
| `CORS_ALLOWED_ORIGINS` | No | `http://localhost:3000` | Comma-separated frontend origins, with scheme and no trailing slash (e.g. `https://spotter-hos-app.vercel.app`). |
| `DATABASE_URL` | Platform only | – | Set by the hosting platform when a PostgreSQL database is attached, because its deployment scanner requires one. **The app does not read it**: it has no models and stores no data. |

### Frontend

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `REACT_APP_API_URL` | No | The production SnapDeploy API | Backend base URL, no trailing slash. Baked in at build time. |

---

## API documentation

### `POST /api/plan/`

Plans a trip from **current location → pickup → dropoff** using ORS for leg distances and the internal HOS simulator.

**URL (local)**  
`http://localhost:8000/api/plan/`

**URL (production)**  
`https://spotter-hos-app-e2aab.containers.snapdeploy.app/api/plan/`

**Headers**

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `current_location` | string | Yes | Driver’s current location (free text; geocoded by ORS) |
| `pickup_location` | string | Yes | Pickup address or place name |
| `dropoff_location` | string | Yes | Dropoff address or place name |
| `cycle_used_hours` | number | Yes | Hours already used toward the **70-hour** cycle |

**Example**

```bash
curl -s -X POST https://spotter-hos-app-e2aab.containers.snapdeploy.app/api/plan/ \
  -H "Content-Type: application/json" \
  -d '{
    "current_location": "Chicago, IL",
    "pickup_location": "Dallas, TX",
    "dropoff_location": "New York, NY",
    "cycle_used_hours": 20
  }'
```

**Success — `200 OK`** (trimmed; a real response has one entry per stop and per day)

```json
{
  "stops": [
    {
      "type": "CURRENT",
      "location": "Chicago, IL",
      "lat": 41.88,
      "lng": -87.63,
      "start_time": "2026-01-01T12:00:00Z",
      "end_time": "2026-01-01T12:00:00Z",
      "duration": 0
    }
  ],
  "daily_logs": [
    {
      "date": "2026-01-01",
      "segments": [
        {
          "status": "DRIVING",
          "start": "2026-01-01T12:00:00Z",
          "end": "2026-01-01T14:00:00Z"
        }
      ]
    }
  ],
  "route": {
    "encoding": "polyline5",
    "legs": [
      { "polyline": "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
      { "polyline": "..." }
    ]
  }
}
```

`route.legs` has one entry per leg (current → pickup, then pickup → dropoff). Each `polyline` is the road geometry from OpenRouteService as a [Google encoded polyline](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) (1e-5 degree precision), which the frontend decodes and draws on the map.

Stop `type` values include (among others): `CURRENT`, `PICKUP`, `DROPOFF`, `BREAK_30`, `REST_10`, `FUEL`, `ON_DUTY`. Segment `status` values: `OFF_DUTY`, `SLEEPER`, `ON_DUTY`, `DRIVING`.

**Client / validation errors — `400 Bad Request`**

```json
{
  "error": {
    "code": "PLAN_FAILED",
    "message": "Human-readable reason (e.g. invalid field, ORS error, cycle limit exceeded)."
  }
}
```

A trip is rejected, rather than adjusted, when it would exceed the 70-hour cycle. For example, Chicago → Dallas → New York needs about 42 on-duty hours, so a `cycle_used_hours` above roughly 27 returns this error.

**Server errors — `500 Internal Server Error`**

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Unexpected server error."
  }
}
```

---

## HOS rules implemented

The planner applies these constraints (see `backend/trip/services/hos_rules.py` and `trip_planner.py`):

| Rule | Value |
|------|--------|
| Maximum driving per day | **11 hours** |
| On-duty / driving shift window | **14 hours** |
| Minimum rest between shifts | **10 hours** |
| Break after cumulative driving | **30 minutes** after **8 hours** driving |
| Cycle limit | **70 hours** (a flat budget; see Known limitations) |
| Fuel stop interval | Every **1,000 miles** |
| Pickup / dropoff | **1 hour** on duty each |

> **Note:** Regulatory HOS has additional nuances (recap vs reset, personal conveyance, adverse driving, etc.). This project implements the rules listed in the product spec for planning and visualization.

---

## Known limitations

- **Flat 70-hour budget.** The cycle limit is a single running total, not a rolling 8-day window, and there is no 34-hour restart. A trip that would exceed the budget is rejected instead of being planned around a restart.
- **Timing.** Trips start at the moment of the request, and daily logs split at UTC midnight rather than the driver's local day.
- **Cold starts.** On the free hosting tier the first request after idle can take up to a minute.

---

## Deployment

| Component | Platform | URL |
|-----------|----------|-----|
| **Frontend** | Vercel | [spotter-hos-app.vercel.app](https://spotter-hos-app.vercel.app) |
| **Backend** | SnapDeploy (Docker) | [spotter-hos-app-e2aab.containers.snapdeploy.app](https://spotter-hos-app-e2aab.containers.snapdeploy.app) |

**Backend (SnapDeploy)**

- Built from [`backend/Dockerfile`](backend/Dockerfile) (`python:3.13-slim`, Gunicorn). The container listens on the platform-assigned `$PORT`.
- Set the [environment variables](#environment-variables) above: at minimum `ORS_API_KEY`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` (the SnapDeploy hostname) and `CORS_ALLOWED_ORIGINS` (the Vercel origin).
- `DATABASE_URL` is supplied by the platform's attached PostgreSQL database. The scanner requires one, but the app never connects to it.

**Frontend (Vercel)**

- Build command: `npm run build` (from `frontend/`)
- Output directory: `frontend/build` (or root as configured in the Vercel project)
- `REACT_APP_API_URL` is optional; leave it unset to use the SnapDeploy API.

**CORS**

- Production: add your Vercel origin (e.g. `https://spotter-hos-app.vercel.app`) to `CORS_ALLOWED_ORIGINS`. Vercel preview URLs change per deploy, so add them too if you need to test previews.

---

## License

Released under the [MIT License](LICENSE).

---

## Contributing

Issues and pull requests are welcome at [github.com/SyedHaider037/spotter-hos-app](https://github.com/SyedHaider037/spotter-hos-app).
