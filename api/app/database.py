"""Database setup and session management with RLS support."""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
from sqlalchemy import text
from typing import AsyncGenerator
from uuid import UUID

from app.config import get_settings

# Base class for all models
Base = declarative_base()


class RLSSession(AsyncSession):
    """AsyncSession with Row-Level Security context support.

    The tenant/user context is set with is_local=TRUE (SET LOCAL semantics),
    so Postgres clears it automatically when the current transaction ends.
    Without this, a pooled physical connection that skips set_tenant_context()
    on its next checkout silently inherits whichever tenant last used that
    connection instead of failing closed under RLS.
    """

    _tenant_id: str | None = None
    _user_id: str | None = None

    async def set_tenant_context(self, tenant_id: UUID | str, user_id: UUID | str = None) -> None:
        """Set the tenant_id and optionally user_id for RLS policies.

        This must be called before any queries to ensure RLS filters apply.

        Args:
            tenant_id: Tenant UUID for multi-tenant isolation
            user_id: Optional user UUID for user-level RLS policies (dashboards, etc.)
        """
        if isinstance(tenant_id, UUID):
            tenant_id = str(tenant_id)
        if isinstance(user_id, UUID):
            user_id = str(user_id)

        # Set both app.tenant_id (legacy) and app.current_tenant_id (new) for compatibility
        await self.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, TRUE)"),
            {"tenant_id": tenant_id}
        )
        await self.execute(
            text("SELECT set_config('app.current_tenant_id', :tenant_id, TRUE)"),
            {"tenant_id": tenant_id}
        )

        # Set user context if provided (for user-scoped resources like dashboards)
        if user_id is not None:
            await self.execute(
                text("SELECT set_config('app.current_user_id', :user_id, TRUE)"),
                {"user_id": user_id}
            )

        # Remembered so commit() can re-apply it to the next transaction (see commit() below).
        self._tenant_id = tenant_id
        self._user_id = user_id

    async def commit(self) -> None:
        """Commit, then re-apply the RLS context for any further use of this session.

        commit() ends the transaction that set_tenant_context()'s SET LOCAL
        applied to. Routers commonly do commit() -> refresh()/execute() again
        on the same session (e.g. reloading a just-created row) — without
        this, that follow-up query would silently run with no tenant context.
        """
        # ponytail: only commit() is overridden, not rollback() — every router
        # today calls rollback() only on an error path that ends the request
        # (checked: no call site queries again afterward). If a future call
        # site does rollback() then keeps using the session, give rollback()
        # the same reapply-context treatment as commit() below.
        await super().commit()
        if self._tenant_id is not None:
            await self.set_tenant_context(self._tenant_id, self._user_id)


def get_database_engine():
    """Create async SQLAlchemy engine."""
    settings = get_settings()
    
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.APP_ENV == "development",
        pool_size=settings.DATABASE_POOL_SIZE,
        max_overflow=settings.DATABASE_MAX_OVERFLOW,
        pool_recycle=settings.DATABASE_POOL_RECYCLE,
        pool_pre_ping=True,  # Test connection before use
        # NullPool for serverless/lambda environments
        # poolclass=NullPool if settings.APP_ENV == "serverless" else QueuePool
    )
    
    return engine


# Create engine and session factory
_engine = get_database_engine()
_SessionLocal = async_sessionmaker(
    _engine,
    class_=RLSSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncGenerator[RLSSession, None]:
    """Get database session for dependency injection.
    
    Example:
        @router.get("/devices")
        async def list_devices(session: Annotated[RLSSession, Depends(get_session)]):
            async with session.begin():
                # queries
    """
    async with _SessionLocal() as session:
        yield session


async def init_db() -> None:
    """Initialize database (create tables if needed).
    
    This is only needed if not using migrations.
    In production, use Alembic migrations instead.
    """
    async with _engine.begin() as conn:
        # Only create tables if they don't exist
        # In production, use: alembic upgrade head
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Close database connections."""
    await _engine.dispose()
