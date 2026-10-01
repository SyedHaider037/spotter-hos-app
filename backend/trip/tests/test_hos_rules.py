"""Boundary tests for the HOS rule constants and predicates (pure functions, no I/O)."""

from django.test import SimpleTestCase

from trip.services import hos_rules as hos


class RuleConstantsTests(SimpleTestCase):
    def test_constants_match_prd(self):
        self.assertEqual(hos.MAX_DRIVING_HOURS, 11)
        self.assertEqual(hos.MAX_SHIFT_HOURS, 14)
        self.assertEqual(hos.MIN_REST_HOURS, 10)
        self.assertEqual(hos.BREAK_AFTER_HOURS, 8)
        self.assertEqual(hos.BREAK_DURATION_MINUTES, 30)
        self.assertEqual(hos.MAX_CYCLE_HOURS, 70)
        self.assertEqual(hos.FUEL_INTERVAL_MILES, 1000)
        self.assertEqual(hos.PICKUP_DROPOFF_HOURS, 1)


class BreakTests(SimpleTestCase):
    def test_no_break_just_under_8_hours(self):
        self.assertFalse(hos.break_required(7.99))

    def test_break_required_at_exactly_8_hours(self):
        self.assertTrue(hos.break_required(8.0))

    def test_break_required_over_8_hours(self):
        self.assertTrue(hos.break_required(8.5))

    def test_no_break_at_zero(self):
        self.assertFalse(hos.break_required(0))


class DrivingLimitTests(SimpleTestCase):
    def test_under_limit(self):
        self.assertFalse(hos.driving_limit_reached(10.99))

    def test_at_limit(self):
        self.assertTrue(hos.driving_limit_reached(11.0))

    def test_over_limit(self):
        self.assertTrue(hos.driving_limit_reached(11.5))


class ShiftWindowTests(SimpleTestCase):
    def test_reached_is_inclusive_at_14_hours(self):
        self.assertFalse(hos.shift_window_reached(13.99))
        self.assertTrue(hos.shift_window_reached(14.0))
        self.assertTrue(hos.shift_window_reached(14.5))



class FuelTests(SimpleTestCase):
    def test_no_fuel_stop_under_1000_miles(self):
        self.assertFalse(hos.fuel_stop_required(999.9))

    def test_fuel_stop_at_1000_miles(self):
        self.assertTrue(hos.fuel_stop_required(1000))
        self.assertTrue(hos.fuel_stop_required(1200))


class CycleTests(SimpleTestCase):
    """The cycle limit is a simple flat 70-hour budget (no rolling 8-day window or 34-hour restart)."""

    def test_under_limit(self):
        self.assertFalse(hos.cycle_limit_reached(69.99))

    def test_at_and_over_limit(self):
        self.assertTrue(hos.cycle_limit_reached(70))
        self.assertTrue(hos.cycle_limit_reached(75))


class PickupDropoffTests(SimpleTestCase):
    def test_fixed_one_hour(self):
        self.assertEqual(hos.pickup_dropoff_on_duty_hours(), 1)
