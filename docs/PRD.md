# PRD — HOS Trip Planner

## Inputs

> **Status (updated 2026-10-09):** the app is built and deployed. Notes marked Built or Planned, not built say how each item stands today; the code is the source of truth. The original spec is kept; the nested Status notes are current.

- Current Location (string)
- Pickup Location (string)
- Dropoff Location (string)
- Current Cycle Used (hours, number)
  - **Status: Built.** The API fields are `current_location`, `pickup_location`, `dropoff_location` and `cycle_used_hours` on `POST /api/plan/`. The trip starts at the moment of the request (UTC); there is no start-time input.

## Outputs
- Stops list: type, location, lat/lng, start_time, end_time, duration
  - **Status: Built.** `duration` is in minutes. The response also carries `route` (an encoded polyline per leg) and, in each daily log, `remarks`.
- Daily logs: date, segments (status, start, end)

## HOS Rules
- Max 11 hrs driving/day
- 14 hr shift window
- 10 hr rest between shifts
- 30 min break after 8 cumulative driving hrs
- 70 hr / 8 day cycle
  - **Status: Built.** A flat 70-hour budget with a 34-hour restart inserted when it is reached. A rolling 8-day recap is Planned, not built.
- Fuel stop every 1,000 miles
  - **Status: Built.** A zero-minute marker every 1,000 miles driven, placed at the 1,000-mile point. It adds no on-duty or off-duty time.
- 1 hr On Duty at pickup
- 1 hr On Duty at dropoff

## Tech Stack
- Django + Django REST Framework
- React frontend
- OpenRouteService API (free)
  - **Status: Built.** OpenRouteService on `api.heigit.org`: geocoding and reverse geocoding (Pelias) and directions with the `driving-hgv` profile. Driving time is distance divided by `TRUCK_AVG_MPH` (default 55), an assumption, not ORS's duration.
- Leaflet.js map

## Beyond the PRD

Built although the PRD does not list it: the 34-hour restart, per-day ELD-style log sheets with remarks, per-IP rate limiting on the plan endpoint (15 per hour), a cold-start wake-up and retry flow for the free hosting tier, GitHub Actions CI.

Planned, not built (mentioned in the architecture notes, not in the PRD): persistence, user accounts and saved plans; React Query; caching of ORS responses; a `warnings` array; partial plans for infeasible trips; a rolling 8-day cycle recap.
