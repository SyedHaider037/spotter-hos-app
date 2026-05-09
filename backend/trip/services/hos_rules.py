"""
HOS (Hours of Service) rules: constants and simple checkers only.

This module is intentionally limited to:
- Rule constants
- Small, pure predicate helpers that answer yes/no questions
"""

from __future__ import annotations

from typing import Final

# --- Rule constants (per PRD) ---

MAX_DRIVING_HOURS: Final[int] = 11
MAX_SHIFT_HOURS: Final[int] = 14
MIN_REST_HOURS: Final[int] = 10
BREAK_AFTER_HOURS: Final[int] = 8
BREAK_DURATION_MINUTES: Final[int] = 30
MAX_CYCLE_HOURS: Final[int] = 70
FUEL_INTERVAL_MILES: Final[int] = 1000
PICKUP_DROPOFF_HOURS: Final[int] = 1


# --- Simple checker functions (no simulation logic) ---

def driving_limit_reached(driving_hours_today: float) -> bool:
    """True if the 11-hour driving limit has been reached/exceeded."""
    return driving_hours_today >= MAX_DRIVING_HOURS


def shift_window_exceeded(shift_hours_elapsed: float) -> bool:
    """True if the 14-hour shift window has been exceeded."""
    return shift_hours_elapsed > MAX_SHIFT_HOURS


def shift_window_reached(shift_hours_elapsed: float) -> bool:
    """True if the 14-hour shift window has been reached/exceeded."""
    return shift_hours_elapsed >= MAX_SHIFT_HOURS


def rest_requirement_met(rest_hours: float) -> bool:
    """True if the minimum rest requirement has been met."""
    return rest_hours >= MIN_REST_HOURS


def break_required(cumulative_driving_hours_since_break: float) -> bool:
    """True if a 30-minute break is required (after 8 cumulative driving hours)."""
    return cumulative_driving_hours_since_break >= BREAK_AFTER_HOURS


def cycle_limit_reached(cycle_hours_used: float) -> bool:
    """True if the 70-hour / 8-day cycle limit has been reached/exceeded."""
    return cycle_hours_used >= MAX_CYCLE_HOURS


def fuel_stop_required(miles_since_last_fuel: float) -> bool:
    """True if a fuel stop is required (every 1000 miles)."""
    return miles_since_last_fuel >= FUEL_INTERVAL_MILES


def pickup_dropoff_on_duty_hours() -> int:
    """Return the fixed on-duty hours for pickup or dropoff."""
    return PICKUP_DROPOFF_HOURS

