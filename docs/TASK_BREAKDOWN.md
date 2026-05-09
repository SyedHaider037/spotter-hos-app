# Task Breakdown — HOS Trip Planner

## Delivery milestones
- **M0: Repo + workflow ready**: environments, baseline docs, local run plan
- **M1: Routing + map shown**: input → route line on map with summary distance/time
- **M2: HOS plan generated**: route → stops list + daily logs returned by API
- **M3: Full UX**: timeline + daily logs UI + map stop markers
- **M4: Quality + deploy**: tests, monitoring, deployment pipeline, rate-limit/caching

---

## Epic 1 — Project foundation (Django + React)
**Goal:** Establish the project structure, conventions, environments, and CI-ready baseline.

### Stories / tasks
- **1.1 Define system contracts**
  - Finalize `POST /api/plan` request/response schema (including timezones and tuning defaults)
  - Define duty status enums + stop types
  - Define error envelope and warning model
- **1.2 Environment strategy**
  - Decide dev orchestration (local venv + npm, or Docker Compose)
  - Configure environment variable management for `ORS_API_KEY`
- **1.3 Quality baseline**
  - Add formatting + linting plan for Python and TypeScript
  - Add test strategy outline (unit tests for HOS engine, contract tests for API, UI smoke tests)

**Dependencies:** none  
**Delivers:** agreed contracts + predictable local setup.

---

## Epic 2 — ORS routing integration
**Goal:** Reliable route computation (distance/duration/geometry) and normalized route model.

### Stories / tasks
- **2.1 ORS client wrapper**
  - Define timeouts/retries and error mapping (`ORS_UNAVAILABLE`, `ORS_INVALID_REQUEST`)
  - Normalize ORS response to internal `Route` object (distance, duration, geometry polyline)
- **2.2 Geocoding decision**
  - Option A: backend geocodes location strings
  - Option B: frontend geocodes and sends lat/lng
  - Document decision + input validation
- **2.3 Route interpolation utility**
  - Provide function to compute lat/lng at distance fraction along polyline
  - Provide mapping from elapsed drive time to point along geometry (for stop placement)

**Dependencies:** Epic 1 contracts  
**Delivers:** stable route primitives for planning and mapping.

---

## Epic 3 — HOS Planning Engine (core logic)
**Goal:** Deterministic stop + log generation that enforces PRD rules.

### Stories / tasks
- **3.1 Define rule model and state machine**
  - Driving/day cap (11h)
  - Shift window (14h)
  - Rest between shifts (10h)
  - Break after 8h cumulative driving (30m)
  - Fuel every 1000 miles
  - Pickup/dropoff on-duty (1h each)
  - Cycle limit 70h/8day (define MVP assumption: recap vs reset)
- **3.2 Build simulation loop**
  - Inputs: route legs + start time + cycle used
  - Maintain planning state (drive today, shift elapsed, break accumulator, cycle used, fuel distance)
  - Emit events: `DRIVING` segments and stop segments (`ON_DUTY`, `OFF_DUTY/SLEEPER`)
- **3.3 Stop placement**
  - Map each inserted stop to a lat/lng on route geometry
  - Include labels and notes (e.g., “30-min break (8h rule)”)
- **3.4 Daily log generation**
  - Convert timeline into `daily_logs[date].segments[]`
  - Ensure segments do not cross date boundaries (split at midnight)
- **3.5 Edge-case policy**
  - Multi-day trips: repeated daily limits + required rests
  - Infeasible route/time: return partial plan with warnings vs hard error (choose behavior)
  - Timezone handling policy (single-trip timezone for MVP)
- **3.6 Unit test suite for engine**
  - Break triggered near boundary (7:59 → no break, 8:00 → break)
  - Shift boundary forcing rest
  - Fuel interval insertion
  - Pickup/dropoff on-duty insertion
  - Cycle limit interaction

**Dependencies:** Epic 2 route primitives  
**Delivers:** engine producing exactly the PRD outputs (stops + daily logs).

---

## Epic 4 — Backend API (DRF)
**Goal:** Expose trip planning as a stable HTTP API.

### Stories / tasks
- **4.1 Implement `POST /api/plan` endpoint**
  - Validate inputs (required fields, numeric ranges, datetime format)
  - Call ORS for route legs
  - Invoke HOS engine
  - Return `stops`, `daily_logs`, and `route` geometry/summary
- **4.2 Error + warning handling**
  - Convert ORS failures to API errors
  - Add warnings array for “assumption used” cases (e.g., fuel duration default)
- **4.3 Caching + rate limiting (MVP-safe)**
  - Cache ORS route responses by origin/destination for short TTL
  - Rate limit plan requests per client (basic)
- **4.4 Contract tests**
  - Golden response shape tests for `/api/plan`
  - Error cases for invalid inputs

**Dependencies:** Epics 1–3  
**Delivers:** production-shaped API surface for frontend integration.

---

## Epic 5 — Frontend UX (React + Leaflet)
**Goal:** Great planning UX with map visualization and readable plan outputs.

### Stories / tasks
- **5.1 Trip input form**
  - Inputs: current/pickup/dropoff/cycle-used/start time
  - Inline validation and clear errors
- **5.2 Plan results view**
  - Render route polyline on Leaflet map
  - Render stop markers with popovers (type, time, duration)
  - Render stops timeline list (sorted, grouped by day optionally)
- **5.3 Daily logs UI**
  - Per-day list/table of segments (status, start, end)
  - Visual timeline (optional phase 2)
- **5.4 Loading + failure states**
  - “Planning…” state, retriable errors, ORS unavailable messaging
- **5.5 UI test plan**
  - Smoke test for “submit → results show map + list”

**Dependencies:** Epic 4 API  
**Delivers:** end-to-end usable application producing PRD outputs visually.

---

## Epic 6 — Deployment & operations
**Goal:** Ship safely with minimal operational surprises.

### Stories / tasks
- **6.1 Deployment target decision**
  - Single host (Docker) vs PaaS for backend + static hosting for frontend
- **6.2 Secrets + config**
  - ORS key management
  - Environment separation (dev/staging/prod)
- **6.3 Observability**
  - Structured logs, request IDs
  - Basic metrics (latency, error rates)
- **6.4 Performance & quota protection**
  - Tight ORS timeouts, request coalescing where possible
  - Cache sizing and invalidation policy

**Dependencies:** Epics 4–5  
**Delivers:** deployable MVP and confidence in runtime behavior.

---

## Suggested build order (dependency-driven)
- **Phase A (M1):** Epic 1 → Epic 2 → (Epic 5 partial: map + route only)
- **Phase B (M2):** Epic 3 → Epic 4
- **Phase C (M3):** Epic 5 full (stops + logs UI)
- **Phase D (M4):** Epic 6 + hardening across Epics 2–5

