from rest_framework.settings import api_settings
from rest_framework.throttling import AnonRateThrottle


class PlanRateThrottle(AnonRateThrottle):
    """Per-IP limit for the plan endpoint. The rate is the `plan` entry of DEFAULT_THROTTLE_RATES in settings."""

    scope = "plan"

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES[self.scope]  # read per request, so settings changes apply
