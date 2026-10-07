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


class ClientSourceLoggingTests(PlanLogCapture):
    """The log names where the counted address came from, and never dumps header values."""

    def test_names_cf_connecting_ip_when_it_is_used(self):
        output = self.logged(HTTP_X_FORWARDED_FOR="172.69.242.10", HTTP_CF_CONNECTING_IP="2407:d000:1c:26cf::1234")
        self.assertIn("throttle client=2407:d000:1c::xxx", output)
        self.assertIn("source=cf-connecting-ip", output)
        self.assertIn("X-Forwarded-For entries=1", output)

    def test_names_x_forwarded_for_when_the_hop_is_used(self):
        output = self.logged(HTTP_X_FORWARDED_FOR="9.9.9.9, 203.0.113.7", HTTP_CF_CONNECTING_IP="198.51.100.5")
        self.assertIn("throttle client=203.0.113.xxx", output)
        self.assertIn("source=x-forwarded-for", output)  # the header is ignored: the hop is not Cloudflare

    def test_names_remote_addr_without_any_forwarding_header(self):
        output = self.logged()
        self.assertIn("source=remote-addr", output)

    def test_no_header_dump_and_no_full_address(self):
        output = self.logged(
            HTTP_X_FORWARDED_FOR="9.9.9.9, 172.69.242.10",
            HTTP_CF_CONNECTING_IP="198.51.100.23",
            HTTP_X_REAL_IP="172.69.242.10",
            HTTP_TRUE_CLIENT_IP="198.51.100.24",
            HTTP_FORWARDED="for=198.51.100.23",
        )
        for leaked in ("198.51.100.23", "198.51.100.24", "172.69.242.10", "9.9.9.9", "True-Client-IP", "X-Real-IP", "Forwarded="):
            self.assertNotIn(leaked, output)

    def test_junk_in_the_forwarded_header_cannot_inject_log_lines(self):
        output = self.logged(HTTP_X_FORWARDED_FOR="1.2.3.4\nINFO fake line")
        self.assertNotIn("\nINFO fake line", output)
        self.assertNotIn("fake line", output)


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


@override_settings(REST_FRAMEWORK=rest_framework("3/hour"))
class CloudflareClientAddressTests(SimpleTestCase):
    """Behind Cloudflare the proxy hop is a shared edge address; the visitor is read from CF-Connecting-IP."""

    EDGE = "172.69.242.10"  # inside 172.64.0.0/13
    EDGE_V6 = "2606:4700:1::5"  # inside 2606:4700::/32

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def post(self, hop, cf=None):
        extra = {"HTTP_X_FORWARDED_FOR": hop}
        if cf is not None:
            extra["HTTP_CF_CONNECTING_IP"] = cf
        with mock.patch(PATCH_TARGET, side_effect=[fake_route(120, 2), fake_route(120, 2)]), mock.patch(
            REVERSE_TARGET, return_value="Testville, TS"
        ):
            return self.client.post("/api/plan/", BODY, content_type="application/json", **extra)

    def use_up(self, hop, cf):
        for _ in range(3):
            self.assertEqual(self.post(hop, cf).status_code, 200)

    def test_the_visitor_address_is_used_when_the_hop_is_cloudflare(self):
        self.use_up(self.EDGE, "198.51.100.5")
        self.assertEqual(self.post(self.EDGE, "198.51.100.5").status_code, 429)

    def test_two_visitors_behind_the_same_edge_address_have_separate_limits(self):
        self.use_up(self.EDGE, "198.51.100.5")
        self.assertEqual(self.post(self.EDGE, "198.51.100.5").status_code, 429)
        self.assertEqual(self.post(self.EDGE, "198.51.100.6").status_code, 200)

    def test_the_header_is_ignored_when_the_hop_is_not_cloudflare(self):
        # A forged CF-Connecting-IP must not let a caller escape the limit by changing it on every request.
        self.use_up("203.0.113.7", "198.51.100.1")
        self.assertEqual(self.post("203.0.113.7", "198.51.100.2").status_code, 429)
        self.assertEqual(self.post("203.0.113.7", "198.51.100.3").status_code, 429)

    def test_ipv6_visitors_work_behind_an_ipv4_edge_address(self):
        self.use_up(self.EDGE, "2407:d000:1c:26cf:10ba:1903:53db:1234")
        self.assertEqual(self.post(self.EDGE, "2407:d000:1c:26cf:10ba:1903:53db:1234").status_code, 429)
        self.assertEqual(self.post(self.EDGE, "2407:d000:1c:26cf:10ba:1903:53db:9999").status_code, 200)

    def test_an_ipv6_edge_address_is_recognised_as_cloudflare(self):
        self.use_up(self.EDGE_V6, "198.51.100.5")
        self.assertEqual(self.post(self.EDGE_V6, "198.51.100.5").status_code, 429)
        self.assertEqual(self.post(self.EDGE_V6, "198.51.100.6").status_code, 200)

    def test_an_invalid_or_multi_valued_header_falls_back_to_the_hop(self):
        for bad in ("garbage", "198.51.100.5, 198.51.100.6", "999.1.1.1", ""):
            cache.clear()
            with self.subTest(header=bad):
                self.use_up(self.EDGE, bad)
                self.assertEqual(self.post(self.EDGE, bad + " ").status_code, 429)  # still counted on the edge address

    def test_a_missing_header_falls_back_to_the_hop(self):
        self.use_up(self.EDGE, None)
        self.assertEqual(self.post(self.EDGE).status_code, 429)

    def test_the_429_body_and_retry_after_are_unchanged(self):
        self.use_up(self.EDGE, "198.51.100.5")
        response = self.post(self.EDGE, "198.51.100.5")
        self.assertEqual(response.status_code, 429)
        error = response.json()["error"]
        self.assertEqual(error["code"], "RATE_LIMITED")
        self.assertIn("Try again in", error["message"])
        self.assertGreater(int(response["Retry-After"]), 0)

    def test_the_ranges_in_settings_include_the_observed_edge_address(self):
        from django.conf import settings
        import ipaddress

        networks = [ipaddress.ip_network(r) for r in settings.CLOUDFLARE_IP_RANGES]
        self.assertEqual(len(networks), 22)
        self.assertTrue(any(ipaddress.ip_address("172.69.242.1") in n for n in networks))
        self.assertFalse(any(ipaddress.ip_address("203.0.113.7") in n for n in networks))


@override_settings(REST_FRAMEWORK=rest_framework("1/hour"))
class RetryAfterExposedTests(SimpleTestCase):
    """The frontend runs on another origin, so the browser only sees Retry-After if CORS exposes it."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_a_429_exposes_retry_after_to_the_browser(self):
        extra = {"HTTP_ORIGIN": "http://localhost:3000", "REMOTE_ADDR": "203.0.113.7"}
        with mock.patch(PATCH_TARGET, side_effect=[fake_route(120, 2), fake_route(120, 2)] * 2), mock.patch(
            REVERSE_TARGET, return_value="Testville, TS"
        ):
            self.client.post("/api/plan/", BODY, content_type="application/json", **extra)
            response = self.client.post("/api/plan/", BODY, content_type="application/json", **extra)
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
        exposed = [h.strip() for h in response["Access-Control-Expose-Headers"].split(",")]
        self.assertIn("Retry-After", exposed)
