"""Tests for route_service geocode reuse (no network: geocode and requests.post are mocked)."""

from datetime import datetime, timezone
from unittest import mock

from django.test import SimpleTestCase

from trip.services import route_service
from trip.services.trip_planner import plan_trip

from .test_trip_planner import encode_polyline


def _directions_response():
    resp = mock.Mock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = {
        "routes": [
            {
                "summary": {"distance": 160934.4, "duration": 7200},  # 100 miles, 2 hours
                "geometry": encode_polyline([(41.0, -87.0), (35.0, -90.0)]),
            }
        ]
    }
    return resp


class GeocodeReuseTests(SimpleTestCase):
    def test_shared_cache_geocodes_each_location_once(self):
        cache = {}
        with mock.patch.object(route_service, "geocode", return_value=(-87.0, 41.0)) as geo, mock.patch.object(
            route_service, "_ors_api_key", return_value="k"
        ), mock.patch.object(route_service.requests, "post", return_value=_directions_response()):
            route_service.get_route("A", "B", geocode_cache=cache)
            route_service.get_route("B", "C", geocode_cache=cache)
        self.assertEqual([c.args[0] for c in geo.call_args_list], ["A", "B", "C"])

    def test_without_cache_behaviour_is_unchanged(self):
        with mock.patch.object(route_service, "geocode", return_value=(-87.0, 41.0)) as geo, mock.patch.object(
            route_service, "_ors_api_key", return_value="k"
        ), mock.patch.object(route_service.requests, "post", return_value=_directions_response()):
            route_service.get_route("A", "B")
            route_service.get_route("B", "C")
        self.assertEqual(geo.call_count, 4)

    def test_plan_trip_geocodes_pickup_only_once(self):
        start = datetime(2026, 1, 5, 8, 0, tzinfo=timezone.utc)
        with mock.patch.object(route_service, "geocode", return_value=(-87.0, 41.0)) as geo, mock.patch.object(
            route_service, "_ors_api_key", return_value="k"
        ), mock.patch.object(route_service.requests, "post", return_value=_directions_response()):
            result = plan_trip("Chicago", "Dallas", "New York", 0, start_time=start)
        self.assertEqual([c.args[0] for c in geo.call_args_list], ["Chicago", "Dallas", "New York"])
        self.assertEqual(len(result["stops"]), 5)
