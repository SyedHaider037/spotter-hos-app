# Architecture — HOS Trip Planner (Django + React)

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
- Route map (Leaflet) + turn-by-turn summary (optional)
- Generated plan:
  - Stop timeline (break/fuel/rest/pickup/dropoff)
  - Daily log view (segments by day)

### Backend (Django + DRF)
- Stateless planning API for MVP
- Optional persistence (user accounts + saved plans) as a later phase
- Integrations:
  - ORS Directions API (route geometry + duration + distance)
  - (Optional) ORS Geocoding API if you want backend-driven geocoding
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

### Time handling
- API accepts an explicit **trip start datetime with timezone** (or a timezone identifier) to produce stable logs.
- All computations are performed in a single timezone per trip (driver local or route start timezone) for MVP.

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

- **DailyLog**
  - `date`
  - `segments[]`

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
- `current_cycle_used_hours` (numeric)
- Route result from ORS:
  - total distance (meters) + duration (seconds)
  - polyline geometry + step breakdown (optional)

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
  - **70/8 cycle**: if cycle would exceed 70h, force OFF_DUTY time to bring it under limit (simplified reset behavior for MVP; see “Open questions”)

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
    - total distance + duration
    - geometry polyline (for map rendering)

### Supporting endpoints (optional)
- `GET /api/health`
- `POST /api/geocode` (only if frontend does not call ORS directly)

### Error model
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
  - Validation + “Plan Trip” action
- **Results**
  - Leaflet map with route polyline + stop markers
  - Timeline list of stops with times/durations
  - Daily log table/list grouped by date

### Data fetching
- `POST /api/plan` from React
- Use React Query (or equivalent) for request lifecycle + caching (optional)

---

## Backend architecture (Django)

### App/module layout (conceptual)
- `api/` (DRF serializers + views)
- `integrations/ors/` (ORS client wrapper, retries, timeouts)
- `domain/hos/` (planning engine, pure functions, unit tests)
- `domain/routing/` (route normalization + polyline interpolation utilities)

### Operational concerns
- Rate limiting + caching:
  - Cache ORS responses per (origin,destination) for short TTL in dev/MVP
- Observability:
  - Request correlation id, structured logs
- Security:
  - ORS API key stored server-side (env var / secret manager)

---

## Deployment (MVP)
- Backend: containerized Django app (Gunicorn) behind reverse proxy
- Frontend: static build served via CDN or same reverse proxy
- Environment variables:
  - `ORS_API_KEY`
  - `DJANGO_SECRET_KEY`, `DATABASE_URL` (if persistence later)

---

## Open questions / assumptions to lock down before implementation
- **Fuel stop duration**: not specified in PRD (assumed ON_DUTY, duration TBD).
- **70/8 reset behavior**: PRD says “70 hr / 8 day cycle” but does not specify recap vs 34-hour reset mechanics.
- **Geocoding**: whether locations are raw strings resolved by backend, or frontend provides lat/lng.
- **Infeasible plans**: expected behavior when constraints make trip impossible without additional rest days (likely: return best-effort with warnings, or return an error with partial plan).
