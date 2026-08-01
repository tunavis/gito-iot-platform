"""The two behaviours that mocks and source-matching cannot prove.

Both tests here need **committed data on separate connections**, so neither can
use the rolled-back-transaction fixture the other suites share:

- A `FOR UPDATE` lock only means anything *between* transactions. Two approvals
  on one connection never contend, so a sequential double-approve test passes
  even with the lock deleted — it proves the status check, nothing more.
- `expire_timed_out_commands` opens its own session through `get_session` and
  commits. It cannot see a row that exists only inside somebody else's
  uncommitted transaction.

So these write real rows and delete them in a `finally`. They skip when no
database is reachable, like the other integration suites.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import RLSSession
from app.routers import commands

DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql+asyncpg://gito:dev-password@localhost:5433/gito"),
)


@pytest_asyncio.fixture
async def scratch():
    """A tenant, device and session-factory on real committed rows.

    Everything created is torn down in the `finally`, including the tenant, whose
    CASCADE takes the devices and commands with it — so a failed test cannot leave
    a half-built fixture behind for the next one to trip over.
    """
    engine = create_async_engine(DB_URL, poolclass=None)
    try:
        conn = await engine.connect()
        await conn.close()
    except Exception as e:  # noqa: BLE001 - any connect failure means "no DB here"
        await engine.dispose()
        pytest.skip(f"no database reachable at {DB_URL}: {e}")

    maker = async_sessionmaker(bind=engine, class_=RLSSession, expire_on_commit=False)
    tenant_id, device_id = uuid.uuid4(), uuid.uuid4()
    # Real users, because `approved_by`/`rejected_by` are foreign keys. Passing a
    # random uuid makes the *commit* fail after dispatch has already happened,
    # which rolls the decision back and releases the lock with the row still
    # awaiting approval — so the next caller dispatches too. That looks exactly
    # like a broken lock, and it cost an hour to tell apart from one.
    approver_ids = [uuid.uuid4(), uuid.uuid4()]

    async with maker() as s:
        await s.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:i, 'Concurrency Test', :sl)"),
            {"i": str(tenant_id), "sl": f"ct{uuid.uuid4().hex[:12]}"},
        )
        for n, uid in enumerate(approver_ids):
            await s.execute(
                text(
                    "INSERT INTO users (id, tenant_id, email, password_hash, role, status)"
                    " VALUES (:u, :t, :e, 'x', 'TENANT_ADMIN', 'active')"
                ),
                {"u": str(uid), "t": str(tenant_id), "e": f"race{n}-{uuid.uuid4().hex[:8]}@t.test"},
            )
        await s.execute(
            text(
                "INSERT INTO devices (id, tenant_id, name, device_type, status)"
                " VALUES (:d, :t, 'Race-Pump', 'sensor', 'online')"
            ),
            {"d": str(device_id), "t": str(tenant_id)},
        )
        await s.commit()

    try:
        yield {
            "maker": maker,
            "tenant_id": tenant_id,
            "device_id": device_id,
            "approvers": approver_ids,
        }
    finally:
        async with maker() as s:
            await s.execute(text("DELETE FROM tenants WHERE id = :i"), {"i": str(tenant_id)})
            await s.commit()
        await engine.dispose()


async def _run_sweep(maker):
    """Run the real `expire_timed_out_commands` against the test's engine.

    The sweep gets its session from the module-level factory in `app.database`,
    whose engine was created on import — a different event loop from the one
    pytest-asyncio gives each test. Left alone it raises "attached to a different
    loop", and the sweep's own `except Exception` swallows that, so the function
    appears to run and changes nothing.

    That failure mode is why the control test below exists: a sweep that never
    executes leaves an `awaiting_approval` row untouched, which is indistinguishable
    from a sweep that correctly ignored it. Only the row it is *supposed* to
    change tells them apart.
    """
    from app.services import background_tasks as bt

    async def loop_local_session():
        async with maker() as session:
            yield session

    with patch.object(bt, "get_session", loop_local_session):
        await bt.NotificationBackgroundTasks().expire_timed_out_commands()


async def _pending(maker, tenant_id, device_id, *, hours=24) -> uuid.UUID:
    command_id = uuid.uuid4()
    now = datetime.now(UTC)
    async with maker() as s:
        await s.execute(
            text(
                "INSERT INTO device_commands (id, tenant_id, device_id, command_name, parameters,"
                " status, request_reason, created_at, expires_at)"
                " VALUES (:i, :t, :d, 'close_valve', '{}', 'awaiting_approval', 'race test',"
                " :c, :e)"
            ),
            {
                "i": str(command_id),
                "t": str(tenant_id),
                "d": str(device_id),
                "c": now,
                "e": now + timedelta(hours=hours),
            },
        )
        await s.commit()
    return command_id


class TestConcurrentApprovalDispatchesOnce:
    """The property the whole gate turns on, tested the only way that proves it."""

    @pytest.mark.asyncio
    async def test_two_simultaneous_approvals_dispatch_exactly_once(self, scratch):
        """Two operators clicking Approve together, on separate connections.

        Without `FOR UPDATE` both transactions read 'awaiting_approval' before
        either writes, and both dispatch — a valve moved twice. A sequential
        double-approve test cannot catch that, because the first call has already
        committed before the second reads.
        """
        maker, tenant_id, device_id = scratch["maker"], scratch["tenant_id"], scratch["device_id"]
        approvers = scratch["approvers"]
        command_id = await _pending(maker, tenant_id, device_id)

        dispatched = 0
        lock = asyncio.Lock()

        async def counting_dispatch(device, command):
            nonlocal dispatched
            async with lock:
                dispatched += 1
            # Hold the transaction open long enough for the other to contend; a
            # race that resolves instantly is not a race that was tested.
            await asyncio.sleep(0.15)
            return True, ""

        async def approve(approver):
            async with maker() as session:
                return await commands.approve_command(
                    tenant_id=tenant_id,
                    device_id=device_id,
                    command_id=command_id,
                    session=session,
                    current_tenant=tenant_id,
                    current_user_id=approver,
                )

        with patch.object(
            commands, "validate_tenant_access", new=AsyncMock(return_value=True)
        ), patch.object(commands._dispatch, "dispatch", new=counting_dispatch):
            results = await asyncio.gather(
                approve(approvers[0]), approve(approvers[1]), return_exceptions=True
            )

        refused = [r for r in results if isinstance(r, HTTPException)]
        succeeded = [r for r in results if not isinstance(r, Exception)]

        assert dispatched == 1, f"dispatched {dispatched} times — the lock did not hold"
        assert len(succeeded) == 1, "exactly one approval should win"
        assert len(refused) == 1 and refused[0].status_code == 409

    @pytest.mark.asyncio
    async def test_the_row_ends_in_one_consistent_state(self, scratch):
        maker, tenant_id, device_id = scratch["maker"], scratch["tenant_id"], scratch["device_id"]
        command_id = await _pending(maker, tenant_id, device_id)
        approver = scratch["approvers"][0]

        async def decide(action):
            async with maker() as session:
                fn = commands.approve_command if action == "a" else commands.reject_command
                return await fn(
                    tenant_id=tenant_id,
                    device_id=device_id,
                    command_id=command_id,
                    session=session,
                    current_tenant=tenant_id,
                    current_user_id=approver,
                )

        with patch.object(
            commands, "validate_tenant_access", new=AsyncMock(return_value=True)
        ), patch.object(commands._dispatch, "dispatch", new=AsyncMock(return_value=(True, ""))):
            # Approve and reject racing each other: whichever wins, the row must
            # not end up both dispatched and refused.
            await asyncio.gather(decide("a"), decide("r"), return_exceptions=True)

        async with maker() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT status, approved_by, rejected_by FROM device_commands"
                        " WHERE id = :i"
                    ),
                    {"i": str(command_id)},
                )
            ).first()

        status, approved_by, rejected_by = row
        assert status in ("sent", "failed", "rejected")
        assert not (approved_by and rejected_by), "a command was both approved and rejected"


class TestTheSweepLeavesApprovalsAlone:
    """Replaces a source-text assertion that proved nobody typed a word.

    The old test read the sweep's source and asserted the literal
    "awaiting_approval" was absent from it. That fails if the query is rewritten
    in any equivalent form, and passes if it is rewritten wrongly in a form that
    avoids the literal. This runs the real sweep against a real row instead.
    """

    @pytest.mark.asyncio
    async def test_an_expired_approval_request_is_not_swept_to_timed_out(self, scratch):
        """The clock an approval waits on is a person, not a radio.

        Its `expires_at` is the 24h approval window. If the sweep treated it like
        a dispatched command, every request would be marked timed_out on the
        device's 60-second TTL — long before anyone could act on it.
        """
        maker, tenant_id, device_id = scratch["maker"], scratch["tenant_id"], scratch["device_id"]
        # Already past its window, which is exactly the row a naive sweep grabs.
        command_id = await _pending(maker, tenant_id, device_id, hours=-2)

        await _run_sweep(maker)

        async with maker() as s:
            status = (
                await s.execute(
                    text("SELECT status FROM device_commands WHERE id = :i"),
                    {"i": str(command_id)},
                )
            ).scalar()

        assert status == "awaiting_approval", f"the sweep changed it to {status!r}"

    @pytest.mark.asyncio
    async def test_the_sweep_still_expires_a_real_dispatched_command(self, scratch):
        """The control. Without it, a sweep broken for everything would pass."""
        maker, tenant_id, device_id = scratch["maker"], scratch["tenant_id"], scratch["device_id"]
        command_id = uuid.uuid4()
        now = datetime.now(UTC)
        async with maker() as s:
            await s.execute(
                text(
                    "INSERT INTO device_commands (id, tenant_id, device_id, command_name,"
                    " parameters, status, created_at, expires_at)"
                    " VALUES (:i, :t, :d, 'reboot', '{}', 'sent', :c, :e)"
                ),
                {
                    "i": str(command_id),
                    "t": str(tenant_id),
                    "d": str(device_id),
                    "c": now,
                    "e": now - timedelta(minutes=5),
                },
            )
            await s.commit()

        await _run_sweep(maker)

        async with maker() as s:
            status = (
                await s.execute(
                    text("SELECT status FROM device_commands WHERE id = :i"),
                    {"i": str(command_id)},
                )
            ).scalar()

        assert status == "timed_out"

    @pytest.mark.asyncio
    async def test_a_rejected_command_is_never_reopened_by_the_sweep(self, scratch):
        """A refusal is terminal. Rewriting it to timed_out would erase the fact
        that a person looked at this and said no."""
        maker, tenant_id, device_id = scratch["maker"], scratch["tenant_id"], scratch["device_id"]
        command_id = uuid.uuid4()
        now = datetime.now(UTC)
        async with maker() as s:
            await s.execute(
                text(
                    "INSERT INTO device_commands (id, tenant_id, device_id, command_name,"
                    " parameters, status, rejected_by, rejected_at, created_at, expires_at)"
                    " VALUES (:i, :t, :d, 'close_valve', '{}', 'rejected', NULL, :n, :c, :e)"
                ),
                {
                    "i": str(command_id),
                    "t": str(tenant_id),
                    "d": str(device_id),
                    "n": now,
                    "c": now,
                    "e": now - timedelta(hours=1),
                },
            )
            await s.commit()

        await _run_sweep(maker)

        async with maker() as s:
            status = (
                await s.execute(
                    text("SELECT status FROM device_commands WHERE id = :i"),
                    {"i": str(command_id)},
                )
            ).scalar()

        assert status == "rejected"
