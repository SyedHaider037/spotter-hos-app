# Architecture — HOS Trip Planner (Django + React)

> **Status (updated 2026-10-09):** this document was written before the app was built. Notes marked **Status: Built** or **Status: Planned, not built** say how each item stands today; the thinking is kept. Where text and code differ, the code is the source of truth.
>
> | Area | Today |
> |---|---|
> | Planning API | Built: stateless `POST /api/plan/` |
> | Persistence, accounts, saved plans | Planned, not built |
> | React Query | Planned, not built (plain `fetch` with retry logic) |
> | ORS response caching | Planned, not built |
> | `warnings` array, partial plans for infeasible trips | Planned, not built |
> | Rate limiting | Built (per client address, 15 per hour on the plan endpoint) |
> | Fuel stop | Built: a zero-minute marker every 1,000 miles |
> | 34-hour restart | Built (flat 70-hour budget; rolling 8-day recap is Planned, not built) |
> | CI | Built (GitHub Actions: tests and builds) |


## Scope
This architecture supports a trip-planning experience that:
- Accepts **current location**, **pickup**, **dropoff**, and **current 70/8 cycle used hours**
- Computes a route (distance + duration) using **OpenRouteService (ORS)**
- Generates a **time-sequenced plan** of stops and a **daily log** of duty-status segments that respect the PRD HOS constraints
- Renders the route + stops on a **Leaflet** map in a **React** frontend

Non-goals for MVP (can be added later): multi-trip account history, ELD integrations, carrier admin features, payment/monetization, advanced exemptions/edge-case HOS interpretations.

---

## High-level system diagram

### Frontend (React)
- Address/location entry (current, pickup, dropoff)
- Trip settings (start time, average speed assumptions if needed, cycle used)
  - **Status: Built.** Only cycle used hours is an input. The start time is the request time and the average speed is the server setting `TRUCK_AVG_MPH`. A start-time input and a speed input are Planned, not built.
- Route map (Leaflet) + turn-by-turn summary (optional)
  - **Status: Planned, not built.** Turn-by-turn summary. The route line, stop markers with popups and a legend are built.
- Generated plan:
  - Stop timeline (break/fuel/rest/pickup/dropoff)
  - Daily log view (segments by day)

### Backend (Django + DRF)
- Stateless planning API for MVP
- Optional persistence (user accounts + saved plans) as a later phase
  - **Status: Planned, not built.** No database models are used; accounts and saved plans do not exist.
- Integrations:
  - ORS Directions API (route geometry + duration + distance)
    - **Status: Built.** `api.heigit.org`, profile `driving-hgv`. Distance and geometry are used. ORS's duration is not: driving time is distance divided by `TRUCK_AVG_MPH` (default 55), because the `driving-hgv` durations averaged about 40 mph in testing.
  - (Optional) ORS Geocoding API if you want backend-driven geocoding
    - **Status: Built.** The backend geocodes the location strings (Pelias search) and reverse geocodes rest and break positions for the log remarks.
- Core domain service:
  - **HOS Planning Engine**: converts route metrics into stops + duty segments

---

## Key architectural decisions

### Compute placement
- **Backend computes the HOS plan** (authoritative rules + consistent results).
- Frontend focuses on UX, visualization, and input validation.

Rationale: HOS logic is easier to test, version, and evolve server-side; avoids exposing ORS key and rule details to the client.

### MVP persistence
Two viable MVP modes:
- **Mode A (recommended MVP): Stateless planning**
  - No user accounts required
  - Request → compute → return plan
- **Mode B (phase 2): Saved plans**
  - Add auth + DB models for storing plans and reloading them

This architecture supports both; implement Mode A first.

> **Status: Built.** Mode A only. Mode B (saved plans, auth) is Planned, not built.


### Time handling
- API accepts an explicit **trip start datetime with timezone** (or a timezone identifier) to produce stable logs.
- All computations are performed in a single timezone per trip (driver local or route start timezone) for MVP.
  - **Status: Built.** The request has no `trip_start_time`: the clock starts at the request time. Everything is UTC and daily logs split at UTC midnight. Accepting an explicit start time and timezone is Planned, not built.

---

## Domain model (conceptual)

### Entities returned by API
- **Stop**
  - `type`: `CURRENT` | `PICKUP` | `DROPOFF` | `BREAK_30` | `REST_10` | `FUEL` | `ON_DUTY` (if modeled as stops) | `OTHER`
  - `location`: human label
  - `lat`, `lng`
  - `start_time`, `end_time`
  - `duration_minutes`
  - `notes` (optional: why inserted, rule triggered)
    - **Status: Built.** Fields returned: `type`, `location`, `lat`, `lng`, `start_time`, `end_time`, `duration` (minutes; named `duration`, not `duration_minutes`). Types in use: `CURRENT`, `PICKUP`, `DROPOFF`, `BREAK_30`, `REST_10`, `RESTART_34`, `FUEL`, `ON_DUTY`. `OTHER` is not used. `notes` is Planned, not built.

