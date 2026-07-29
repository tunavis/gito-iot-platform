"""Configuration management for Gito IoT API using Pydantic Settings."""

from typing import Literal
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings - loaded from environment variables."""

    # App Configuration
    APP_NAME: str = "Gito IoT API"
    APP_ENV: Literal["development", "staging", "production"] = "development"
    API_VERSION: str = "v1"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str  # postgresql+asyncpg://user:pass@host:5432/dbname
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_POOL_RECYCLE: int = 3600

    # Redis / Cache
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT Configuration
    JWT_ALGORITHM: str = "HS256"
    JWT_SECRET_KEY: str  # Min 32 chars, never in code
    JWT_EXPIRATION_HOURS: int = 24
    JWT_REFRESH_EXPIRATION_DAYS: int = 7

    # MQTT Configuration
    MQTT_BROKER_HOST: str = "mosquitto"
    MQTT_BROKER_PORT: int = 1883
    MQTT_USERNAME: str = "admin"
    MQTT_PASSWORD: str
    MQTT_KEEPALIVE: int = 60

    # ChirpStack Integration (Phase 3)
    CHIRPSTACK_API_URL: str = "http://localhost:8090"
    CHIRPSTACK_TENANT_ID: str = ""
    CHIRPSTACK_API_KEY: str = ""

    # Billing — card gateway. Which provider the checkout/charge/webhook paths use.
    # Peach paused early-stage onboarding (2026-07), so Paystack is the active gateway;
    # the Peach adapter stays in the tree for if/when they reopen. Swapping is a
    # one-line change here — the engine, schema, invoicing and webhook idempotency are
    # provider-agnostic.
    CARD_PROVIDER: Literal["paystack", "peach"] = "paystack"

    # Paystack (active card gateway). Disabled until keys are set; all from the
    # Paystack dashboard, none committed. SA-supported, ZAR, amounts in cents.
    # The secret key is ALSO the webhook signing key (HMAC-SHA512 over the raw body).
    PAYSTACK_ENABLED: bool = False
    PAYSTACK_API_URL: str = "https://api.paystack.co"
    PAYSTACK_SECRET_KEY: str = ""  # sk_test_... / sk_live_...

    # Peach Payments (parked — onboarding paused). Kept so the adapter still works if
    # re-enabled: set CARD_PROVIDER=peach + these. All from the Peach dashboard.
    PEACH_ENABLED: bool = False
    PEACH_AUTH_URL: str = ""  # OAuth token endpoint (from Peach dashboard)
    PEACH_API_URL: str = ""  # Checkout / payments base URL (from Peach dashboard)
    PEACH_CLIENT_ID: str = ""
    PEACH_CLIENT_SECRET: str = ""
    PEACH_MERCHANT_ID: str = ""
    PEACH_ENTITY_ID: str = ""
    PEACH_WEBHOOK_SECRET: str = ""  # shared secret for HMAC-SHA256 webhook verification

    @property
    def card_enabled(self) -> bool:
        """Is the active card gateway configured? Gates checkout + recurring charges."""
        return {"paystack": self.PAYSTACK_ENABLED, "peach": self.PEACH_ENABLED}.get(
            self.CARD_PROVIDER, False
        )

    # Security
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_DEFAULT: str = "60/minute"
    RATE_LIMIT_AUTH: str = "5/minute"
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    ALLOWED_HOSTS: list[str] = ["localhost", "127.0.0.1"]

    # Cookie Security (for auth tokens)
    COOKIE_SECURE: bool = False  # Set to True to force secure cookies (HTTPS only)
    TRUST_PROXY: bool = True  # Trust X-Forwarded-Proto header from reverse proxy

    # Logging
    LOG_LEVEL: str = "INFO"

    # Email / SMTP Configuration
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "noreply@gito-iot.local"
    SMTP_USE_TLS: bool = True

    # Minutes to suppress repeat notifications on the same channel for the same rule
    NOTIFICATION_THROTTLE_MINUTES: int = 1

    # Webhook URL base for integration setup instructions
    API_BASE_URL: str = "https://iot.gito.co.za"

    # Features
    ENABLE_MQTT_PROCESSOR: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = True
        # Don't fail if env var missing - use defaults
        extra = "allow"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings (called once at startup)."""
    return Settings()
