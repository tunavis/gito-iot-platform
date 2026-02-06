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

    # Cadence Workflow Engine (Phase 3 OTA)
    CADENCE_FRONTEND_HOST: str = "cadence"
    CADENCE_FRONTEND_PORT: int = 7933
    CADENCE_DOMAIN: str = "gito-main"  # Default domain name

    # Security
    RATE_LIMIT_PER_MINUTE: int = 60
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    ALLOWED_HOSTS: list[str] = ["localhost", "127.0.0.1"]

    # Cookie Security (for auth tokens)
    COOKIE_SECURE: bool = False  # Set to True to force secure cookies (HTTPS only)
    TRUST_PROXY: bool = True     # Trust X-Forwarded-Proto header from reverse proxy

    # Logging
    LOG_LEVEL: str = "INFO"

    # Email / SMTP Configuration
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "noreply@gito-iot.local"
    SMTP_USE_TLS: bool = True

    # Features
    ENABLE_MQTT_PROCESSOR: bool = True
    ENABLE_OTA_SERVICE: bool = False  # Phase 3

    class Config:
        env_file = ".env"
        case_sensitive = True
        # Don't fail if env var missing - use defaults
        extra = "allow"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings (called once at startup)."""
    return Settings()
