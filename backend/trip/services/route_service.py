"""
OpenRouteService (ORS) routing wrapper.

Approach:
1) Geocode a location string to coordinates via ORS geocoding.
2) Request directions using coordinates via ORS directions.

This module does ONE thing:
- Input: origin and destination location strings
- Output: (distance_miles, duration_hours, polyline)
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import requests


METERS_PER_MILE = 1609.344
SECONDS_PER_HOUR = 3600.0

GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"
DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car"


class RouteServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class RouteResult:
    distance_miles: float
    duration_hours: float
    polyline: str


def _ors_api_key() -> str:
    api_key = os.getenv("ORS_API_KEY")
    if not api_key:
        raise RouteServiceError("Missing ORS_API_KEY environment variable.")
    return api_key


def geocode(location_string: str, *, timeout_seconds: float = 15.0) -> tuple[float, float]:
    """
    Step 1: Geocode location string to coordinates.

    Returns: (lng, lat)
    """
    headers = {"Authorization": _ors_api_key()}
    params = {"text": location_string, "size": 1}

    try:
        resp = requests.get(GEOCODE_URL, headers=headers, params=params, timeout=timeout_seconds)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        raise RouteServiceError(f"ORS geocoding request failed: {exc}") from exc
    except ValueError as exc:
        raise RouteServiceError("ORS geocoding returned invalid JSON.") from exc

    features = data.get("features") or []
    if not features:
        raise RouteServiceError(f"ORS geocoding found no results for: {location_string!r}")

    coordinates = (features[0].get("geometry") or {}).get("coordinates")
    if not (isinstance(coordinates, list) and len(coordinates) == 2):
        raise RouteServiceError("ORS geocoding response missing coordinates.")

    lng, lat = float(coordinates[0]), float(coordinates[1])
    return lng, lat


def get_route(origin: str, destination: str, *, timeout_seconds: float = 30.0) -> RouteResult:
    """
    Step 2: Get directions using coordinates.
    """
    lng1, lat1 = geocode(origin, timeout_seconds=timeout_seconds)
    lng2, lat2 = geocode(destination, timeout_seconds=timeout_seconds)

    headers = {"Authorization": _ors_api_key(), "Content-Type": "application/json"}
    body = {
        "coordinates": [[lng1, lat1], [lng2, lat2]],
        # Keep geometry as an encoded polyline string for downstream consumers.
    }

    try:
        resp = requests.post(DIRECTIONS_URL, headers=headers, json=body, timeout=timeout_seconds)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        raise RouteServiceError(f"ORS directions request failed: {exc}") from exc
    except ValueError as exc:
        raise RouteServiceError("ORS directions returned invalid JSON.") from exc

    routes = data.get("routes") or []
    if not routes:
        raise RouteServiceError("ORS directions response missing routes.")

    summary = (routes[0].get("summary") or {})
    try:
        distance_meters = float(summary["distance"])
        duration_seconds = float(summary["duration"])
    except Exception as exc:
        raise RouteServiceError("ORS directions response missing distance/duration summary.") from exc

    polyline = routes[0].get("geometry")
    if not isinstance(polyline, str) or not polyline:
        raise RouteServiceError("ORS directions response missing geometry polyline.")

    return RouteResult(
        distance_miles=distance_meters / METERS_PER_MILE,
        duration_hours=duration_seconds / SECONDS_PER_HOUR,
        polyline=polyline,
    )

