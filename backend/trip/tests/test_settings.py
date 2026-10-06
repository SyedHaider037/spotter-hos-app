"""The TRUCK_AVG_MPH setting: valid values pass, anything else falls back to 55 with a warning."""

from django.conf import settings
from django.test import SimpleTestCase

from backend.settings import DEFAULT_TRUCK_AVG_MPH, _truck_avg_mph


class TruckAvgMphTests(SimpleTestCase):
    def test_default_is_55(self):
        self.assertEqual(DEFAULT_TRUCK_AVG_MPH, 55.0)
        self.assertEqual(_truck_avg_mph(None), 55.0)
        self.assertEqual(_truck_avg_mph(""), 55.0)

    def test_valid_values_are_used_including_the_limits(self):
        for raw, expected in (("55", 55.0), ("62.5", 62.5), ("30", 30.0), ("75", 75.0), (" 60 ", 60.0)):
            with self.subTest(raw=raw):
                self.assertEqual(_truck_avg_mph(raw), expected)

    def test_invalid_values_fall_back_to_55_and_warn(self):
        for raw in ("fast", "29.9", "75.1", "0", "-55", "nan", "inf"):
            with self.subTest(raw=raw), self.assertLogs("backend.settings", level="WARNING") as logs:
                self.assertEqual(_truck_avg_mph(raw), 55.0)
                self.assertIn("TRUCK_AVG_MPH", logs.output[0])

    def test_the_loaded_setting_is_a_valid_speed(self):
        self.assertTrue(30 <= settings.TRUCK_AVG_MPH <= 75)
