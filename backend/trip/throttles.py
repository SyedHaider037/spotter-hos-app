import ipaddress

from rest_framework.settings import api_settings
from rest_framework.throttling import AnonRateThrottle


class PlanRateThrottle(AnonRateThrottle):
    """Per-IP limit for the plan endpoint. The rate is the `plan` entry of DEFAULT_THROTTLE_RATES in settings."""

    scope = "plan"

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES[self.scope]  # read per request, so settings changes apply


def mask_ip(ip: str) -> str:
    """
    Hide most of an address for logs. IPv4 keeps its first three parts (203.0.113.xxx); IPv6 keeps only its first
    three groups (2407:d000:1c::xxx). Anything that is not an address is replaced, never echoed.
    """
    try:
        address = ipaddress.ip_address(ip.strip())
    except ValueError:
        return "invalid"
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if isinstance(address, ipaddress.IPv4Address):
        return ".".join(str(address).split(".")[:3]) + ".xxx"
    return ":".join(group.lstrip("0") or "0" for group in address.exploded.split(":")[:3]) + "::xxx"


def describe_client(request) -> tuple[int, str]:
    """(entries in X-Forwarded-For, the client IP the throttle uses, masked): lets the proxy count be verified."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    hops = len([part for part in forwarded.split(",") if part.strip()])
    return hops, mask_ip(PlanRateThrottle().get_ident(request) or "")


def _masked_header(value: str) -> str:
    """One header value for the log: printable characters only, shortened, last part of the address masked."""
    cleaned = "".join(ch for ch in value.strip() if ch.isprintable())[:45]
    return mask_ip(cleaned) if cleaned else "empty"


def describe_client_headers(request) -> str:
    """
    Which client-IP headers the proxy chain forwards, for the plan log: present or absent, masked addresses only.
    Only these headers are read, and the Forwarded header is reported as present/absent without its value.
    """
    meta = request.META
    parts = []
    for label, key in (
        ("CF-Connecting-IP", "HTTP_CF_CONNECTING_IP"),
        ("True-Client-IP", "HTTP_TRUE_CLIENT_IP"),
        ("X-Real-IP", "HTTP_X_REAL_IP"),
    ):
        value = meta.get(key)
        parts.append(f"{label}={_masked_header(value) if value is not None else 'absent'}")
    forwarded_for = meta.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for is None:
        parts.append("X-Forwarded-For=absent")
    else:
        entries = [_masked_header(entry) for entry in forwarded_for.split(",") if entry.strip()]
        parts.append(f"X-Forwarded-For=[{', '.join(entries)}]")
    parts.append(f"Forwarded={'present' if 'HTTP_FORWARDED' in meta else 'absent'}")
    return ", ".join(parts)
