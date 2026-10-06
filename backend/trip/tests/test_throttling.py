"""Per-IP throttling of POST /api/plan/ (routing is mocked, so nothing here touches the network)."""

from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from .test_trip_planner import PATCH_TARGET, REVERSE_TARGET, fake_route

BODY = {"current_location": "A", "pickup_location": "B", "dropoff_location": "C", "cycle_used_hours": 20}


def rest_framework(rate, proxies=1):
    from django.conf import settings

    return {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {"plan": rate}, "NUM_PROXIES": proxies}


@override_settings(REST_FRAMEWORK=rest_framework("3/hour"))
class PlanThrottleTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def post(self, ip="203.0.113.7", forwarded=True):
        extra = {"HTTP_X_FORWARDED_FOR": ip} if forwarded else {"REMOTE_ADDR": ip}
        with mock.patch(PATCH_TARGET, side_effect=[fake_route(120, 2), fake_route(120, 2)]), mock.patch(
            REVERSE_TARGET, return_value="Testville, TS"
        ):
            return self.client.post("/api/plan/", BODY, content_type="application/json", **extra)

    def test_requests_under_the_limit_pass(self):
        for _ in range(3):
            self.assertEqual(self.post().status_code, 200)

    def test_the_next_request_gets_429_in_the_error_shape_with_retry_after(self):
        for _ in range(3):
            self.post()
        response = self.post()
        self.assertEqual(response.status_code, 429)
        error = response.json()["error"]
        self.assertEqual(error["code"], "RATE_LIMITED")
        self.assertIn("Try again in", error["message"])
        self.assertGreater(int(response["Retry-After"]), 0)

    def test_a_different_ip_is_not_affected(self):
        for _ in range(4):
            self.post(ip="203.0.113.7")
        self.assertEqual(self.post(ip="198.51.100.9").status_code, 200)

    def test_the_client_is_the_last_forwarded_address_not_the_proxy(self):
        # One proxy appends the address it saw; a client-supplied prefix cannot dodge or share the limit.
        for _ in range(4):
            self.post(ip="1.1.1.1, 203.0.113.7")
        self.assertEqual(self.post(ip="2.2.2.2, 198.51.100.9").status_code, 200)
        self.assertEqual(self.post(ip="9.9.9.9, 203.0.113.7").status_code, 429)

    @override_settings(REST_FRAMEWORK=rest_framework("3/hour", proxies=0))
    def test_with_no_proxies_the_socket_address_is_used(self):
        for _ in range(4):
            self.post(ip="203.0.113.7", forwarded=False)
        self.assertEqual(self.post(ip="198.51.100.9", forwarded=False).status_code, 200)

    def test_other_errors_keep_their_shape(self):
        response = self.client.post("/api/plan/", "{bad", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "PLAN_FAILED")


class ProxyLoggingTests(SimpleTestCase):
    """The plan endpoint logs the proxy hop count and the masked client IP, so the proxy setting can be verified."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def logged(self, **extra):
        with self.assertLogs("trip.views", level="INFO") as logs, mock.patch(
            PATCH_TARGET, side_effect=[fake_route(120, 2), fake_route(120, 2)]
        ), mock.patch(REVERSE_TARGET, return_value="Testville, TS"):
            self.client.post("/api/plan/", BODY, content_type="application/json", **extra)
        return " | ".join(logs.output)

    def test_logs_hop_count_and_masked_client_ip(self):
        output = self.logged(HTTP_X_FORWARDED_FOR="9.9.9.9, 203.0.113.7")
        self.assertIn("X-Forwarded-For entries=2", output)
        self.assertIn("throttle client=203.0.113.xxx", output)

    def test_never_logs_the_full_header_or_address(self):
        output = self.logged(HTTP_X_FORWARDED_FOR="9.9.9.9, 203.0.113.7")
        self.assertNotIn("203.0.113.7", output)
        self.assertNotIn("9.9.9.9", output)

    def test_without_the_header_it_logs_zero_entries_and_the_socket_address(self):
        output = self.logged()
        self.assertIn("X-Forwarded-For entries=0", output)
        self.assertIn("throttle client=127.0.0.xxx", output)
