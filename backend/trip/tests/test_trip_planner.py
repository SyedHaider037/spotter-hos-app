"""Deterministic tests for plan_trip: fixed start_time and a mocked route service (no network)."""

from datetime import datetime, timezone
from unittest import mock

from django.test import SimpleTestCase

from trip.services.route_service import RouteResult
from trip.services.trip_planner import TripPlannerError, plan_trip

START = datetime(2026, 1, 5, 8, 0, tzinfo=timezone.utc)  # Monday 08:00 UTC
PATCH_TARGET = "trip.services.trip_planner.get_route"
REVERSE_TARGET = "trip.services.trip_planner.reverse_geocode"


def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    out = ""
    while value >= 0x20:
        out += chr((0x20 | (value & 0x1F)) + 63)
        value >>= 5
    return out + chr(value + 63)


def encode_polyline(points: list[tuple[float, float]]) -> str:
    out, prev_lat, prev_lng = "", 0, 0
    for lat, lng in points:
        lat_i, lng_i = round(lat * 1e5), round(lng * 1e5)
        out += _encode_value(lat_i - prev_lat) + _encode_value(lng_i - prev_lng)
        prev_lat, prev_lng = lat_i, lng_i
    return out


def fake_route(miles: float, hours: float, start=(41.0, -87.0), end=(35.0, -90.0)) -> RouteResult:
    return RouteResult(distance_miles=miles, duration_hours=hours, polyline=encode_polyline([start, end]))


def run_plan(legs, cycle_used_hours=0, place="Testville, TS"):
    with mock.patch(PATCH_TARGET, side_effect=list(legs)), mock.patch(REVERSE_TARGET, return_value=place):
        return plan_trip("A", "B", "C", cycle_used_hours, start_time=START)


def stops_of(result, stop_type):
    return [s for s in result["stops"] if s["type"] == stop_type]


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def segment_hours(seg) -> float:
    return (_parse(seg["end"]) - _parse(seg["start"])).total_seconds() / 3600


def all_segments(result):
    return [seg for day in result["daily_logs"] for seg in day["segments"]]


def merged_segments(result):
    """All segments with adjacent same-status pieces joined (daily logs split blocks at UTC midnight)."""
    merged = []
    for seg in all_segments(result):
        if merged and merged[-1]["status"] == seg["status"] and merged[-1]["end"] == seg["start"]:
            merged[-1] = {**merged[-1], "end": seg["end"]}
        else:
            merged.append(dict(seg))
    return merged


def merged_status_runs(result):
    """Segments with adjacent same-status pieces joined, as {status, start, end} in trip order."""
    return merged_segments(result)


def total_hours(result, status):
    return sum(segment_hours(seg) for seg in all_segments(result) if seg["status"] == status)


class ShortTripTests(SimpleTestCase):
    """2h + 2h driving plus 1h pickup and dropoff: no break, rest or fuel needed."""

    def setUp(self):
        self.result = run_plan([fake_route(120, 2), fake_route(120, 2)])

    def test_stop_sequence_has_no_breaks_rests_or_fuel(self):
        types = [s["type"] for s in self.result["stops"]]
        self.assertEqual(types, ["CURRENT", "PICKUP", "ON_DUTY", "DROPOFF", "ON_DUTY"])

    def test_uses_injected_start_time(self):
        self.assertEqual(self.result["stops"][0]["start_time"], "2026-01-05T08:00:00Z")

    def test_driving_and_on_duty_totals(self):
        self.assertAlmostEqual(total_hours(self.result, "DRIVING"), 4.0, places=6)
        self.assertAlmostEqual(total_hours(self.result, "ON_DUTY"), 2.0, places=6)

    def test_single_daily_log(self):
        self.assertEqual([d["date"] for d in self.result["daily_logs"]], ["2026-01-05"])

    def test_deterministic_for_same_inputs(self):
        again = run_plan([fake_route(120, 2), fake_route(120, 2)])
        self.assertEqual(self.result, again)


