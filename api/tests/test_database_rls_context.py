"""Tests for RLSSession's transaction-scoped tenant context (app.database)."""

import os

# app.database builds an engine (and therefore Settings()) at import time;
# supply the required env vars so importing it here doesn't need a real .env.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import RLSSession

TENANT_ID = "12345678-1234-5678-1234-567812345678"
USER_ID = "87654321-4321-8765-4321-876543218765"


def _make_session() -> RLSSession:
    """RLSSession with a mocked execute() and no real DB connection."""
    session = RLSSession.__new__(RLSSession)
    session.execute = AsyncMock()
    return session


class TestSetTenantContext:
    @pytest.mark.asyncio
    async def test_uses_transaction_scoped_set_config(self):
        session = _make_session()

        await session.set_tenant_context(TENANT_ID, USER_ID)

        sql_texts = [call.args[0].text for call in session.execute.await_args_list]
        assert len(sql_texts) == 3
        assert all("TRUE" in sql for sql in sql_texts), (
            "set_config must use is_local=TRUE (SET LOCAL semantics) so RLS "
            "context resets when the transaction ends, instead of leaking "
            "across pooled-connection reuse between requests."
        )


class TestCommitReappliesContext:
    @pytest.mark.asyncio
    async def test_commit_reapplies_tenant_context(self):
        session = _make_session()
        await session.set_tenant_context(TENANT_ID, USER_ID)
        session.execute.reset_mock()

        with patch.object(AsyncSession, "commit", new=AsyncMock()) as base_commit:
            await session.commit()

        base_commit.assert_awaited_once()
        # commit() ends the transaction the original SET LOCAL applied to;
        # it must be reapplied so a follow-up query on the same session
        # (e.g. commit() -> refresh()) doesn't silently run without tenant scope.
        assert session.execute.await_count == 3

    @pytest.mark.asyncio
    async def test_commit_without_prior_context_does_not_reapply(self):
        session = _make_session()

        with patch.object(AsyncSession, "commit", new=AsyncMock()) as base_commit:
            await session.commit()

        base_commit.assert_awaited_once()
        session.execute.assert_not_awaited()