- **DailyLog**
  - `date`
  - `segments[]`
    - **Status: Built.** Each daily log also carries `remarks[]`: one entry per duty-status change, with time, place and activity, used by the log sheets.

- **Segment**
  - `status`: `OFF_DUTY` | `SLEEPER` | `ON_DUTY` | `DRIVING`
  - `start`, `end`

### Internal planning state (not exposed, but guides implementation)
- `drive_today_minutes` (cap 11h)
- `shift_elapsed_minutes` (cap 14h window)
- `break_since_last_30_minutes` (trigger at 8h driving)
- `cycle_used_minutes` with 70h/8day logic
- `fuel_since_last_stop_miles` (trigger at 1000 miles)
- `time_cursor` (current simulated time)
- `position_cursor` (along route polyline)

---

## HOS Planning Engine (logic boundaries)

### Inputs
- `current`, `pickup`, `dropoff` locations (either strings or lat/lng + label)
- `trip_start_time` (datetime with timezone)
  - **Status: Planned, not built.** See Time handling above.
- `current_cycle_used_hours` (numeric)
  - **Status: Built.** Named `cycle_used_hours` in the API. Values above 70 are rejected.
- Route result from ORS:
  - total distance (meters) + duration (seconds)
  - polyline geometry + step breakdown (optional)
    - **Status: Built.** Polyline geometry only. A step breakdown is Planned, not built.

### Outputs
- Ordered `stops[]`
- `daily_logs[]` with duty-status segments covering the full trip timeline

### Planning approach (deterministic and testable)
- Convert route into a continuous “distance/time budget” stream.
- Simulate forward in time, inserting events when constraints trigger:
  - **Pickup**: +1h ON_DUTY at pickup arrival
  - **Dropoff**: +1h ON_DUTY at dropoff arrival
  - **30 min break** when cumulative driving since last break reaches 8h
  - **Rest 10h** when 11h driving/day is exhausted or 14h shift window is exhausted
  - **Fuel** every 1000 miles (clarify whether fuel is ON_DUTY or OFF_DUTY; default: ON_DUTY)
    - **Status: Built.** A zero-minute `FUEL` marker every 1,000 miles driven, placed at the 1,000-mile point (each driving chunk is capped at the miles left to it, so it can fall mid-leg). It is neither on duty nor off duty and adds no time. At the final dropoff none is added.
  - **70/8 cycle**: if cycle would exceed 70h, force OFF_DUTY time to bring it under limit (simplified reset behavior for MVP; see “Open questions”)
    - **Status: Built.** A flat 70-hour budget: when it is reached mid-trip a 34-hour off-duty `RESTART_34` is inserted and the budget resets. The rolling 8-day recap is Planned, not built.

### Segment semantics (logbook-friendly)
- Driving time consumes:
  - 11h/day limit
  - 14h shift window
  - 8h-before-break accumulator
  - 70h/8day cycle (depending on how you model ON_DUTY/DRIVING totals)
- Pickup/Dropoff adds ON_DUTY time and consumes:
  - 14h shift window
  - 70h/8day cycle

---

## API design (DRF)

### `POST /api/plan`

> **Status: Built.** The route is `POST /api/plan/` (trailing slash). Request fields: `current_location`, `pickup_location`, `dropoff_location`, `cycle_used_hours`. The optional tuning inputs listed below are Planned, not built: the break is a fixed 30 minutes, the fuel stop is a zero-minute marker and the speed is a server setting.

- **Request (MVP)**
  - `trip_start_time` (ISO-8601)
  - `current_location` (string)
  - `pickup_location` (string)
  - `dropoff_location` (string)
  - `current_cycle_used_hours` (number)
  - Optional tuning inputs for determinism:
    - `average_speed_mph` (if you choose not to rely solely on ORS duration)
    - `fuel_stop_duration_minutes` (default TBD)
    - `break_30_duration_minutes` (default 30)

- **Response**
  - `stops[]` (as in PRD)
  - `daily_logs[]` (as in PRD)
  - `route` summary:
    - **Status: Built.** `route` is `{ "encoding": "polyline5", "legs": [{ "polyline": ... }] }`, one polyline per leg. Total distance and duration are not returned; the frontend works its summary out from the plan and the polylines.
    - total distance + duration
    - geometry polyline (for map rendering)

### Supporting endpoints (optional)

> **Status: Planned, not built.** Neither `GET /api/health` nor `POST /api/geocode` exists.

- `GET /api/health`
- `POST /api/geocode` (only if frontend does not call ORS directly)

### Error model

> **Status: Built.** The envelope is `{ "error": { "code", "message" } }`. Codes in use: `PLAN_FAILED` (HTTP 400: invalid input, invalid JSON, cycle hours over 70, ORS failures), `RATE_LIMITED` (429, with a `Retry-After` header) and `INTERNAL_ERROR` (500). The codes `INVALID_LOCATION`, `ORS_UNAVAILABLE`, `HOS_INFEASIBLE` and a `details` field are Planned, not built.

- Consistent DRF error envelope with:
  - `code` (e.g. `INVALID_LOCATION`, `ORS_UNAVAILABLE`, `HOS_INFEASIBLE`)
  - `message`
  - `details` (field errors, upstream info)

