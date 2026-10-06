from rest_framework.settings import api_settings
from rest_framework.throttling import AnonRateThrottle


class PlanRateThrottle(AnonRateThrottle):
    """Per-IP limit for the plan endpoint. The rate is the `plan` entry of DEFAULT_THROTTLE_RATES in settings."""

    scope = "plan"

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES[self.scope]  # read per request, so settings changes apply


def mask_ip(ip: str) -> str:
    """Hide the last part of an address for logs: 203.0.113.7 -> 203.0.113.xxx, 2001:db8::1 -> 2001:db8::xxx."""
    for sep in (".", ":"):
        if sep in ip:
            return ip.rsplit(sep, 1)[0] + sep + "xxx"
    return "xxx"


def describe_client(request) -> tuple[int, str]:
    """(entries in X-Forwarded-For, the client IP the throttle uses, masked): lets the proxy count be verified."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    hops = len([part for part in forwarded.split(",") if part.strip()])
    return hops, mask_ip(PlanRateThrottle().get_ident(request) or "")