class MultiDayTripTests(SimpleTestCase):
    """10h + 10h driving forces a 30-min break, a 10-hour rest and a second day."""

    def setUp(self):
        self.result = run_plan([fake_route(600, 10), fake_route(600, 10)])

    def test_includes_breaks_and_rest_with_correct_durations(self):
        breaks = stops_of(self.result, "BREAK_30")
        rests = stops_of(self.result, "REST_10")
        self.assertGreaterEqual(len(breaks), 1)
        self.assertGreaterEqual(len(rests), 1)
        self.assertTrue(all(b["duration"] == 30 for b in breaks))
        self.assertTrue(all(r["duration"] == 600 for r in rests))

    def test_spans_multiple_daily_logs(self):
        dates = [d["date"] for d in self.result["daily_logs"]]
        self.assertGreater(len(dates), 1)
        self.assertEqual(dates, sorted(dates))

    def test_never_drives_more_than_11_hours_between_rests(self):
        driving_since_rest = 0.0
        for seg in merged_segments(self.result):
            hours = segment_hours(seg)
            if seg["status"] == "DRIVING":
                driving_since_rest += hours
                self.assertLessEqual(driving_since_rest, 11.0 + 1e-6)
            elif seg["status"] == "OFF_DUTY" and hours >= 10 - 1e-6:
                driving_since_rest = 0.0

    def test_never_drives_more_than_8_hours_without_a_break(self):
        since_break = 0.0
        for seg in merged_segments(self.result):
            if seg["status"] == "DRIVING":
                since_break += segment_hours(seg)
                self.assertLessEqual(since_break, 8.0 + 1e-6)
            elif seg["status"] == "OFF_DUTY":
                since_break = 0.0

    def test_total_driving_matches_route_durations(self):
        self.assertAlmostEqual(total_hours(self.result, "DRIVING"), 20.0, places=4)

    def test_segments_have_positive_length(self):
        for seg in all_segments(self.result):
            self.assertLess(seg["start"], seg["end"])


class CycleLimitTests(SimpleTestCase):
    def test_trip_exceeding_cycle_is_rejected(self):
        # 20h driving + 2h on duty = 22h; 55 + 22 > 70.
        with self.assertRaisesRegex(TripPlannerError, "70-hour"):
            run_plan([fake_route(600, 10), fake_route(600, 10)], cycle_used_hours=55)

    def test_cycle_already_at_limit_is_rejected(self):
        with self.assertRaisesRegex(TripPlannerError, "Cycle limit already reached"):
            run_plan([fake_route(120, 2), fake_route(120, 2)], cycle_used_hours=70)

    def test_negative_cycle_is_rejected(self):
        with self.assertRaises(TripPlannerError):
            run_plan([fake_route(120, 2), fake_route(120, 2)], cycle_used_hours=-1)

    def test_trip_fitting_exactly_in_remaining_cycle_succeeds(self):
        # 4h driving + 2h on duty = 6h; 64 + 6 = 70 is allowed.
        result = run_plan([fake_route(120, 2), fake_route(120, 2)], cycle_used_hours=64)
        self.assertEqual(len(stops_of(result, "DROPOFF")), 1)

    def test_api_returns_plan_failed_for_cycle_overflow(self):
        payload = {
            "current_location": "A",
            "pickup_location": "B",
            "dropoff_location": "C",
            "cycle_used_hours": 55,
        }
        with mock.patch(PATCH_TARGET, side_effect=[fake_route(600, 10), fake_route(600, 10)]), mock.patch(
            REVERSE_TARGET, return_value="Testville, TS"
        ):
            response = self.client.post("/api/plan/", payload, content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "PLAN_FAILED")


class PickupDropoffTests(SimpleTestCase):
    def setUp(self):
        self.result = run_plan([fake_route(120, 2), fake_route(120, 2)])

    def test_pickup_adds_one_hour_on_duty_after_first_leg(self):
        self.assertEqual(stops_of(self.result, "PICKUP")[0]["start_time"], "2026-01-05T10:00:00Z")
        on_duty = stops_of(self.result, "ON_DUTY")[0]
        self.assertEqual(on_duty["start_time"], "2026-01-05T10:00:00Z")
        self.assertEqual(on_duty["end_time"], "2026-01-05T11:00:00Z")
        self.assertEqual(on_duty["duration"], 60)

    def test_dropoff_adds_one_hour_on_duty_after_second_leg(self):
        self.assertEqual(stops_of(self.result, "DROPOFF")[0]["start_time"], "2026-01-05T13:00:00Z")
        on_duty = stops_of(self.result, "ON_DUTY")[1]
        self.assertEqual(on_duty["start_time"], "2026-01-05T13:00:00Z")
        self.assertEqual(on_duty["end_time"], "2026-01-05T14:00:00Z")
        self.assertEqual(on_duty["duration"], 60)

    def test_on_duty_segments_are_one_hour_each(self):
        segs = [s for s in all_segments(self.result) if s["status"] == "ON_DUTY"]
        self.assertEqual(len(segs), 2)
        self.assertTrue(all(abs(segment_hours(s) - 1.0) < 1e-6 for s in segs))