---

## External integration: OpenRouteService (ORS)
- **Directions**: compute route geometry + duration + distance between:
  - current → pickup
  - pickup → dropoff
  - (Optional) insert intermediate waypoints if your engine chooses specific fuel/break locations along the path

### Waypoint strategy (important)

> **Status: Built.** Approach A: the planner places each stop at the fraction of the leg already driven, interpolated between the decoded polyline vertices. That is an approximation, not distance-accurate. Approach B (real POIs) is Planned, not built.

Two approaches:
- **A: “Stops at points along geometry” (recommended MVP)**
  - Use ORS route geometry as the path
  - Interpolate lat/lng along the polyline to place “virtual” fuel/break stops
  - Pros: simpler, single directions call per leg
  - Cons: stop address labels may be generic (e.g. “Fuel stop (approx)”) without POI search

- **B: “Stops at real POIs” (phase 2)**
  - Use ORS POIs / external POI provider to find fuel stations near the route
  - Pros: realistic stop locations
  - Cons: more API calls + complexity

---

## Frontend architecture (React)

### Key screens/components
- **Trip Form**
  - Inputs: current/pickup/dropoff/cycle-used/start time
    - **Status: Planned, not built.** The start time input. The other four inputs are built.
  - Validation + “Plan Trip” action
- **Results**
  - Leaflet map with route polyline + stop markers
  - Timeline list of stops with times/durations
  - Daily log table/list grouped by date

### Data fetching
- `POST /api/plan` from React
- Use React Query (or equivalent) for request lifecycle + caching (optional)
  - **Status: Planned, not built.** React Query is not used. `App.js` calls `fetch` directly, with retry logic for a sleeping free-tier server and a friendly message for HTTP 429.

---

## Backend architecture (Django)

### App/module layout (conceptual)

> **Status: Built.** The real layout is `backend/trip/`: `views.py`, `throttles.py`, `api_errors.py`, `services/` (`hos_rules.py`, `trip_planner.py`, `route_service.py`) and `tests/`. There are no separate `api/`, `integrations/` or `domain/` packages.

- `api/` (DRF serializers + views)
- `integrations/ors/` (ORS client wrapper, retries, timeouts)
- `domain/hos/` (planning engine, pure functions, unit tests)
- `domain/routing/` (route normalization + polyline interpolation utilities)

### Operational concerns
- Rate limiting + caching:
  - **Rate limiting. Status: Built.** DRF throttling on the plan endpoint only, 15 requests per hour per client address (`PLAN_THROTTLE_RATE`). Behind Cloudflare the visitor address comes from `CF-Connecting-IP`, otherwise from the proxy hop (`THROTTLE_NUM_PROXIES`). The 429 uses the error envelope and carries `Retry-After`.
  - Cache ORS responses per (origin,destination) for short TTL in dev/MVP
    - **Status: Planned, not built.** Only a per-request cache of geocoding results exists, so the pickup is geocoded once per plan.
- Observability:
  - Request correlation id, structured logs
    - **Status: Partly built.** One INFO log line per plan request (entry count, masked client address, source) and logged unhandled exceptions. Request IDs, structured logs and metrics are Planned, not built.
- Security:
  - ORS API key stored server-side (env var / secret manager)

---

## Deployment (MVP)
- Backend: containerized Django app (Gunicorn) behind reverse proxy
  - **Status: Built.** Docker image (`python:3.13-slim`) run by Gunicorn with 1 worker, 4 threads and a 60 s timeout, on SnapDeploy's free tier. The frontend is built by Vercel. GitHub Actions runs the tests and builds.
- Frontend: static build served via CDN or same reverse proxy
- Environment variables:
  - `ORS_API_KEY`
    - **Status: Built.** Also read: `DJANGO_SECRET_KEY` (required), `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `PLAN_THROTTLE_RATE`, `THROTTLE_NUM_PROXIES`, `TRUCK_AVG_MPH`. Frontend: `REACT_APP_API_URL`.
  - `DJANGO_SECRET_KEY` (a database connection variable would only be added if persistence is introduced later)

---

## Open questions / assumptions to lock down before implementation
- **Fuel stop duration**: not specified in PRD (assumed ON_DUTY, duration TBD).
  - **Resolved:** a zero-minute marker; it adds no time.
- **70/8 reset behavior**: PRD says “70 hr / 8 day cycle” but does not specify recap vs 34-hour reset mechanics.
  - **Resolved:** a flat 70-hour budget with a 34-hour restart. The rolling 8-day recap is Planned, not built.
- **Geocoding**: whether locations are raw strings resolved by backend, or frontend provides lat/lng.
  - **Resolved:** the frontend sends location strings and the backend geocodes them.
- **Infeasible plans**: expected behavior when constraints make trip impossible without additional rest days (likely: return best-effort with warnings, or return an error with partial plan).
  - **Resolved differently:** no partial plans and no warnings. A request the planner cannot serve returns HTTP 400 `PLAN_FAILED` with a message. Partial plans with warnings are Planned, not built.
