# HOS Trip Planner

A full-stack **Hours of Service (HOS)** trip planning application for commercial drivers. Enter current location, pickup, dropoff, and cycle hours used; the backend computes routes via **OpenRouteService**, simulates driving against **US-style HOS limits**, and returns **stops** and **daily log** segments. The **React** frontend shows an interactive map and ELD-style log sheets.

| Environment | URL |
|-------------|-----|
| **Live app** | [spotter-hos-app.vercel.app](https://spotter-hos-app.vercel.app) |
| **API (production)** | [spotter-hos-app-production.up.railway.app](https://spotter-hos-app-production.up.railway.app) |
| **Source** | [github.com/SyedHaider037/spotter-hos-app](https://github.com/SyedHaider037/spotter-hos-app) |

---

## Screenshot

> Add a screenshot after deployment: save as `docs/screenshot.png` and replace the line below with `![HOS Trip Planner](docs/screenshot.png)`.

![App screenshot — add image at docs/screenshot.png](https://via.placeholder.com/960x540/1e293b/94a3b8?text=HOS+Trip+Planner+%E2%80%94+Screenshot+Placeholder)

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
| **Backend** | Python 3, **Django 6**, **Django REST Framework**, Gunicorn |
| **Frontend** | **React** 19, Create React App, **react-leaflet** / Leaflet |
| **Routing / maps** | [OpenRouteService](https://openrouteservice.org/) (geocoding + directions) |
| **Config** | `python-dotenv` (e.g. `ORS_API_KEY`), environment variables on deploy |
| **CORS** | `django-cors-headers` (configured for local React dev) |

---

## Repository layout

```
spotter-hos-app/
├── backend/          # Django project + trip app + HOS / routing services
├── frontend/         # React SPA
├── docs/             # PRD, architecture notes, task breakdown
└── README.md         # This file
```

---

## Run locally

### Prerequisites

- Python **3.12+** (recommended; Django 6 compatible)
- Node.js **18+** and npm
- An **OpenRouteService** API key ([openrouteservice.org](https://openrouteservice.org/))

### 1. Backend

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
ORS_API_KEY=your_openrouteservice_key_here
```

Run migrations (if you add models later) and start the server:

```bash
python manage.py migrate
python manage.py runserver
```

API base (local): **http://localhost:8000**

### 2. Frontend

```bash
cd frontend
npm install
npm start
```

The dev server defaults to **http://localhost:3000**. The app calls the API at `http://localhost:8000` for planning; ensure CORS in `backend/backend/settings.py` allows your frontend origin.

### 3. Production-style API URL

If you point the frontend at the deployed backend, use your Railway URL as the fetch base (e.g. `https://spotter-hos-app-production.up.railway.app/api/plan/`).

---

## API documentation

### `POST /api/plan/`

Plans a trip from **current location → pickup → dropoff** using ORS for leg distances and the internal HOS simulator.

**URL (local)**  
`http://localhost:8000/api/plan/`

**URL (production)**  
`https://spotter-hos-app-production.up.railway.app/api/plan/`

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
| `cycle_used_hours` | number | Yes | Hours already used toward the **70 h / 8 day** cycle |

**Example**

```bash
curl -s -X POST https://spotter-hos-app-production.up.railway.app/api/plan/ \
  -H "Content-Type: application/json" \
  -d '{
    "current_location": "Chicago, IL",
    "pickup_location": "Dallas, TX",
    "dropoff_location": "New York, NY",
    "cycle_used_hours": 40
  }'
```

**Success — `200 OK`**

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
  ]
}
```

Stop `type` values include (among others): `CURRENT`, `PICKUP`, `DROPOFF`, `BREAK_30`, `REST_10`, `FUEL`, `ON_DUTY`. Segment `status` values: `OFF_DUTY`, `SLEEPER`, `ON_DUTY`, `DRIVING`.

**Client / validation errors — `400 Bad Request`**

```json
{
  "error": {
    "code": "PLAN_FAILED",
    "message": "Human-readable reason (e.g. invalid field, ORS error, cycle already exceeded)."
  }
}
```

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
| Rolling cycle limit | **70 hours / 8 days** |
| Fuel stop interval | Every **1,000 miles** |
| Pickup / dropoff | **1 hour** on duty each |

> **Note:** Regulatory HOS has additional nuances (recap vs reset, personal conveyance, adverse driving, etc.). This project implements the rules listed in the product spec for planning and visualization.

---

## Deployment

| Component | Platform | URL |
|-----------|----------|-----|
| **Frontend** | Vercel | [spotter-hos-app.vercel.app](https://spotter-hos-app.vercel.app) |
| **Backend** | Railway | [spotter-hos-app-production.up.railway.app](https://spotter-hos-app-production.up.railway.app) |

**Backend (Railway)**

- Set environment variables: `ORS_API_KEY`, `DJANGO_SECRET_KEY`, `ALLOWED_HOSTS`, and database URL if you move beyond SQLite.
- Use **Gunicorn** as the process command (see `requirements.txt`).

**Frontend (Vercel)**

- Build command: `npm run build` (from `frontend/`)
- Output directory: `frontend/build` (or root as configured in the Vercel project)
- Configure any **environment variable** or build-time constant if the API base URL should be production instead of localhost.

**CORS**

- Production: add your Vercel origin to `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` in Django settings so the browser can call the Railway API.

---

## License

Specify your license in this repository (e.g. MIT) if you intend open-source use.

---

## Contributing

Issues and pull requests are welcome at [github.com/SyedHaider037/spotter-hos-app](https://github.com/SyedHaider037/spotter-hos-app).
