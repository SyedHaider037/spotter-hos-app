"""
Trip planning simulation (clock-based).

Inputs:
  - current_location (string)
  - pickup_location (string)
  - dropoff_location (string)
  - cycle_used_hours (number)

Outputs:
  - stops list
  - daily_logs list
  - route (encoded geometry per leg, for drawing on a map)

Rules enforced (from PRD):
  - 11 hr max driving per day
  - 14 hr shift window
  - 10 hr rest between shifts
  - 30 min break after 8 cumulative driving hours
  - 70 hr cycle limit (flat budget); a 34 hr restart is inserted when it is reached mid-trip
  - Fuel stop every 1000 miles
  - 1 hr On Duty at pickup
  - 1 hr On Duty at dropoff

This module contains logic only (no Django views).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, TypedDict

from . import hos_rules
from .route_service import RouteServiceError, RouteResult, get_route, reverse_geocode


StopType = Literal["CURRENT", "PICKUP", "DROPOFF", "BREAK_30", "REST_10", "RESTART_34", "FUEL", "ON_DUTY"]
DutyStatus = Literal["OFF_DUTY", "SLEEPER", "ON_DUTY", "DRIVING"]


class Stop(TypedDict):
    type: StopType
    location: str
    lat: float
    lng: float
    start_time: str
    end_time: str
    duration: int  # minutes


class LogSegment(TypedDict):
    status: DutyStatus
    start: str
    end: str


class Remark(TypedDict):
    time: str
    place: str  # "City, ST" (or the location as typed for current/pickup/dropoff)
    activity: str


class DailyLog(TypedDict):
    date: str
    segments: list[LogSegment]
    remarks: list[Remark]  # one per duty-status change, for the log sheet's remarks section


class TripPlannerError(RuntimeError):
    pass


# Float slack when comparing accumulated cycle hours against the cap.
CYCLE_EPSILON_HOURS = 1e-6


@dataclass
class _Leg:
    origin_label: str
    destination_label: str
    route: RouteResult
    points: list[tuple[float, float]]  # [(lat, lng), ...]
    distance_miles: float
    duration_hours: float


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _duration_minutes(delta: timedelta) -> int:
    return int(round(delta.total_seconds() / 60.0))


def _decode_polyline(polyline: str) -> list[tuple[float, float]]:
    """
    Decode an encoded polyline to a list of (lat, lng).
    Minimal implementation of Google's polyline algorithm.
    """
    index = 0
    lat = 0
    lng = 0
    coords: list[tuple[float, float]] = []

    while index < len(polyline):
        shift = 0
        result = 0
        while True:
            b = ord(polyline[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        shift = 0
        result = 0
        while True:
            b = ord(polyline[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng

        coords.append((lat / 1e5, lng / 1e5))

    if len(coords) < 2:
        raise TripPlannerError("Route polyline decoded to insufficient points.")
    return coords


def _interpolate_point(points: list[tuple[float, float]], fraction: float) -> tuple[float, float]:
    """
    Return a point along the polyline by index interpolation.
    This is not distance-accurate; it's a simple, stable approximation.
    """
    if not points:
        raise TripPlannerError("Cannot interpolate empty polyline.")
    if fraction <= 0:
        return points[0]
    if fraction >= 1:
        return points[-1]

    pos = fraction * (len(points) - 1)
    i = int(pos)
    t = pos - i
    lat1, lng1 = points[i]
    lat2, lng2 = points[min(i + 1, len(points) - 1)]
    return (lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t)


def _add_segment(segments: list[LogSegment], status: DutyStatus, start: datetime, end: datetime) -> None:
    if end <= start:
        return
    segments.append({"status": status, "start": _iso(start), "end": _iso(end)})


def _split_into_daily_logs(segments: list[LogSegment]) -> list[DailyLog]:
    """
    Split segments by UTC date boundaries.
    """
    by_date: dict[str, list[LogSegment]] = {}

    for seg in segments:
        status = seg["status"]
        start = datetime.fromisoformat(seg["start"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(seg["end"].replace("Z", "+00:00"))

        cursor = start
        while cursor.date() != end.date():
            midnight = datetime(cursor.year, cursor.month, cursor.day, tzinfo=timezone.utc) + timedelta(days=1)
            by_date.setdefault(cursor.date().isoformat(), []).append(
                {"status": status, "start": _iso(cursor), "end": _iso(midnight)}
            )
            cursor = midnight

        by_date.setdefault(cursor.date().isoformat(), []).append({"status": status, "start": _iso(cursor), "end": _iso(end)})

    return [{"date": d, "segments": segs} for d, segs in sorted(by_date.items(), key=lambda kv: kv[0])]


def _attach_remarks(daily_logs: list[DailyLog], events: list[dict[str, Any]]) -> None:
    """Attach each remark to the daily log of the UTC date it happened on (sorted by time)."""
    by_date = {log["date"]: log for log in daily_logs}
    for log in daily_logs:
        log["remarks"] = []
    if not daily_logs:
        return
    for event in sorted(events, key=lambda e: e["time"]):
        log = by_date.get(event["time"].astimezone(timezone.utc).date().isoformat(), daily_logs[-1])
        log["remarks"].append({"time": _iso(event["time"]), "place": event["place"], "activity": event["activity"]})


def _resolve_event_places(events: list[dict[str, Any]]) -> None:
    """Fill in "City, ST" for events that only have coordinates (one lookup per distinct spot, in parallel)."""
    spots = {(round(e["lat"], 2), round(e["lng"], 2)) for e in events if e["place"] is None}
    if not spots:
        return
    ordered = sorted(spots)
    with ThreadPoolExecutor(max_workers=min(6, len(ordered))) as pool:
        names = list(pool.map(lambda s: reverse_geocode(s[0], s[1]), ordered))
    resolved = dict(zip(ordered, names))
    for event in events:
        if event["place"] is None:
            spot = (round(event["lat"], 2), round(event["lng"], 2))
            event["place"] = resolved.get(spot) or f"{event['lat']:.2f}, {event['lng']:.2f}"


def _add_stop(
    stops: list[Stop],
    *,
    stop_type: StopType,
    location: str,
    lat: float,
    lng: float,
    start: datetime,
    end: datetime,
) -> None:
    stops.append(
        {
            "type": stop_type,
            "location": location,
            "lat": float(lat),
            "lng": float(lng),
            "start_time": _iso(start),
            "end_time": _iso(end),
            "duration": _duration_minutes(end - start),
        }
    )


def _build_leg(
    origin_label: str, destination_label: str, geocode_cache: dict[str, tuple[float, float]]
) -> _Leg:
    try:
        route = get_route(origin_label, destination_label, geocode_cache=geocode_cache)
    except RouteServiceError as exc:
        raise TripPlannerError(str(exc)) from exc

    points = _decode_polyline(route.polyline)
    return _Leg(
        origin_label=origin_label,
        destination_label=destination_label,
        route=route,
        points=points,
        distance_miles=route.distance_miles,
        duration_hours=route.duration_hours,
    )


def plan_trip(
    current_location: str,
    pickup_location: str,
    dropoff_location: str,
    cycle_used_hours: float,
    start_time: datetime | None = None,
) -> dict[str, Any]:
    """
    Simulate the trip and return:
      - stops: list[Stop]
      - daily_logs: list[DailyLog]
      - route: {"encoding": "polyline5", "legs": [{"polyline": str}, ...]} (current->pickup, pickup->dropoff)

    `start_time` (timezone-aware) defaults to the current UTC time; pass it for deterministic output.
    """
    if cycle_used_hours < 0:
        raise TripPlannerError("cycle_used_hours must be >= 0.")
    if cycle_used_hours > hos_rules.MAX_CYCLE_HOURS:
        raise TripPlannerError(f"cycle_used_hours cannot exceed {hos_rules.MAX_CYCLE_HOURS}.")

    # Clock starts "now" in UTC unless the caller supplies a start time.
    now = start_time if start_time is not None else datetime.now(timezone.utc)

    # Shared across legs so the pickup location is geocoded only once.
    geocode_cache: dict[str, tuple[float, float]] = {}
    legs = [
        _build_leg(current_location, pickup_location, geocode_cache),
        _build_leg(pickup_location, dropoff_location, geocode_cache),
    ]

    stops: list[Stop] = []
    segments: list[LogSegment] = []
    events: list[dict[str, Any]] = []  # duty-status changes, for the log sheet's remarks

    def add_event(when: datetime, activity: str, lat: float, lng: float, place: str | None = None) -> None:
        events.append({"time": when, "activity": activity, "lat": lat, "lng": lng, "place": place})

    # Initial marker stop (0 duration).
    start_lat, start_lng = legs[0].points[0]
    # A driver who starts with the whole cycle used cannot drive until a 34-hour restart, so the trip begins with one.
    starts_at_cap = hos_rules.cycle_limit_reached(cycle_used_hours)
    if not starts_at_cap:
        add_event(now, "Start trip, driving", start_lat, start_lng, current_location)
    _add_stop(stops, stop_type="CURRENT", location=current_location, lat=start_lat, lng=start_lng, start=now, end=now)

    # State tracked in hours / miles.
    time_cursor = now
    driving_today = 0.0
    shift_start = now
    driving_since_break = 0.0
    miles_since_fuel = 0.0
    cycle_used = float(cycle_used_hours)

    def ensure_cycle_capacity(added_hours: float) -> None:
        # Callers restart before the cap is hit, so reaching this error means a planner bug, not a long trip.
        nonlocal cycle_used
        if cycle_used + added_hours > hos_rules.MAX_CYCLE_HOURS + CYCLE_EPSILON_HOURS:
            raise TripPlannerError("Trip would exceed 70-hour/8-day cycle limit.")
        cycle_used += added_hours

    def do_restart_34h(
        lat: float, lng: float, resume: str | None = "Resume driving", place: str | None = None
    ) -> None:
        """34 consecutive hours off duty: resets the 70-hour cycle as well as the daily driving/shift clocks."""
        nonlocal time_cursor, driving_today, shift_start, driving_since_break, cycle_used
        start = time_cursor
        end = time_cursor + timedelta(hours=hos_rules.RESTART_HOURS)
        add_event(start, "34-hour restart (off duty)", lat, lng, place)
        if resume:
            add_event(end, resume, lat, lng)
        _add_segment(segments, "OFF_DUTY", start, end)
        _add_stop(stops, stop_type="RESTART_34", location="34-hour restart", lat=lat, lng=lng, start=start, end=end)
        time_cursor = end
        driving_today = 0.0
        driving_since_break = 0.0
        shift_start = end
        cycle_used = 0.0

    def do_rest_10h(lat: float, lng: float) -> None:
        nonlocal time_cursor, driving_today, shift_start, driving_since_break
        rest = timedelta(hours=hos_rules.MIN_REST_HOURS)
        start = time_cursor
        end = time_cursor + rest
        add_event(start, "10-hour rest (off duty)", lat, lng)
        add_event(end, "Resume driving", lat, lng)
        _add_segment(segments, "OFF_DUTY", start, end)
        _add_stop(stops, stop_type="REST_10", location="Rest (10 hours)", lat=lat, lng=lng, start=start, end=end)
        time_cursor = end
        driving_today = 0.0
        driving_since_break = 0.0
        shift_start = time_cursor

    def do_break_30(lat: float, lng: float) -> None:
        nonlocal time_cursor, driving_since_break
        brk = timedelta(minutes=hos_rules.BREAK_DURATION_MINUTES)
        start = time_cursor
        end = time_cursor + brk
        add_event(start, "30-minute break (off duty)", lat, lng)
        add_event(end, "Resume driving", lat, lng)
        _add_segment(segments, "OFF_DUTY", start, end)
        _add_stop(stops, stop_type="BREAK_30", location="30-min break", lat=lat, lng=lng, start=start, end=end)
        time_cursor = end
        driving_since_break = 0.0

    def do_fuel_stop(lat: float, lng: float) -> None:
        nonlocal time_cursor, miles_since_fuel
        # Duration not specified in PRD; keep as 0-minute stop marker for MVP logic-only output.
        start = time_cursor
        end = time_cursor
        _add_stop(stops, stop_type="FUEL", location="Fuel stop", lat=lat, lng=lng, start=start, end=end)
        miles_since_fuel = 0.0

    def do_on_duty(
        hours: float, label: str, stop_type: StopType, lat: float, lng: float, place: str, arrive: str, depart: str
    ) -> None:
        nonlocal time_cursor
        if cycle_used + hours > hos_rules.MAX_CYCLE_HOURS + CYCLE_EPSILON_HOURS:
            # Arrived with the cycle exhausted: wait out a 34-hour restart before loading/unloading.
            do_restart_34h(lat, lng, resume=None)
        dur = timedelta(hours=hours)
        start = time_cursor
        end = time_cursor + dur
        add_event(start, arrive, lat, lng, place)
        add_event(end, depart, lat, lng, place)
        ensure_cycle_capacity(hours)
        _add_segment(segments, "ON_DUTY", start, end)
        _add_stop(stops, stop_type=stop_type, location=label, lat=lat, lng=lng, start=start, end=end)
        time_cursor = end

    def available_drive_hours_before_limits() -> float:
        shift_elapsed = (time_cursor - shift_start).total_seconds() / 3600.0
        remaining_shift = hos_rules.MAX_SHIFT_HOURS - shift_elapsed
        remaining_drive = hos_rules.MAX_DRIVING_HOURS - driving_today
        remaining_break = hos_rules.BREAK_AFTER_HOURS - driving_since_break
        remaining_cycle = hos_rules.MAX_CYCLE_HOURS - cycle_used
        return max(0.0, min(remaining_shift, remaining_drive, remaining_break, remaining_cycle))

    def drive_for(leg: _Leg, hours: float) -> float:
        """
        Drive `hours` on the given leg, updating logs/stops state and returning miles driven.
        """
        nonlocal time_cursor, driving_today, driving_since_break, miles_since_fuel

        if hours <= 0:
            return 0.0

        # Consume cycle for driving hours.
        ensure_cycle_capacity(hours)

        start = time_cursor
        end = time_cursor + timedelta(hours=hours)
        _add_segment(segments, "DRIVING", start, end)

        time_cursor = end
        driving_today += hours
        driving_since_break += hours

        # Miles driven proportionally to ORS leg pace.
        mph = (leg.distance_miles / leg.duration_hours) if leg.duration_hours > 0 else 0.0
        miles = mph * hours
        miles_since_fuel += miles
        return miles

    if starts_at_cap:
        do_restart_34h(start_lat, start_lng, place=current_location)

    # Simulate each leg sequentially.
    for leg_index, leg in enumerate(legs):
        miles_remaining = leg.distance_miles
        miles_into_leg = 0.0

        while miles_remaining > 1e-6:
            # Cycle exhausted mid-trip: take a 34-hour restart, which resets the cycle, and keep going.
            if hos_rules.cycle_limit_reached(cycle_used + CYCLE_EPSILON_HOURS):
                frac = (miles_into_leg / leg.distance_miles) if leg.distance_miles > 0 else 0.0
                lat, lng = _interpolate_point(leg.points, frac)
                do_restart_34h(lat, lng)
                continue

            # Enforce shift/day constraints by resting if needed BEFORE driving.
            shift_elapsed = (time_cursor - shift_start).total_seconds() / 3600.0
            if hos_rules.shift_window_reached(shift_elapsed) or hos_rules.driving_limit_reached(driving_today):
                # Rest at current location along the leg.
                frac = (miles_into_leg / leg.distance_miles) if leg.distance_miles > 0 else 0.0
                lat, lng = _interpolate_point(leg.points, frac)
                do_rest_10h(lat, lng)
                continue

            # Break rule.
            if hos_rules.break_required(driving_since_break):
                frac = (miles_into_leg / leg.distance_miles) if leg.distance_miles > 0 else 0.0
                lat, lng = _interpolate_point(leg.points, frac)
                do_break_30(lat, lng)
                continue

            # Fuel rule.
            if hos_rules.fuel_stop_required(miles_since_fuel):
                frac = (miles_into_leg / leg.distance_miles) if leg.distance_miles > 0 else 0.0
                lat, lng = _interpolate_point(leg.points, frac)
                do_fuel_stop(lat, lng)
                continue

            # Determine how long we can drive before hitting a rule boundary or destination.
            max_hours = available_drive_hours_before_limits()
            if max_hours <= 0:
                # If shift window is the blocking factor, rest; else break (shouldn't happen often).
                frac = (miles_into_leg / leg.distance_miles) if leg.distance_miles > 0 else 0.0
                lat, lng = _interpolate_point(leg.points, frac)
                do_rest_10h(lat, lng)
                continue

            # Cap by remaining distance in this leg.
            mph = (leg.distance_miles / leg.duration_hours) if leg.duration_hours > 0 else 0.0
            if mph <= 0:
                raise TripPlannerError("Route duration invalid; cannot compute driving pace.")

            hours_to_destination = miles_remaining / mph
            hours = min(max_hours, hours_to_destination)

            miles = drive_for(leg, hours)
            miles_into_leg += miles
            miles_remaining = max(0.0, leg.distance_miles - miles_into_leg)

        # Arrival stop handling.
        arrival_lat, arrival_lng = leg.points[-1]
        if leg_index == 0:
            # Pickup on-duty 1 hour.
            _add_stop(
                stops,
                stop_type="PICKUP",
                location=pickup_location,
                lat=arrival_lat,
                lng=arrival_lng,
                start=time_cursor,
                end=time_cursor,
            )
            do_on_duty(
                hos_rules.pickup_dropoff_on_duty_hours(),
                "On Duty (Pickup)",
                "ON_DUTY",
                arrival_lat,
                arrival_lng,
                pickup_location,
                "Pickup, loading (on duty)",
                "Leave pickup, driving",
            )
        else:
            _add_stop(
                stops,
                stop_type="DROPOFF",
                location=dropoff_location,
                lat=arrival_lat,
                lng=arrival_lng,
                start=time_cursor,
                end=time_cursor,
            )
            do_on_duty(
                hos_rules.pickup_dropoff_on_duty_hours(),
                "On Duty (Dropoff)",
                "ON_DUTY",
                arrival_lat,
                arrival_lng,
                dropoff_location,
                "Dropoff, unloading (on duty)",
                "Trip complete (off duty)",
            )

    daily_logs = _split_into_daily_logs(segments)
    _resolve_event_places(events)
    _attach_remarks(daily_logs, events)
    route = {
        "encoding": "polyline5",  # Google encoded polyline, 1e-5 degree precision, as returned by ORS
        "legs": [{"polyline": leg.route.polyline} for leg in legs],
    }
    return {"stops": stops, "daily_logs": daily_logs, "route": route}

