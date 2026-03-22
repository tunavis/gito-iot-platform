"""Gito IoT Platform - FastAPI Application Factory."""

import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as aioredis
from sqlalchemy import text

from app.config import get_settings
from app.database import init_db, close_db, _SessionLocal


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
    
    yield
    
    # Shutdown
    await close_db()
    # Close shared Redis client
    if hasattr(app, 'state') and hasattr(app.state, 'redis') and app.state.redis:
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
    
    # CORS Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-total-count", "x-page"],
    )
    
    # Health check endpoint (unauthenticated)
    @app.get("/api/health")
    async def health_check():
        """Health check with dependency probing."""
        db_check = await _check_database()
        keydb_check = await _check_keydb()
        checks = {"database": db_check, "keydb": keydb_check}

        if db_check["status"] != "ok":
            return JSONResponse(
                status_code=503,
                content={"status": "unhealthy", "checks": checks, "service": settings.APP_NAME},
            )
        if keydb_check["status"] != "ok":
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
                    "message": str(exc) if settings.APP_ENV != "production" else "Internal server error",
                }
            }
        )
    
    # Import and include routers
    from app.routers import auth, devices, websocket, telemetry, telemetry_aggregate, organizations, sites, device_groups, alarms, notifications, device_types, users, audit_logs, notification_rules, analytics
    from app.routers import alert_rules_unified  # Unified alert rules (THRESHOLD + COMPOSITE)
    from app.routers import dashboards, dashboard_widgets  # Dashboard builder system
    from app.routers import device_credentials, device_ingest  # Device token provisioning
    from app.routers import commands  # Device RPC commands
    from app.routers import hierarchy  # Asset hierarchy tree
    from app.routers import settings as settings_router  # Tenant settings & profile
    from app.routers import events as events_router  # IoT event stream
    from app.routers import firmware as firmware_router  # OTA firmware management
    from app.routers import admin_tenants as admin_tenants_router  # Tenant management (management tenants only)

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(users.router, prefix="/api/v1")  # User Management & RBAC
    app.include_router(audit_logs.router, prefix="/api/v1")  # Audit Logs for compliance
    app.include_router(devices.router, prefix="/api/v1")
    app.include_router(device_types.router, prefix="/api/v1")  # Device Type templates (AWS IoT pattern)
    app.include_router(alert_rules_unified.router, prefix="/api/v1")  # Unified alert rules (THRESHOLD + COMPOSITE)
    app.include_router(alarms.router, prefix="/api/v1")  # Unified enterprise alarm system
    app.include_router(organizations.router, prefix="/api/v1")  # Hierarchy: Organizations
    app.include_router(sites.router, prefix="/api/v1")  # Hierarchy: Sites
    app.include_router(device_groups.router, prefix="/api/v1")  # Hierarchy: Device Groups
    app.include_router(notifications.router, prefix="/api/v1")  # Notification channels & history
    app.include_router(notification_rules.router, prefix="/api/v1")  # Notification routing rules
    app.include_router(analytics.router, prefix="/api/v1")  # Analytics & dashboard metrics
    app.include_router(hierarchy.router, prefix="/api/v1")  # Asset hierarchy tree
    app.include_router(settings_router.router, prefix="/api/v1")  # Tenant settings & profile
    app.include_router(events_router.router, prefix="/api/v1")    # IoT event stream
    app.include_router(firmware_router.router, prefix="/api/v1")  # OTA firmware management
    app.include_router(admin_tenants_router.router, prefix="/api/v1")  # Tenant management (management tenants only)
    app.include_router(dashboards.router, prefix="/api/v1")  # Dashboard builder
    app.include_router(dashboard_widgets.router, prefix="/api/v1")  # Dashboard widgets
    app.include_router(telemetry.router, prefix="/api/v1")
    app.include_router(telemetry_aggregate.router, prefix="/api/v1")
    app.include_router(device_credentials.router, prefix="/api/v1")  # Token CRUD
    app.include_router(device_ingest.router, prefix="/api/v1")        # Token-based ingest
    app.include_router(commands.router, prefix="/api/v1")              # Device RPC commands
    app.include_router(websocket.router, prefix="/api/v1")
    
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