class RouteGeometryTests(SimpleTestCase):
    """The response exposes each leg's routing geometry so clients can draw the real road route."""

    def test_route_contains_one_polyline_per_leg_unchanged(self):
        leg1 = fake_route(120, 2, start=(41.0, -87.0), end=(35.0, -90.0))
        leg2 = fake_route(120, 2, start=(35.0, -90.0), end=(32.7, -96.8))
        result = run_plan([leg1, leg2])
        self.assertEqual(result["route"]["encoding"], "polyline5")
        self.assertEqual([leg["polyline"] for leg in result["route"]["legs"]], [leg1.polyline, leg2.polyline])

    def test_existing_response_keys_are_unchanged(self):
        result = run_plan([fake_route(120, 2), fake_route(120, 2)])
        self.assertEqual(set(result), {"stops", "daily_logs", "route"})
        self.assertEqual(set(result["daily_logs"][0]), {"date", "segments", "remarks"})

    def test_api_response_includes_route(self):
        payload = {"current_location": "A", "pickup_location": "B", "dropoff_location": "C", "cycle_used_hours": 0}
        with mock.patch(PATCH_TARGET, side_effect=[fake_route(120, 2), fake_route(120, 2)]), mock.patch(
            REVERSE_TARGET, return_value="Testville, TS"
        ):
            response = self.client.post("/api/plan/", payload, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["route"]["legs"]), 2)
        self.assertTrue(all(isinstance(leg["polyline"], str) and leg["polyline"] for leg in body["route"]["legs"]))


class RemarksTests(SimpleTestCase):
    """Each duty-status change gets a remark (place + activity), grouped under the day it happened on."""

    def setUp(self):
        self.result = run_plan([fake_route(600, 10), fake_route(600, 10)])
        self.remarks = [r for day in self.result["daily_logs"] for r in day["remarks"]]

    def test_every_status_change_has_exactly_one_remark(self):
        segs = merged_status_runs(self.result)
        changes = [segs[i]["start"] for i in range(1, len(segs)) if segs[i]["status"] != segs[i - 1]["status"]]
        # The trip start (driving begins) and trip end (on duty -> off duty) are changes on the sheet too.
        expected = [segs[0]["start"], *changes, segs[-1]["end"]]
        self.assertEqual([r["time"] for r in sorted(self.remarks, key=lambda r: r["time"])], expected)

    def test_remarks_sit_on_the_day_they_happened(self):
        for day in self.result["daily_logs"]:
            for remark in day["remarks"]:
                self.assertTrue(remark["time"].startswith(day["date"]) or remark["time"][:10] == day["date"])

    def test_remarks_are_sorted_within_each_day(self):
        for day in self.result["daily_logs"]:
            times = [r["time"] for r in day["remarks"]]
            self.assertEqual(times, sorted(times))

    def test_start_pickup_and_dropoff_use_the_locations_as_typed(self):
        by_activity = {r["activity"]: r["place"] for r in self.remarks}
        self.assertEqual(by_activity["Start trip, driving"], "A")
        self.assertEqual(by_activity["Pickup, loading (on duty)"], "B")
        self.assertEqual(by_activity["Leave pickup, driving"], "B")
        self.assertEqual(by_activity["Dropoff, unloading (on duty)"], "C")
        self.assertEqual(by_activity["Trip complete (off duty)"], "C")

    def test_rest_and_break_places_come_from_reverse_geocoding(self):
        activities = {r["activity"]: r["place"] for r in self.remarks}
        self.assertEqual(activities["10-hour rest (off duty)"], "Testville, TS")
        self.assertEqual(activities["30-minute break (off duty)"], "Testville, TS")

    def test_resume_driving_follows_each_rest_and_break(self):
        resumes = [r for r in self.remarks if r["activity"] == "Resume driving"]
        stops_needing_resume = len(stops_of(self.result, "REST_10")) + len(stops_of(self.result, "BREAK_30"))
        self.assertEqual(len(resumes), stops_needing_resume)

    def test_failed_reverse_geocode_falls_back_to_coordinates(self):
        result = run_plan([fake_route(600, 10), fake_route(600, 10)], place=None)
        rests = [r for d in result["daily_logs"] for r in d["remarks"] if r["activity"].startswith("10-hour rest")]
        self.assertTrue(rests)
        for remark in rests:
            lat, lng = (float(x) for x in remark["place"].split(","))
            self.assertTrue(30 < lat < 42 and -92 < lng < -86)

    def test_one_reverse_lookup_per_distinct_spot(self):
        with mock.patch(PATCH_TARGET, side_effect=[fake_route(600, 10), fake_route(600, 10)]), mock.patch(
            REVERSE_TARGET, return_value="Testville, TS"
        ) as reverse:
            plan_trip("A", "B", "C", 0, start_time=START)
        spots = [(round(c.args[0], 2), round(c.args[1], 2)) for c in reverse.call_args_list]
        self.assertEqual(len(spots), len(set(spots)))
