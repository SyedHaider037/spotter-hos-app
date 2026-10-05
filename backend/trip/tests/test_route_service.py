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


class EndpointTests(SimpleTestCase):
    """The deprecated api.openrouteservice.org host has a reduced quota and is being shut down."""

    def test_all_endpoints_use_the_heigit_host(self):
        for url in (route_service.GEOCODE_URL, route_service.REVERSE_GEOCODE_URL, route_service.DIRECTIONS_URL):
            self.assertTrue(url.startswith("https://api.heigit.org/"), url)
            self.assertNotIn("openrouteservice.org", url)

    def test_endpoint_paths(self):
        self.assertEqual(route_service.GEOCODE_URL, "https://api.heigit.org/pelias/v1/search")
        self.assertEqual(route_service.REVERSE_GEOCODE_URL, "https://api.heigit.org/pelias/v1/reverse")
        self.assertEqual(
            route_service.DIRECTIONS_URL, "https://api.heigit.org/openrouteservice/v2/directions/driving-car"
        )

    def test_requests_go_to_the_new_urls_with_the_same_auth_header(self):
        geo_resp = mock.Mock()
        geo_resp.raise_for_status.return_value = None
        geo_resp.json.return_value = {"features": [{"geometry": {"coordinates": [-87.63, 41.88]}}]}
        with mock.patch.object(route_service, "_ors_api_key", return_value="secret"), mock.patch.object(
            route_service.requests, "get", return_value=geo_resp
        ) as get:
            route_service.geocode("Chicago, IL")
        self.assertEqual(get.call_args.args[0], "https://api.heigit.org/pelias/v1/search")
        self.assertEqual(get.call_args.kwargs["headers"], {"Authorization": "secret"})


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
        ), mock.patch.object(route_service.requests, "post", return_value=_directions_response()), mock.patch(
            "trip.services.trip_planner.reverse_geocode", return_value="Testville, TS"
        ):
            result = plan_trip("Chicago", "Dallas", "New York", 0, start_time=start)
        self.assertEqual([c.args[0] for c in geo.call_args_list], ["Chicago", "Dallas", "New York"])
        self.assertEqual(len(result["stops"]), 5)


class ReverseGeocodeTests(SimpleTestCase):
    def _response(self, props):
        resp = mock.Mock()
        resp.raise_for_status.return_value = None
        resp.json.return_value = {"features": [{"properties": props}] if props is not None else []}
        return resp

    def _call(self, response=None, side_effect=None):
        with mock.patch.object(route_service, "_ors_api_key", return_value="k"), mock.patch.object(
            route_service.requests, "get", return_value=response, side_effect=side_effect
        ) as get:
            return route_service.reverse_geocode(34.14, -93.08), get

    def test_returns_city_and_state(self):
        result, get = self._call(self._response({"locality": "Arkadelphia", "region_a": "AR"}))
        self.assertEqual(result, "Arkadelphia, AR")
        params = get.call_args.kwargs["params"]
        self.assertEqual((params["point.lat"], params["point.lon"]), (34.14, -93.08))

    def test_falls_back_to_county_when_no_city_nearby(self):
        result, _ = self._call(self._response({"county": "Crittenden County", "region_a": "AR"}))
        self.assertEqual(result, "Crittenden County, AR")

    def test_returns_none_when_nothing_found(self):
        result, _ = self._call(self._response(None))
        self.assertIsNone(result)

    def test_never_raises_on_network_error(self):
        result, _ = self._call(side_effect=route_service.requests.ConnectionError("down"))
        self.assertIsNone(result)

    def test_returns_none_on_invalid_json(self):
        resp = mock.Mock()
        resp.raise_for_status.return_value = None
        resp.json.side_effect = ValueError("bad json")
        result, _ = self._call(resp)
        self.assertIsNone(result)

    def test_returns_none_when_api_key_missing(self):
        with mock.patch.object(
            route_service, "_ors_api_key", side_effect=route_service.RouteServiceError("Missing")
        ), mock.patch.object(route_service.requests, "get") as get:
            self.assertIsNone(route_service.reverse_geocode(1.0, 2.0))
        get.assert_not_called()
