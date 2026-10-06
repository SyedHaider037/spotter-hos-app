"""API-wide error handling: DRF errors that are not raised by the plan view itself, in our error shape."""

from __future__ import annotations

from rest_framework.exceptions import Throttled
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)  # also sets the Retry-After header for Throttled
    if response is not None and isinstance(exc, Throttled):
        wait = int(exc.wait) + 1 if exc.wait else None
        when = f" Try again in {wait} seconds." if wait else ""
        response.data = {"error": {"code": "RATE_LIMITED", "message": f"Too many trip plans from this address.{when}"}}
    return response
