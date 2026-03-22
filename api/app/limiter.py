"""Rate limiter instance — import in main.py and routers that need custom limits."""

from slowapi import Limiter
from slowapi.util import get_remote_address
from app.config import get_settings


def _get_client_ip(request):
    """Get real client IP, respecting X-Forwarded-For behind proxy."""
    settings = get_settings()
    if settings.TRUST_PROXY:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return get_remote_address(request)


settings = get_settings()
limiter = Limiter(key_func=_get_client_ip, default_limits=[settings.RATE_LIMIT_DEFAULT])
