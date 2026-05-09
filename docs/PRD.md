# PRD — HOS Trip Planner

## Inputs
- Current Location (string)
- Pickup Location (string)
- Dropoff Location (string)
- Current Cycle Used (hours, number)

## Outputs
- Stops list: type, location, lat/lng, start_time, end_time, duration
- Daily logs: date, segments (status, start, end)

## HOS Rules
- Max 11 hrs driving/day
- 14 hr shift window
- 10 hr rest between shifts
- 30 min break after 8 cumulative driving hrs
- 70 hr / 8 day cycle
- Fuel stop every 1,000 miles
- 1 hr On Duty at pickup
- 1 hr On Duty at dropoff

## Tech Stack
- Django + Django REST Framework
- React frontend
- OpenRouteService API (free)
- Leaflet.js map