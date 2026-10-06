"""Request-handling tests for POST /api/plan/ (routing is mocked, so nothing here touches the network)."""

from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase

from .test_trip_planner import PATCH_TARGET, REVERSE_TARGET, fake_route

BODY = '{"current_location":"A","pickup_location":"B","dropoff_location":"C","cycle_used_hours": %s}'


class MalformedBodyTests(SimpleTestCase):
    def post(self, raw):
        cache.clear()  # the plan endpoint is throttled per IP; these tests share one
        with mock.patch(PATCH_TARGET, side_effect=[fake_route(120, 2), fake_route(120, 2)]), mock.patch(
            REVERSE_TARGET, return_value="Testville, TS"
        ):
            return self.client.post("/api/plan/", raw, content_type="application/json")

    def test_nan_and_infinity_are_a_clean_400_not_a_500(self):
        for literal in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(literal=literal), self.assertNoLogs("trip.views", level="ERROR"):
                response = self.post(BODY % literal)
                self.assertEqual(response.status_code, 400)
                error = response.json()["error"]
                self.assertEqual(error["code"], "PLAN_FAILED")
                self.assertIn("not valid JSON", error["message"])

    def test_malformed_json_is_a_clean_400(self):
        for raw in ("{not json", "", "[1, 2"):
            with self.subTest(raw=raw), self.assertNoLogs("trip.views", level="ERROR"):
                response = self.post(raw)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"]["code"], "PLAN_FAILED")

    def test_a_valid_body_still_plans(self):
        response = self.post(BODY % "20")
        self.assertEqual(response.status_code, 200)
        self.assertIn("stops", response.json())

    def test_existing_validation_errors_are_unchanged(self):
        response = self.post(BODY % "-5")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["message"], "cycle_used_hours must be >= 0.")

    def test_a_non_object_body_is_still_rejected_cleanly(self):
        response = self.post("[1, 2, 3]")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["message"], "Request body must be a JSON object.")
