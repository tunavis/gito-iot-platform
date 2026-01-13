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
    
    yield
    
    # Shutdown
    await close_db()
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
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "Internal server error",
                }
            }
        )
    
    # Import and include routers
    from app.routers import auth, devices, websocket, alert_rules, telemetry
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(devices.router, prefix="/api/v1")
    app.include_router(alert_rules.router, prefix="/api/v1")
    app.include_router(telemetry.router, prefix="/api/v1")
    app.include_router(websocket.router, prefix="/api/v1")
    
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
