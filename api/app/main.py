"""Gito IoT Platform - FastAPI Application Factory."""

from contextlib import asynccontextmanager
from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db, close_db


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
    
    # Initialize Cadence workflow client for OTA
    try:
        from app.services.ota_workflow import get_ota_workflow_client
        workflow_client = get_ota_workflow_client()
        connected = await workflow_client.connect()
        if connected:
            print(f"✅ Cadence connected ({settings.CADENCE_FRONTEND_HOST}:{settings.CADENCE_FRONTEND_PORT})")
        else:
            print(f"⚠️ Cadence connection failed - OTA workflows unavailable")
    except Exception as e:
        print(f"⚠️ Cadence initialization warning: {e}")
    
    # Initialize background task scheduler for notification retry and queue processing
    try:
        from app.services.background_tasks import notification_background_tasks
        await notification_background_tasks.start()
    except Exception as e:
        print(f"⚠️ Background tasks initialization warning: {e}")
    
    yield
    
    # Shutdown
    await close_db()
    # Close Cadence connection
    try:
        from app.services.ota_workflow import get_ota_workflow_client
        workflow_client = get_ota_workflow_client()
        await workflow_client.close()
    except Exception as e:
        print(f"⚠️ Cadence shutdown warning: {e}")
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
    @app.get("/api/health", status_code=status.HTTP_200_OK)
    async def health_check():
        """Health check endpoint for Docker/K8s."""
        return {"status": "ok", "service": settings.APP_NAME}
    
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
    from app.routers import dashboards, dashboard_widgets, solution_templates  # Dashboard builder system

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
    app.include_router(dashboards.router, prefix="/api/v1")  # Dashboard builder
    app.include_router(dashboard_widgets.router, prefix="/api/v1")  # Dashboard widgets
    app.include_router(solution_templates.router, prefix="/api/v1")  # Solution templates
    app.include_router(telemetry.router, prefix="/api/v1")
    app.include_router(telemetry_aggregate.router, prefix="/api/v1")
    app.include_router(websocket.router, prefix="/api/v1")
    
    # Disabled routers (superseded by unified systems):
    # - alert_rules: Replaced by alert_rules_unified
    # - alert_rules_composite: Replaced by alert_rules_unified
    # - composite_alerts: Replaced by alert_rules_unified
    # - grafana: External integration (future)
    # - firmware: OTA functionality (future)
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
