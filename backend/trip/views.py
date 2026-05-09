from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .services.trip_planner import TripPlannerError, plan_trip


def _get_required_str(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise TripPlannerError(f"'{key}' is required and must be a non-empty string.")
    return value.strip()


def _get_required_number(data: dict[str, Any], key: str) -> float:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TripPlannerError(f"'{key}' is required and must be a number.")
    return float(value)


@api_view(["POST"])
def plan(request: Request) -> Response:
    """
    POST /api/plan/

    Input JSON:
      {
        "current_location": "Chicago, IL",
        "pickup_location": "Dallas, TX",
        "dropoff_location": "New York, NY",
        "cycle_used_hours": 40
      }

    Output JSON:
      { "stops": [...], "daily_logs": [...] }
    """
    try:
        if not isinstance(request.data, dict):
            raise TripPlannerError("Request body must be a JSON object.")

        current_location = _get_required_str(request.data, "current_location")
        pickup_location = _get_required_str(request.data, "pickup_location")
        dropoff_location = _get_required_str(request.data, "dropoff_location")
        cycle_used_hours = _get_required_number(request.data, "cycle_used_hours")

        result = plan_trip(
            current_location=current_location,
            pickup_location=pickup_location,
            dropoff_location=dropoff_location,
            cycle_used_hours=cycle_used_hours,
        )
        return Response(result, status=status.HTTP_200_OK)

    except TripPlannerError as exc:
        return Response(
            {"error": {"code": "PLAN_FAILED", "message": str(exc)}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception:
        return Response(
            {"error": {"code": "INTERNAL_ERROR", "message": "Unexpected server error."}},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
