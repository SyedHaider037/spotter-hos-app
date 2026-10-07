"""Per-IP throttling of POST /api/plan/ (routing is mocked, so nothing here touches the network)."""

from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from trip.throttles import mask_ip
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


class PlanLogCapture(SimpleTestCase):
    """Shared helper: post one plan request and return everything the trip.views logger wrote at INFO."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def logged(self, **extra):
        with self.assertLogs("trip.views", level="INFO") as logs, mock.patch(
            PATCH_TARGET, side_effect=[fake_route(120, 2), fake_route(120, 2)]
        ), mock.patch(REVERSE_TARGET, return_value="Testville, TS"):
            self.client.post("/api/plan/", BODY, content_type="application/json", **extra)
        return " | ".join(logs.output)


class ProxyLoggingTests(PlanLogCapture):
    """The plan endpoint logs the proxy hop count and the masked client IP, so the proxy setting can be verified."""

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


class ClientIpHeaderLoggingTests(PlanLogCapture):
    """The plan log also reports which client-IP headers arrive (masked), and nothing else from the request."""

    HEADERS = {
        "HTTP_CF_CONNECTING_IP": "198.51.100.23",
        "HTTP_TRUE_CLIENT_IP": "198.51.100.24",
        "HTTP_X_REAL_IP": "172.69.242.9",
        "HTTP_X_FORWARDED_FOR": "198.51.100.23, 172.69.242.9",
        "HTTP_FORWARDED": "for=198.51.100.23",
    }

    def test_reports_each_header_masked(self):
        output = self.logged(**self.HEADERS)
        self.assertIn("CF-Connecting-IP=198.51.100.xxx", output)
        self.assertIn("True-Client-IP=198.51.100.xxx", output)
        self.assertIn("X-Real-IP=172.69.242.xxx", output)
        self.assertIn("X-Forwarded-For=[198.51.100.xxx, 172.69.242.xxx]", output)
        self.assertIn("Forwarded=present", output)

    def test_never_logs_a_full_address_or_the_forwarded_value(self):
        output = self.logged(**self.HEADERS)
        for full in ("198.51.100.23", "198.51.100.24", "172.69.242.9", "for=198.51.100"):
            self.assertNotIn(full, output)

    def test_missing_headers_are_reported_as_absent(self):
        output = self.logged()
        for label in ("CF-Connecting-IP", "True-Client-IP", "X-Real-IP", "X-Forwarded-For"):
            self.assertIn(f"{label}=absent", output)
        self.assertIn("Forwarded=absent", output)

    def test_no_other_header_is_logged(self):
        output = self.logged(HTTP_AUTHORIZATION="secret-token", HTTP_USER_AGENT="agent-string", HTTP_COOKIE="a=b")
        for leaked in ("secret-token", "agent-string", "a=b"):
            self.assertNotIn(leaked, output)

    def test_junk_values_cannot_inject_log_lines(self):
        output = self.logged(HTTP_X_REAL_IP="1.2.3.4\nINFO fake line")
        self.assertNotIn("\nINFO fake line", output)


class MaskIpTests(SimpleTestCase):
    def test_ipv4_keeps_the_first_three_parts(self):
        self.assertEqual(mask_ip("203.0.113.7"), "203.0.113.xxx")

    def test_ipv6_keeps_only_the_first_three_groups(self):
        self.assertEqual(mask_ip("2407:d000:1c:26cf:10ba:1903:53db:1234"), "2407:d000:1c::xxx")

    def test_ipv6_in_shortened_form_is_masked_the_same_way(self):
        self.assertEqual(mask_ip("2001:db8::1"), "2001:db8:0::xxx")
        self.assertEqual(mask_ip("2606:4700:4700::1111"), "2606:4700:4700::xxx")

    def test_the_hidden_part_of_an_ipv6_address_never_appears(self):
        masked = mask_ip("2407:d000:1c:26cf:10ba:1903:53db:1234")
        for hidden in ("26cf", "10ba", "1903", "53db", "1234"):
            self.assertNotIn(hidden, masked)

    def test_ipv4_mapped_ipv6_is_masked_as_ipv4(self):
        self.assertEqual(mask_ip("::ffff:203.0.113.7"), "203.0.113.xxx")

    def test_anything_that_is_not_an_address_is_not_echoed(self):
        for junk in ("", "garbage", "1.2.3.4\nINFO fake line", "<script>"):
            self.assertEqual(mask_ip(junk), "invalid")
