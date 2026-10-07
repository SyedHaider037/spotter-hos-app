import ipaddress

from functools import lru_cache

from django.conf import settings
from rest_framework.settings import api_settings
from rest_framework.throttling import AnonRateThrottle, BaseThrottle


@lru_cache(maxsize=8)
def _networks(ranges: tuple[str, ...]):
    return tuple(ipaddress.ip_network(r) for r in ranges)


def _single_ip(value):
    """The address in a header value, or None if it is missing, invalid or holds several values."""
    value = (value or "").strip()
    if not value or "," in value:
        return None
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def _is_cloudflare(address) -> bool:
    networks = _networks(tuple(settings.CLOUDFLARE_IP_RANGES))
    return any(address in network for network in networks if network.version == address.version)


def client_address(request) -> tuple[str, str]:
    """
    (address the throttle counts, name of where it came from).

    Normally the trusted proxy hop (see THROTTLE_NUM_PROXIES). When that hop is one of Cloudflare's edge addresses it
    is shared by many visitors, so the visitor's own address from CF-Connecting-IP is used instead. The header is
    only trusted when the hop really is Cloudflare, because anyone else could forge it; an invalid or multi-valued
    header is ignored.
    """
    hop = BaseThrottle().get_ident(request)  # DRF's own rule: THROTTLE_NUM_PROXIES, else the socket address
    hop_ip = _single_ip(hop)
    if hop_ip is not None and _is_cloudflare(hop_ip):
        visitor = _single_ip(request.META.get("HTTP_CF_CONNECTING_IP"))
        if visitor is not None:
            return str(visitor), "cf-connecting-ip"
    forwarded = bool(api_settings.NUM_PROXIES != 0 and request.META.get("HTTP_X_FORWARDED_FOR"))
    return hop, "x-forwarded-for" if forwarded else "remote-addr"


class PlanRateThrottle(AnonRateThrottle):
    """Per-IP limit for the plan endpoint. The rate is the `plan` entry of DEFAULT_THROTTLE_RATES in settings."""

    scope = "plan"

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES[self.scope]  # read per request, so settings changes apply

    def get_ident(self, request):
        return client_address(request)[0]


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


def describe_client(request) -> tuple[int, str, str]:
    """
    For the plan log: (entries in X-Forwarded-For, the address the throttle counted with its last part masked, the
    name of the source it came from). No header values are logged.
    """
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    hops = len([part for part in forwarded.split(",") if part.strip()])
    address, source = client_address(request)
    return hops, mask_ip(address), source
