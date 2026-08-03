"""Gito IoT Platform - FastAPI Application Factory."""

import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as aioredis
from sqlalchemy import text

from app.config import get_settings
from app.database import init_db, close_db, _SessionLocal

# Configure logging BEFORE anything logs. Without this the API had no logging
# config at all: root had no handler, so every logger.info from app code was
# silently discarded (including detect_offline_devices' "Marked 68 device(s) as
# offline" during a 43h outage) and warnings/errors only escaped through
# logging.lastResort — bare messages, no timestamp, no logger name. Same
# format as processor/mqtt_processor.py so both services read alike.
logging.basicConfig(
    level=getattr(logging, get_settings().LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


async def _check_database() -> dict:
    """Check database connectivity and measure latency."""
    try:
        start = time.monotonic()
        async with _SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        latency = round((time.monotonic() - start) * 1000, 1)
        return {"status": "ok", "latency_ms": latency}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_ingestion() -> dict:
    """Report whether telemetry is still arriving platform-wide.

    Deliberately returns only the status, never the raw uplink age: /api/health
    is unauthenticated, and the age is cross-tenant operational detail. The age
    goes to the log, from NotificationBackgroundTasks.detect_ingestion_stall.
    """
    from app.services.device_status import check_ingestion_stall

    try:
        async with _SessionLocal() as session:
            result = await check_ingestion_stall(session)
        return {"status": result["status"]}
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _check_keydb() -> dict:
    """Check KeyDB/Redis connectivity and measure latency."""
    settings = get_settings()
    try:
        start = time.monotonic()
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.aclose()
        latency = round((time.monotonic() - start) * 1000, 1)
        return {"status": "ok", "latency_ms": latency}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle app startup and shutdown."""
    # Startup
    settings = get_settings()
    print(f"Starting {settings.APP_NAME} in {settings.APP_ENV} mode")

    try:
        await init_db()
        print("✅ Database initialized")
    except Exception as e:
        print(f"⚠️ Database initialization warning: {e}")

    # `SecretKeyMissing` is deliberately NOT caught: if encrypted credentials
    # exist and the key is gone, booting anyway means every downlink fails the
    # moment someone needs one, from a service reporting itself healthy.
    #
    # An unreachable database *is* caught, because that is a different failure —
    # we cannot know whether any secrets exist, and `init_db` above already
    # tolerates it. Failing here instead would mean the app could no longer start
    # without a database, which it always could.
    from app.database import get_session
    from app.services.secrets import SecretKeyMissing, assert_key_available_if_needed

    try:
        _gen = get_session()
        _session = await _gen.__anext__()
        try:
            await assert_key_available_if_needed(_session)
            print("✅ Secret encryption key checked")
        finally:
            await _gen.aclose()
    except SecretKeyMissing:
        raise
    except Exception as e:
        print(f"⚠️ Could not check the secret encryption key: {e}")

    # Initialize shared Redis client for app-wide use
    try:
        app_state_redis = aioredis.from_url(settings.REDIS_URL)
        await app_state_redis.ping()
        app.state.redis = app_state_redis
        print("✅ Redis/KeyDB connected")
    except Exception as e:
        app.state.redis = None
        print(f"⚠️ Redis/KeyDB connection warning: {e}")

    # Initialize background task scheduler for notification retry and queue processing
    try:
        from app.services.background_tasks import notification_background_tasks

        await notification_background_tasks.start()
    except Exception as e:
        print(f"⚠️ Background tasks initialization warning: {e}")

    # MCP session manager. Unlike the blocks above, this is NOT wrapped in a
    # try/except: if MCP is switched on and cannot start, the API must fail
    # loudly rather than serve a /mcp route that accepts connections and does
    # nothing. The other initialisations degrade gracefully because the app is
    # still useful without them; a broken MCP mount is not useful at all.
    if settings.MCP_ENABLED:
        async with app.state.mcp_session_manager.run():
            print(f"✅ MCP server mounted at /mcp (protocol {settings.MCP_PROTOCOL_VERSION})")
            yield
            await _shutdown(app, settings)
        return

    yield

    await _shutdown(app, settings)


async def _shutdown(app: FastAPI, settings) -> None:
    """Shared teardown — the MCP-enabled path exits through a context manager, so
    both paths call this rather than keeping two copies that can drift apart."""
    await close_db()
    # Close shared Redis client
    if hasattr(app, "state") and hasattr(app.state, "redis") and app.state.redis:
        await app.state.redis.aclose()
    # Stop background task scheduler
    try:
        from app.services.background_tasks import notification_background_tasks

        await notification_background_tasks.stop()
    except Exception as e:
        print(f"⚠️ Background tasks shutdown warning: {e}")
    print(f"Shutting down {settings.APP_NAME}")


def create_app() -> FastAPI:
    """Application factory - creates and configures FastAPI app."""
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.API_VERSION,
        description="Multi-tenant IoT Monitoring Platform - Cumulocity Competitor",
        docs_url="/api/docs" if settings.APP_ENV != "production" else None,
        redoc_url="/api/redoc" if settings.APP_ENV != "production" else None,
        openapi_url="/api/openapi.json" if settings.APP_ENV != "production" else None,
        lifespan=lifespan,
    )

    # MCP: mounted only when enabled, so when it is off the route does not exist
    # at all (404) rather than existing and refusing. The protocol version is
    # asserted here, at construction, so a mismatch fails the boot rather than
    # surfacing on the first client connection.
    if settings.MCP_ENABLED:
        from app.mcp import assert_protocol_version, build_mcp_server

        assert_protocol_version()
        mcp_server = build_mcp_server()
        from mcp.server.transport_security import TransportSecuritySettings

        allowed_hosts = [h.strip() for h in settings.MCP_ALLOWED_HOSTS.split(",") if h.strip()]
        mcp_app = mcp_server.streamable_http_app(
            streamable_http_path="/",
            # Stateless, because the API runs `uvicorn --workers 4` and the
            # session manager keeps sessions in memory *per process*. With
            # sessions on, `initialize` lands on one worker and the next call
            # round-robins to a worker that has never heard of it — three
            # requests in four fail with "Session not found". Verified against
            # staging 2026-07-31; it is invisible to a single-worker dev run,
            # which is exactly why it survived to deployment.
            #
            # Nothing here wants session state: every tool is request/response,
            # and `auth.py` already resolves the caller per invocation rather
            # than caching it, precisely so a session cannot outlive its token.
            # If a future tool needs resumability or server-initiated
            # notifications, this needs a shared event store, not a flag flip.
            stateless_http=True,
            # Left ON. Without this the browser-facing deployment is open to DNS
            # rebinding; the fix is to list the hosts clients use, not to disable
            # the check. A wrong entry here surfaces as a 421, not a silent hole.
            transport_security=TransportSecuritySettings(
                enable_dns_rebinding_protection=True,
                allowed_hosts=allowed_hosts,
                allowed_origins=allowed_hosts,
            ),
        )
        # The session manager must run inside the host app's lifespan; stash it
        # so `lifespan` can enter it without rebuilding the server.
        app.state.mcp_session_manager = mcp_server.session_manager
        app.mount("/mcp", mcp_app)

    # CORS Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-total-count", "x-page"],
    )

    # Audit logging — writes audit_logs rows for tenant-scoped mutations
    from app.middleware import audit_log_middleware

    app.middleware("http")(audit_log_middleware)

    # Rate limiting (slowapi)
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from app.limiter import limiter

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Health check endpoint (unauthenticated)
    @app.get("/api/health")
    async def health_check():
        """Health check with dependency probing."""
        db_check = await _check_database()
        keydb_check = await _check_keydb()
        ingest_check = await _check_ingestion()
        checks = {
            "database": db_check,
            "keydb": keydb_check,
            "ingestion": ingest_check,
            # Reported, never fatal — MCP being off is a configuration choice,
            # not a fault, so it must not colour the overall status.
            "mcp": {
                "status": "enabled" if settings.MCP_ENABLED else "disabled",
                "protocol_version": settings.MCP_PROTOCOL_VERSION,
            },
        }

        if db_check["status"] != "ok":
            return JSONResponse(
                status_code=503,
                content={"status": "unhealthy", "checks": checks, "service": settings.APP_NAME},
            )
        # A stalled ingest path is reported, never fatal: 503 here would make
        # Docker restart the API (taking the UI down) over a problem that lives
        # in the processor and that restarting the API cannot fix.
        if keydb_check["status"] != "ok" or ingest_check["status"] == "stalled":
            return {"status": "degraded", "checks": checks, "service": settings.APP_NAME}
        return {"status": "healthy", "checks": checks, "service": settings.APP_NAME}

    # Root endpoint
    @app.get("/")
    async def root():
        return {"message": f"Welcome to {settings.APP_NAME} {settings.API_VERSION}"}

    # Global error handler (placeholder - customize as needed)
    @app.exception_handler(Exception)
    async def global_exception_handler(request, exc):
        import traceback

        print(f"❌ UNHANDLED EXCEPTION: {type(exc).__name__}: {str(exc)}")
        print(f"   URL: {request.url}")
        print(f"   Traceback:\n{traceback.format_exc()}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": str(exc)
                    if settings.APP_ENV != "production"
                    else "Internal server error",
                },
            },
        )

    # Import and include routers
    from app.routers import (
        auth,
        devices,
        websocket,
        telemetry,
        telemetry_aggregate,
        organizations,
        sites,
        assets,
        device_groups,
        alarms,
        notifications,
        device_types,
        users,
        audit_logs,
        notification_rules,
        analytics,
    )
    from app.routers import alert_rules_unified  # Unified alert rules (THRESHOLD + COMPOSITE)
    from app.routers import dashboards, dashboard_widgets  # Dashboard builder system
    from app.routers import device_credentials, device_ingest  # Device token provisioning
    from app.routers import commands  # Device RPC commands
    from app.routers import hierarchy  # Asset hierarchy tree
    from app.routers import settings as settings_router  # Tenant settings & profile
    from app.routers import events as events_router  # IoT event stream
    from app.routers import firmware as firmware_router  # OTA firmware management
    from app.routers import (
        admin_tenants as admin_tenants_router,
    )  # Tenant management (management tenants only)
    from app.routers import (
        solution_templates as solution_templates_router,
    )  # Industry vertical templates
    from app.routers import integrations as integrations_router  # LoRaWAN integration management
    from app.routers import (
        lorawan_ingest as lorawan_ingest_router,
    )  # Universal LoRaWAN webhook ingest
    from app.routers import billing as billing_router  # Subscription billing & entitlements

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(users.router, prefix="/api/v1")  # User Management & RBAC
    app.include_router(audit_logs.router, prefix="/api/v1")  # Audit Logs for compliance
    app.include_router(devices.router, prefix="/api/v1")
    app.include_router(
        device_types.router, prefix="/api/v1"
    )  # Device Type templates (AWS IoT pattern)
    app.include_router(
        alert_rules_unified.router, prefix="/api/v1"
    )  # Unified alert rules (THRESHOLD + COMPOSITE)
    app.include_router(alarms.router, prefix="/api/v1")  # Unified enterprise alarm system
    app.include_router(organizations.router, prefix="/api/v1")  # Hierarchy: Organizations
    app.include_router(sites.router, prefix="/api/v1")  # Hierarchy: Sites
    app.include_router(assets.router, prefix="/api/v1")  # Asset registry (additive, Y1)
    app.include_router(device_groups.router, prefix="/api/v1")  # Hierarchy: Device Groups
    app.include_router(notifications.router, prefix="/api/v1")  # Notification channels & history
    app.include_router(notification_rules.router, prefix="/api/v1")  # Notification routing rules
    app.include_router(analytics.router, prefix="/api/v1")  # Analytics & dashboard metrics
    app.include_router(hierarchy.router, prefix="/api/v1")  # Asset hierarchy tree
    app.include_router(settings_router.router, prefix="/api/v1")  # Tenant settings & profile
    app.include_router(events_router.router, prefix="/api/v1")  # IoT event stream
    app.include_router(firmware_router.router, prefix="/api/v1")  # OTA firmware management
    app.include_router(
        admin_tenants_router.router, prefix="/api/v1"
    )  # Tenant management (management tenants only)
    app.include_router(dashboards.router, prefix="/api/v1")  # Dashboard builder
    app.include_router(dashboard_widgets.router, prefix="/api/v1")  # Dashboard widgets
    app.include_router(telemetry.router, prefix="/api/v1")
    app.include_router(telemetry_aggregate.router, prefix="/api/v1")
    app.include_router(device_credentials.router, prefix="/api/v1")  # Token CRUD
    app.include_router(device_ingest.router, prefix="/api/v1")  # Token-based ingest
    app.include_router(commands.router, prefix="/api/v1")  # Device RPC commands
    # Tenant-scoped approval queue — same module, different prefix, because it
    # answers "what is waiting anywhere in my fleet" rather than "what happened
    # to this device".
    app.include_router(commands.approvals_router, prefix="/api/v1")
    app.include_router(solution_templates_router.router, prefix="/api/v1")  # Solution templates
    app.include_router(
        integrations_router.router, prefix="/api/v1"
    )  # LoRaWAN integration management
    app.include_router(
        lorawan_ingest_router.router, prefix="/api/v1"
    )  # Universal LoRaWAN webhook ingest
    app.include_router(websocket.router, prefix="/api/v1")
    app.include_router(billing_router.public_router, prefix="/api/v1")  # Public pricing
    app.include_router(billing_router.router, prefix="/api/v1")  # Subscription/entitlements/usage
    app.include_router(
        billing_router.admin_router, prefix="/api/v1"
    )  # Admin/manual plan assignment
    app.include_router(billing_router.webhook_router, prefix="/api/v1")  # Payment provider webhooks

    # Disabled routers (superseded by unified systems):
    # - alert_rules: Replaced by alert_rules_unified
    # - alert_rules_composite: Replaced by alert_rules_unified
    # - composite_alerts: Replaced by alert_rules_unified
    # - grafana: External integration (future)
    # - bulk_operations: Batch operations (future)
    # - lorawan: LoRaWAN-specific operations (future)

    return app


# Create app instance
app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.APP_ENV == "development",
        log_level=settings.LOG_LEVEL.lower(),
    )
