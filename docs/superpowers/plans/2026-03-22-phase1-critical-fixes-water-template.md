# Phase 1: Critical Fixes + Water Template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical foundation issues (auth consolidation, error boundaries, WebSocket, rate limiting, health checks, digital twin) and build the Water Monitoring template as the first industry vertical.

**Architecture:** Backend uses FastAPI with SQLAlchemy async sessions and PostgreSQL RLS for multi-tenancy. Frontend is Next.js 14 with app router. Real-time telemetry flows via MQTT → KeyDB Streams → TimescaleDB, with Redis pub/sub for WebSocket forwarding. Templates create pre-configured dashboards with device types and alert rules.

**Tech Stack:** Python 3.11+ / FastAPI / SQLAlchemy async / TimescaleDB / KeyDB / Next.js 14 / TypeScript / React

**Spec:** `docs/superpowers/specs/2026-03-22-platform-improvement-roadmap-design.md`

---

## File Structure

### New files to create:
| File | Responsibility |
|------|---------------|
| `api/app/dependencies.py` | Centralized auth dependencies (`get_current_tenant`, `get_current_user`, `get_current_user_id`, `get_current_user_info`, `get_management_tenant`) |
| `api/app/limiter.py` | Rate limiter instance (imported by main.py and routers that need custom limits) |
| `api/tests/test_dependencies.py` | Tests for auth dependencies |
| `web/src/components/ErrorBoundary.tsx` | React error boundary component |
| `web/src/hooks/useDashboardWebSocket.ts` | Tenant-level WebSocket hook for dashboard widgets |
| `api/tests/test_health.py` | Tests for health check endpoint |
| `api/app/services/digital_twin.py` | Digital twin cache service (KeyDB last-known-value) |
| `api/tests/test_digital_twin.py` | Tests for digital twin service |
| `api/app/services/solution_templates.py` | Template application service |
| `api/app/routers/solution_templates.py` | Template API endpoints |
| `api/app/schemas/solution_template.py` | Pydantic schemas for templates |
| `api/tests/test_solution_templates.py` | Tests for template system |
| `api/alembic/versions/013_solution_templates.py` | Migration for new solution_templates table |

### Files to modify:
| File | Change |
|------|--------|
| `api/app/routers/*.py` (19 files) | Remove local `get_current_tenant`/`get_current_user`, import from `dependencies.py` |
| `api/app/main.py` | Add `slowapi` middleware, upgrade health check, register template router |
| `api/app/config.py` | Add rate limit settings |
| `web/src/components/DashboardBuilder/DashboardGrid.tsx` | Wrap widgets in ErrorBoundary |
| `web/src/components/Widgets/*.tsx` | Remove `console.log` calls |
| `api/app/routers/websocket.py` | Add tenant-level WebSocket channel |
| `api/app/services/background_tasks.py` | Fix `await session.commit()`, add digital twin updates |
| `processor/mqtt_processor.py` | Update digital twin cache on ingest |

---

## Task 1: Auth Dependency Consolidation

**Files:**
- Create: `api/app/dependencies.py`
- Create: `api/tests/test_dependencies.py`
- Modify: All 19 router files listed in the file structure above

### Subtask 1A: Create the shared dependency module

- [ ] **Step 1: Write tests for `get_current_tenant`**

Create `api/tests/test_dependencies.py`:

```python
"""Tests for centralized auth dependencies."""

import pytest
from unittest.mock import patch, MagicMock
from uuid import uuid4, UUID
from fastapi import HTTPException

from app.dependencies import get_current_tenant, get_current_user, get_management_tenant


@pytest.mark.asyncio
async def test_get_current_tenant_valid_token():
    """Valid Bearer token returns tenant UUID."""
    tenant_id = str(uuid4())
    with patch("app.dependencies.decode_token") as mock_decode:
        mock_decode.return_value = {"tenant_id": tenant_id, "sub": str(uuid4())}
        result = await get_current_tenant(authorization=f"Bearer fake-token")
        assert result == UUID(tenant_id)


@pytest.mark.asyncio
async def test_get_current_tenant_missing_header():
    """Missing Authorization header raises 401."""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_tenant(authorization=None)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_tenant_invalid_prefix():
    """Non-Bearer prefix raises 401."""
    with pytest.raises(HTTPException) as exc_info:
        await get_current_tenant(authorization="Basic abc123")
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_tenant_missing_tenant_in_token():
    """Token without tenant_id raises 401."""
    with patch("app.dependencies.decode_token") as mock_decode:
        mock_decode.return_value = {"sub": str(uuid4())}
        with pytest.raises(HTTPException) as exc_info:
            await get_current_tenant(authorization="Bearer fake-token")
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_returns_tuple():
    """get_current_user returns (tenant_id, user_id) tuple."""
    tenant_id = str(uuid4())
    user_id = str(uuid4())
    with patch("app.dependencies.decode_token") as mock_decode:
        mock_decode.return_value = {"tenant_id": tenant_id, "sub": user_id}
        result = await get_current_user(authorization="Bearer fake-token")
        assert result == (UUID(tenant_id), UUID(user_id))


@pytest.mark.asyncio
async def test_get_current_user_missing_user_id():
    """Token without sub raises 401."""
    with patch("app.dependencies.decode_token") as mock_decode:
        mock_decode.return_value = {"tenant_id": str(uuid4())}
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(authorization="Bearer fake-token")
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_management_tenant_valid():
    """Management tenant returns (tenant_id, user_id)."""
    tenant_id = str(uuid4())
    user_id = str(uuid4())
    with patch("app.dependencies.decode_token") as mock_decode:
        mock_decode.return_value = {
            "tenant_id": tenant_id,
            "sub": user_id,
            "tenant_type": "management",
        }
        result = await get_management_tenant(authorization="Bearer fake-token")
        assert result == (UUID(tenant_id), UUID(user_id))


@pytest.mark.asyncio
async def test_get_management_tenant_rejects_client():
    """Non-management tenant raises 403."""
    with patch("app.dependencies.decode_token") as mock_decode:
        mock_decode.return_value = {
            "tenant_id": str(uuid4()),
            "sub": str(uuid4()),
            "tenant_type": "client",
        }
        with pytest.raises(HTTPException) as exc_info:
            await get_management_tenant(authorization="Bearer fake-token")
        assert exc_info.value.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_dependencies.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.dependencies'`

- [ ] **Step 3: Create `api/app/dependencies.py`**

```python
"""Centralized auth dependencies for FastAPI routers.

All routers MUST import auth dependencies from this module.
Do NOT define local get_current_tenant / get_current_user in router files.
"""

from fastapi import Header, HTTPException, status
from uuid import UUID

from app.security import decode_token


async def get_current_tenant(
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token.

    Use as: current_tenant_id: Annotated[UUID, Depends(get_current_tenant)]
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")

    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )

    return UUID(tenant_id)


async def get_current_user(
    authorization: str = Header(None),
) -> tuple[UUID, UUID]:
    """Extract tenant_id AND user_id from JWT token.

    Use for user-scoped resources (dashboards, preferences).
    Returns: (tenant_id, user_id)
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    user_id = payload.get("sub")

    if not tenant_id or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id or user_id",
        )

    return UUID(tenant_id), UUID(user_id)


async def get_current_user_info(
    authorization: str = Header(None),
) -> dict:
    """Extract full user context from JWT token.

    Returns dict with user_id, tenant_id, and role.
    Use for endpoints that need role information (audit logs).
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)

    return {
        "user_id": UUID(payload.get("sub")),
        "tenant_id": UUID(payload.get("tenant_id")),
        "role": payload.get("role"),
    }


async def get_current_user_id(
    authorization: str = Header(None),
) -> UUID:
    """Extract only the user_id from JWT token.

    Use when you just need the user_id without tenant context.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    return UUID(payload["sub"])


async def get_management_tenant(
    authorization: str = Header(None),
) -> tuple[UUID, UUID]:
    """Extract tenant_id and user_id, verify tenant_type is 'management'.

    Use for admin-only endpoints (tenant management, operations dashboard).
    Returns: (tenant_id, user_id)
    Raises 403 if tenant is not a management tenant.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    user_id = payload.get("sub")
    tenant_type = payload.get("tenant_type")

    if not tenant_id or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id or user_id",
        )

    if tenant_type != "management":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only management tenants can access this resource",
        )

    return UUID(tenant_id), UUID(user_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_dependencies.py -v`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/app/dependencies.py api/tests/test_dependencies.py
git commit -m "feat: add centralized auth dependencies module"
```

### Subtask 1B: Replace all local auth functions in routers

This is a mechanical replacement across 19 files. For each router file:

1. Remove the local `get_current_tenant` (or `get_current_user` / `_get_current_tenant` / `_get_management_tenant`) function definition
2. Add `from app.dependencies import get_current_tenant` (or `get_current_user` / `get_management_tenant`)
3. Remove the now-unused `from app.security import decode_token` import if no other code uses it in that file

- [ ] **Step 1: Update routers that use `get_current_tenant` (16 files)**

Files to update (all remove local function, add import from `app.dependencies`):
- `api/app/routers/alarms.py` (line 28)
- `api/app/routers/alert_rules_unified.py` (line 39)
- `api/app/routers/analytics.py` (line 26)
- `api/app/routers/audit_logs.py` (line 20)
- `api/app/routers/commands.py` (line 37)
- `api/app/routers/devices.py` (line 24)
- `api/app/routers/device_credentials.py` (line 33)
- `api/app/routers/device_groups.py` (line 21)
- `api/app/routers/device_types.py` (line 35)
- `api/app/routers/notifications.py` (line 19)
- `api/app/routers/notification_rules.py` (line 24)
- `api/app/routers/organizations.py` (line 21)
- `api/app/routers/sites.py` (line 21)
- `api/app/routers/telemetry.py` (line 29)
- `api/app/routers/telemetry_aggregate.py` (line 23)
- `api/app/routers/users.py` (line 27)

For each file, the change is:
```python
# REMOVE this block (approx lines vary per file):
async def get_current_tenant(
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(...)
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(...)
    return UUID(tenant_id)

# ADD this import at the top:
from app.dependencies import get_current_tenant

# REMOVE (if decode_token is no longer used elsewhere in the file):
from app.security import decode_token
```

- [ ] **Step 2: Update routers using underscore-prefixed `_get_current_tenant` (3 files)**

These files use `_get_current_tenant` — rename all usages to `get_current_tenant`:
- `api/app/routers/hierarchy.py` (line 27) — remove local `_get_current_tenant`, import `get_current_tenant`, update all `Depends(_get_current_tenant)` → `Depends(get_current_tenant)`
- `api/app/routers/events.py` (line 27) — same pattern
- `api/app/routers/settings.py` (line 24) — same pattern

- [ ] **Step 3: Update dashboard routers using `get_current_user` (2 files)**

- `api/app/routers/dashboards.py` (line 30) — remove local `get_current_user`, add `from app.dependencies import get_current_user`
- `api/app/routers/dashboard_widgets.py` (line 29) — same

- [ ] **Step 3b: Update `notifications.py` (has TWO local auth functions)**

`api/app/routers/notifications.py` has:
- `get_current_tenant` (line 19) — **NOTE: this variant accepts `tenant_id: UUID` as a path parameter and does inline path-vs-token validation.** After replacement with the centralized `get_current_tenant` (which does NOT accept `tenant_id`), you MUST add `if str(tenant_id) != str(current_tenant_id): raise HTTPException(status_code=403, detail="Tenant mismatch")` to every endpoint in this file that doesn't already have it.
- `get_current_user_id` (line 50) — replace with `from app.dependencies import get_current_user_id`

- [ ] **Step 3c: Update `audit_logs.py` (has TWO local auth functions)**

`api/app/routers/audit_logs.py` has:
- `get_current_tenant` (line 20) — standard replacement
- `get_current_user` (line 43) — **NOTE: this returns a `dict` with `user_id`, `tenant_id`, `role` keys, NOT a `tuple`.** Replace with `from app.dependencies import get_current_user_info` and update any usage sites from `current_user` to `current_user_info` to avoid confusion with the tuple-returning `get_current_user`.

- [ ] **Step 4: Update firmware router (1 file)**

`api/app/routers/firmware.py` uses sync functions `_get_tenant_from_token()` and `_check_tenant()`. Replace with:
```python
from app.dependencies import get_current_tenant
```
Update all endpoint signatures to use `Depends(get_current_tenant)` instead of calling the sync helpers.

- [ ] **Step 5: Update admin router (1 file)**

`api/app/routers/admin_tenants.py` (line 36) — remove local `_get_management_tenant`, add `from app.dependencies import get_management_tenant`, update all `Depends(_get_management_tenant)` → `Depends(get_management_tenant)`.

- [ ] **Step 6: Run the full test suite to verify nothing broke**

Run: `cd api && python -m pytest tests/ -v`
Expected: All tests PASS (existing tests + new dependency tests)

- [ ] **Step 7: Commit**

```bash
git add api/app/routers/
git commit -m "refactor: consolidate auth dependencies into single module

Remove 19 duplicate get_current_tenant definitions from router files.
All routers now import from app.dependencies."
```

---

## Task 2: React Error Boundaries

**Files:**
- Create: `web/src/components/ErrorBoundary.tsx`
- Modify: `web/src/components/DashboardBuilder/DashboardGrid.tsx`

- [ ] **Step 1: Create `web/src/components/ErrorBoundary.tsx`**

```tsx
"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  widgetId?: string;
  widgetTitle?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `Widget error${this.props.widgetId ? ` [${this.props.widgetId}]` : ""}:`,
      error,
      errorInfo.componentStack
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            padding: "1rem",
            color: "var(--color-text-secondary, #6b7280)",
            textAlign: "center",
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ margin: "0.5rem 0 0.25rem", fontWeight: 500 }}>
            {this.props.widgetTitle
              ? `"${this.props.widgetTitle}" failed to load`
              : "Widget failed to load"}
          </p>
          <p style={{ fontSize: "0.75rem", margin: 0, opacity: 0.7 }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: "0.75rem",
              padding: "0.375rem 0.75rem",
              fontSize: "0.75rem",
              border: "1px solid var(--color-border, #d1d5db)",
              borderRadius: "0.375rem",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap widgets in `DashboardGrid.tsx` with ErrorBoundary**

In `web/src/components/DashboardBuilder/DashboardGrid.tsx`, add the import and wrap each widget render in the `renderWidget` function (or wherever widgets are rendered) with `<ErrorBoundary>`:

Add import at top:
```tsx
import ErrorBoundary from "../ErrorBoundary";
```

Find the section where widgets are rendered inside the grid (the `map` over `widgets` array). Wrap each widget component:

```tsx
<ErrorBoundary
  key={widget.id}
  widgetId={widget.id}
  widgetTitle={widget.title}
>
  {/* existing widget render logic */}
</ErrorBoundary>
```

The exact location varies — look for the section that does `switch (widget.widget_type)` or maps widget types to components. Wrap the entire switch/render output, NOT each individual case.

- [ ] **Step 3: Remove `console.log` calls from widget files**

Search and remove `console.log` statements from these files:
- `web/src/components/Widgets/KPICard.tsx` — 3 console.log calls
- `web/src/components/Widgets/ChartWidget.tsx` — check for console.log
- `web/src/components/Widgets/DeviceInfoWidget.tsx` — check for console.log
- `web/src/components/Widgets/MapWidget.tsx` — check for console.log

Replace with nothing (just delete the lines). These are debug logs that expose device IDs and data payloads to browser console.

- [ ] **Step 4: Verify the build passes**

Run: `cd web && npm run build`
Expected: Build completes successfully with no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ErrorBoundary.tsx web/src/components/DashboardBuilder/DashboardGrid.tsx web/src/components/Widgets/
git commit -m "feat: add error boundaries to dashboard widgets

Wrap each widget in ErrorBoundary to prevent a single widget crash
from killing the entire dashboard. Shows retry UI on failure.
Also removes console.log from production widget code."
```

---

## Task 3: Health Check Upgrade

**Files:**
- Modify: `api/app/main.py` (lines 71-74)
- Create: `api/tests/test_health.py`

- [ ] **Step 1: Write tests for upgraded health check**

Create `api/tests/test_health.py`:

```python
"""Tests for health check endpoint."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport

from app.main import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.mark.asyncio
async def test_health_check_healthy(app):
    """Health check returns healthy when all dependencies are up."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.main._check_database", new_callable=AsyncMock, return_value={"status": "ok", "latency_ms": 5}), \
             patch("app.main._check_keydb", new_callable=AsyncMock, return_value={"status": "ok", "latency_ms": 2}):
            response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "database" in data["checks"]
    assert "keydb" in data["checks"]


@pytest.mark.asyncio
async def test_health_check_degraded(app):
    """Health check returns degraded when a non-critical dependency is down."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.main._check_database", new_callable=AsyncMock, return_value={"status": "ok", "latency_ms": 5}), \
             patch("app.main._check_keydb", new_callable=AsyncMock, return_value={"status": "error", "error": "Connection refused"}):
            response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "degraded"


@pytest.mark.asyncio
async def test_health_check_unhealthy(app):
    """Health check returns 503 when database is down."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("app.main._check_database", new_callable=AsyncMock, return_value={"status": "error", "error": "Connection refused"}), \
             patch("app.main._check_keydb", new_callable=AsyncMock, return_value={"status": "ok", "latency_ms": 2}):
            response = await client.get("/api/health")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "unhealthy"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_health.py -v`
Expected: FAIL (current health check returns static response, no `_check_database` function exists)

- [ ] **Step 3: Implement the upgraded health check in `api/app/main.py`**

Replace the existing health check (lines 71-74) with:

```python
import time
import redis.asyncio as aioredis

# NOTE: Import _SessionLocal from database module. It's underscore-prefixed but
# this is the only way to get a raw session for the health check without going
# through the Depends() injection system.
from app.database import _SessionLocal

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
    try:
        start = time.monotonic()
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.aclose()
        latency = round((time.monotonic() - start) * 1000, 1)
        return {"status": "ok", "latency_ms": latency}
    except Exception as e:
        return {"status": "error", "error": str(e)}
```

Then replace the health check endpoint:

```python
@app.get("/api/health")
async def health_check():
    """Health check with dependency probing."""
    db_check = await _check_database()
    keydb_check = await _check_keydb()

    checks = {"database": db_check, "keydb": keydb_check}

    # Database down = unhealthy (critical dependency)
    if db_check["status"] != "ok":
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "checks": checks, "service": settings.APP_NAME},
        )

    # KeyDB down = degraded (non-critical — widgets still work via DB fallback)
    if keydb_check["status"] != "ok":
        return {"status": "degraded", "checks": checks, "service": settings.APP_NAME}

    return {"status": "healthy", "checks": checks, "service": settings.APP_NAME}
```

Note: Import `time` at the top of `main.py`. Import `redis.asyncio as aioredis` at the top. Import `text` from sqlalchemy if not already imported. Import `_SessionLocal` from `app.database`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_health.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/app/main.py api/tests/test_health.py
git commit -m "feat: upgrade health check to probe database and KeyDB

Returns healthy/degraded/unhealthy status with latency measurements.
Database down = 503 unhealthy. KeyDB down = 200 degraded."
```

---

## Task 4: API Rate Limiting

**Files:**
- Modify: `api/app/main.py`
- Modify: `api/app/config.py`
- Modify: `api/pyproject.toml` (add `slowapi` dependency)

- [ ] **Step 1: Add `slowapi` to dependencies**

Run: `cd api && pip install slowapi`

Then add `slowapi` to the dependencies in `api/pyproject.toml` (find the `[project.dependencies]` or `[tool.poetry.dependencies]` section and add `"slowapi>=0.1.9"`).

- [ ] **Step 2: Add rate limit settings to `api/app/config.py`**

Add these fields to the `Settings` class:

```python
# Rate limiting
RATE_LIMIT_DEFAULT: str = "60/minute"  # General API endpoints
RATE_LIMIT_AUTH: str = "5/minute"      # Login endpoint
```

- [ ] **Step 3: Create `api/app/limiter.py` (avoids circular import)**

The limiter must be in its own module because both `main.py` (middleware) and router files (decorators) need to import it. Defining it in `main.py` would create a circular import.

Create `api/app/limiter.py`:

```python
"""Rate limiter instance — import this in main.py and any router that needs custom limits."""

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
```

Then in `api/app/main.py`, in the `create_app()` function after CORS middleware:

```python
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.limiter import limiter

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

- [ ] **Step 4: Apply stricter rate limit to auth login endpoint**

In `api/app/routers/auth.py`, find the login endpoint and add the rate limit decorator:

```python
from app.limiter import limiter
from fastapi import Request

# Add to the login endpoint:
@router.post("/auth/login")
@limiter.limit("5/minute")  # This requires passing `request: Request` as first param
async def login(request: Request, ...):
    ...
```

Note: `slowapi` requires the endpoint to accept a `request: Request` parameter. Check if the login endpoint already has it; if not, add it.

- [ ] **Step 5: Verify the app starts without errors**

Run: `cd api && python -c "from app.main import app; print('OK')"`
Expected: Prints "OK" without errors

- [ ] **Step 6: Commit**

```bash
git add api/app/main.py api/app/config.py api/app/routers/auth.py api/pyproject.toml
git commit -m "feat: add API rate limiting via slowapi

60 req/min general, 5 req/min for login. Reads client IP from
X-Forwarded-For when behind proxy (TRUST_PROXY=true)."
```

---

## Task 5: Fix Async Session Commits in Background Tasks

**Files:**
- Modify: `api/app/services/background_tasks.py`

- [ ] **Step 1: Find and fix all `session.commit()` without `await`**

In `api/app/services/background_tasks.py`, search for `session.commit()` and ensure ALL are prefixed with `await`:

```python
# WRONG (sync call on async session):
session.commit()

# CORRECT:
await session.commit()
```

Check lines ~141, ~175, ~241, ~248, ~263 (approximate — read the file to find exact locations).

Also check for `session.flush()` and `session.refresh()` — these also need `await` in async context.

- [ ] **Step 2: Fix notification cleanup to actually delete old notifications**

Find the `cleanup_old_notifications` method. It currently logs but does NOT delete. Change it to actually delete notifications older than the retention period:

```python
# Replace the log-only section with actual deletion:
if old_notifications:
    for notification in old_notifications:
        await session.delete(notification)
    await session.commit()
    logger.info(f"Cleaned up {len(old_notifications)} old notifications")
```

- [ ] **Step 3: Verify the app starts and background tasks initialize**

Run: `cd api && python -c "from app.services.background_tasks import notification_background_tasks; print('OK')"`
Expected: Prints "OK"

- [ ] **Step 4: Commit**

```bash
git add api/app/services/background_tasks.py
git commit -m "fix: await async session commits in background tasks

All session.commit() calls now properly awaited. Also fix
notification cleanup to actually delete old records instead
of just logging them."
```

---

## Task 6: Digital Twin (Last-Known-Value Cache)

**Files:**
- Create: `api/app/services/digital_twin.py`
- Create: `api/tests/test_digital_twin.py`
- Modify: `processor/mqtt_processor.py`

- [ ] **Step 1: Write tests for the digital twin service**

Create `api/tests/test_digital_twin.py`:

```python
"""Tests for digital twin cache service."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import uuid4
from datetime import datetime, timezone

from app.services.digital_twin import DigitalTwinService


@pytest.fixture
def mock_redis():
    r = AsyncMock()
    r.hset = AsyncMock()
    r.hgetall = AsyncMock(return_value={})
    r.delete = AsyncMock()
    return r


@pytest.mark.asyncio
async def test_update_device_state(mock_redis):
    """update_device_state stores metrics in KeyDB hash."""
    service = DigitalTwinService(mock_redis)
    device_id = uuid4()
    metrics = {"temperature": 23.5, "humidity": 65.2}

    await service.update_device_state(device_id, metrics)

    mock_redis.hset.assert_called_once()
    call_args = mock_redis.hset.call_args
    key = call_args[0][0]
    assert str(device_id) in key


@pytest.mark.asyncio
async def test_get_device_state(mock_redis):
    """get_device_state returns cached metrics."""
    mock_redis.hgetall.return_value = {
        b"temperature": b"23.5",
        b"humidity": b"65.2",
        b"_updated_at": b"2026-03-22T10:00:00Z",
    }
    service = DigitalTwinService(mock_redis)
    device_id = uuid4()

    result = await service.get_device_state(device_id)

    assert result["temperature"] == 23.5
    assert result["humidity"] == 65.2
    assert "_updated_at" in result


@pytest.mark.asyncio
async def test_get_device_state_empty(mock_redis):
    """get_device_state returns None for unknown device."""
    mock_redis.hgetall.return_value = {}
    service = DigitalTwinService(mock_redis)

    result = await service.get_device_state(uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_get_multiple_device_states(mock_redis):
    """get_multiple_device_states returns states for multiple devices."""
    device_id_1 = uuid4()
    device_id_2 = uuid4()

    pipe = AsyncMock()
    pipe.hgetall = MagicMock(return_value=pipe)
    pipe.execute = AsyncMock(return_value=[
        {b"temperature": b"23.5", b"_updated_at": b"2026-03-22T10:00:00Z"},
        {},
    ])
    mock_redis.pipeline = MagicMock(return_value=pipe)

    service = DigitalTwinService(mock_redis)
    result = await service.get_multiple_device_states([device_id_1, device_id_2])

    assert device_id_1 in result
    assert result[device_id_1]["temperature"] == 23.5
    assert device_id_2 not in result  # Empty = not included
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_digital_twin.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create `api/app/services/digital_twin.py`**

```python
"""Digital twin service — last-known-value cache in KeyDB.

Stores the latest metric values for each device as a KeyDB hash.
Updated on every telemetry ingest. Dashboard widgets read from
cache instead of querying TimescaleDB for current values.

Key format: device:{device_id}:latest
Hash fields: metric_key → value (string), _updated_at → ISO timestamp
"""

from uuid import UUID
from datetime import datetime, timezone
from typing import Optional
import json
import logging

logger = logging.getLogger(__name__)

CACHE_KEY_PREFIX = "device"
CACHE_KEY_SUFFIX = "latest"


def _cache_key(device_id: UUID | str) -> str:
    return f"{CACHE_KEY_PREFIX}:{device_id}:{CACHE_KEY_SUFFIX}"


class DigitalTwinService:
    """Manages last-known-value cache for device telemetry."""

    def __init__(self, redis_client):
        self.redis = redis_client

    async def update_device_state(
        self,
        device_id: UUID | str,
        metrics: dict[str, float | str | dict],
        timestamp: Optional[str] = None,
    ) -> None:
        """Update cached state for a device.

        Args:
            device_id: Device UUID
            metrics: Dict of metric_key → value
            timestamp: ISO timestamp (defaults to now)
        """
        key = _cache_key(device_id)
        if timestamp is None:
            timestamp = datetime.now(timezone.utc).isoformat()

        # Flatten metrics to string values for Redis hash
        flat = {"_updated_at": timestamp}
        for metric_key, value in metrics.items():
            if isinstance(value, (dict, list)):
                flat[metric_key] = json.dumps(value)
            else:
                flat[metric_key] = str(value)

        await self.redis.hset(key, mapping=flat)

    async def get_device_state(
        self, device_id: UUID | str
    ) -> Optional[dict]:
        """Get cached state for a single device.

        Returns dict with metric values parsed back to numbers where possible,
        or None if no cached state exists.
        """
        key = _cache_key(device_id)
        raw = await self.redis.hgetall(key)

        if not raw:
            return None

        result = {}
        for k, v in raw.items():
            # Redis returns bytes
            field = k.decode() if isinstance(k, bytes) else k
            value = v.decode() if isinstance(v, bytes) else v

            if field == "_updated_at":
                result[field] = value
                continue

            # Try to parse as number
            try:
                result[field] = float(value)
            except (ValueError, TypeError):
                # Try JSON
                try:
                    result[field] = json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    result[field] = value

        return result

    async def get_multiple_device_states(
        self, device_ids: list[UUID | str]
    ) -> dict[UUID, dict]:
        """Get cached states for multiple devices using pipeline.

        Returns dict mapping device_id → state (only includes devices with cached data).
        """
        if not device_ids:
            return {}

        pipe = self.redis.pipeline()
        for device_id in device_ids:
            pipe.hgetall(_cache_key(device_id))

        results = await pipe.execute()

        states = {}
        for device_id, raw in zip(device_ids, results):
            if not raw:
                continue
            state = {}
            for k, v in raw.items():
                field = k.decode() if isinstance(k, bytes) else k
                value = v.decode() if isinstance(v, bytes) else v
                if field == "_updated_at":
                    state[field] = value
                    continue
                try:
                    state[field] = float(value)
                except (ValueError, TypeError):
                    try:
                        state[field] = json.loads(value)
                    except (json.JSONDecodeError, TypeError):
                        state[field] = value
            if isinstance(device_id, str):
                device_id = UUID(device_id)
            states[device_id] = state

        return states
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_digital_twin.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Integrate digital twin updates into MQTT processor**

In `processor/mqtt_processor.py`, find the `process_telemetry` function (or `StreamConsumer` batch insert). After telemetry is written to the stream/database, update the digital twin cache:

```python
# After XADD or after batch insert, add:
from app.services.digital_twin import DigitalTwinService

# In the telemetry processing path:
twin_service = DigitalTwinService(redis_client)
await twin_service.update_device_state(device_id, metrics, timestamp)
```

Read `processor/mqtt_processor.py` first to understand exactly where this fits. The update should happen after `XADD telemetry:ingest` (in the fast path), NOT after the batch DB insert (which is async/delayed).

- [ ] **Step 6: Add a telemetry endpoint that reads from digital twin**

Add a new endpoint to `api/app/routers/telemetry.py`:

```python
@router.get("/tenants/{tenant_id}/devices/{device_id}/telemetry/latest")
async def get_latest_telemetry(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant_id: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get latest telemetry from digital twin cache (instant, no DB query)."""
    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    await session.set_tenant_context(tenant_id)

    # Verify device belongs to tenant (RLS handles this)
    device = await session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Read from cache — use app.state.redis (set during lifespan startup in main.py)
    # NOTE: You must add Redis client initialization to main.py lifespan:
    #   import redis.asyncio as aioredis
    #   app.state.redis = aioredis.from_url(settings.REDIS_URL)
    # And cleanup on shutdown:
    #   await app.state.redis.aclose()
    from app.services.digital_twin import DigitalTwinService
    from fastapi import Request

    # Add `request: Request` param to the endpoint signature, then:
    twin = DigitalTwinService(request.app.state.redis)
    state = await twin.get_device_state(device_id)

    if not state:
        return {"device_id": str(device_id), "metrics": {}, "cached": False}

    updated_at = state.pop("_updated_at", None)
    return {
        "device_id": str(device_id),
        "metrics": state,
        "updated_at": updated_at,
        "cached": True,
    }
```

- [ ] **Step 7: Commit**

```bash
git add api/app/services/digital_twin.py api/tests/test_digital_twin.py api/app/routers/telemetry.py processor/mqtt_processor.py
git commit -m "feat: add digital twin cache for instant telemetry reads

Stores last-known values per device in KeyDB hash. Updated on
every MQTT ingest. New /telemetry/latest endpoint reads from
cache instead of TimescaleDB."
```

---

## Task 7: Dashboard WebSocket (Tenant-Level)

**Files:**
- Modify: `api/app/routers/websocket.py`
- Create: `web/src/hooks/useDashboardWebSocket.ts`
- Modify: `web/src/components/Widgets/KPICard.tsx` (and other widgets — pattern shown once)
- Modify: `web/src/components/DashboardBuilder/DashboardGrid.tsx`

- [ ] **Step 0: Fix existing `verify_token` bug in websocket.py**

`api/app/routers/websocket.py` line 196 calls `verify_token` from `app.security`, but that function does not exist — only `decode_token` exists. This is a latent bug. Fix it:

```python
# Line 196 — CHANGE:
from app.security import verify_token
# TO:
from app.security import decode_token

# Line 198 — CHANGE:
payload = verify_token(token)
# TO:
payload = decode_token(token)
```

- [ ] **Step 1: Add tenant-level WebSocket endpoint to backend**

In `api/app/routers/websocket.py`, add a new endpoint alongside the existing per-device one. Ensure `import asyncio` is present at the top of the file (it likely already is):

```python
@router.websocket("/ws/tenants/{tenant_id}/telemetry")
async def websocket_tenant_telemetry(
    websocket: WebSocket,
    tenant_id: str,
    token: str = Query(None),
):
    """Tenant-level WebSocket — multiplexes ALL device telemetry for a tenant.

    Subscribes to telemetry:{tenant_id}:* pattern and forwards all device
    updates on a single connection. Dashboard widgets use this instead of polling.
    """
    # Validate token
    try:
        payload = _validate_websocket_token(token)
        token_tenant_id = payload.get("tenant_id")
        if str(token_tenant_id) != str(tenant_id):
            await websocket.close(code=4003, reason="Tenant mismatch")
            return
    except Exception:
        await websocket.close(code=4001, reason="Invalid token")
        return

    await websocket.accept()

    # Subscribe to tenant-wide telemetry pattern
    import redis.asyncio as aioredis
    from app.config import get_settings
    settings = get_settings()

    r = aioredis.from_url(settings.REDIS_URL)
    pubsub = r.pubsub()
    await pubsub.psubscribe(f"telemetry:{tenant_id}:*")
    await pubsub.psubscribe(f"alerts:{tenant_id}:*")

    disconnect_event = asyncio.Event()

    async def redis_to_ws():
        """Forward Redis pub/sub messages to WebSocket."""
        try:
            while not disconnect_event.is_set():
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=0.1
                )
                if message and message["type"] == "pmessage":
                    channel = message["channel"]
                    if isinstance(channel, bytes):
                        channel = channel.decode()
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode()

                    # Extract device_id from channel: telemetry:{tenant_id}:{device_id}
                    parts = channel.split(":")
                    msg_type = parts[0]  # "telemetry" or "alerts"
                    device_id = parts[2] if len(parts) > 2 else "unknown"

                    try:
                        import json
                        parsed = json.loads(data)
                    except Exception:
                        parsed = data

                    await websocket.send_json({
                        "type": msg_type,
                        "device_id": device_id,
                        "data": parsed,
                    })
        except Exception:
            disconnect_event.set()

    async def ws_to_handler():
        """Handle incoming WebSocket messages (ping/pong)."""
        try:
            while not disconnect_event.is_set():
                try:
                    msg = await asyncio.wait_for(
                        websocket.receive_text(), timeout=1.0
                    )
                    import json
                    parsed = json.loads(msg)
                    if parsed.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except asyncio.TimeoutError:
                    continue
        except Exception:
            disconnect_event.set()

    try:
        await asyncio.gather(redis_to_ws(), ws_to_handler())
    finally:
        await pubsub.punsubscribe()
        await pubsub.aclose()
        await r.aclose()
        try:
            await websocket.close()
        except Exception:
            pass
```

- [ ] **Step 2: Create `web/src/hooks/useDashboardWebSocket.ts`**

```typescript
import { useEffect, useRef, useCallback, useState } from "react";

export interface DashboardTelemetryUpdate {
  type: "telemetry";
  device_id: string;
  data: Record<string, any>;
}

export interface DashboardAlertUpdate {
  type: "alerts";
  device_id: string;
  data: Record<string, any>;
}

export type DashboardWebSocketMessage =
  | DashboardTelemetryUpdate
  | DashboardAlertUpdate;

interface UseDashboardWebSocketOptions {
  tenantId: string;
  token: string;
  enabled?: boolean;
  onMessage?: (msg: DashboardWebSocketMessage) => void;
}

/**
 * Tenant-level WebSocket hook for dashboard widgets.
 * Subscribes to all device telemetry for the tenant on a single connection.
 * Widgets register their device_id interest and receive filtered updates.
 */
export function useDashboardWebSocket({
  tenantId,
  token,
  enabled = true,
  onMessage,
}: UseDashboardWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxReconnectAttempts = 10;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  // Use ref for connect to avoid stale closure in setTimeout
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!tenantId || !token || !enabled) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/v1/ws/tenants/${tenantId}/telemetry?token=${token}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as DashboardWebSocketMessage;
        onMessageRef.current?.(msg);
      } catch {
        // Ignore unparseable messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;

      // Auto-reconnect with exponential backoff (use ref to avoid stale closure)
      if (enabled && reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttempts.current),
          30000
        );
        reconnectAttempts.current++;
        reconnectTimer.current = setTimeout(() => connectRef.current(), delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [tenantId, token, enabled]);

  // Keep connectRef in sync with latest connect function
  connectRef.current = connect;

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  // Ping every 30s to keep connection alive
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      wsRef.current?.send(JSON.stringify({ type: "ping" }));
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected]);

  return { isConnected };
}
```

- [ ] **Step 3: Wire dashboard WebSocket into `DashboardGrid.tsx`**

In `web/src/components/DashboardBuilder/DashboardGrid.tsx`:

1. Import the new hook:
```typescript
import { useDashboardWebSocket, DashboardWebSocketMessage } from "../../hooks/useDashboardWebSocket";
```

2. Add state to track real-time updates per device:
```typescript
const [realtimeData, setRealtimeData] = useState<Record<string, Record<string, any>>>({});
```

3. Get tenant ID and token from auth context, connect WebSocket:
```typescript
// Get from auth context or localStorage (match existing pattern in the codebase)
const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") || "" : "";
const tenantId = token ? (() => { try { return JSON.parse(atob(token.split(".")[1])).tenant_id; } catch { return ""; } })() : "";

const handleWsMessage = useCallback((msg: DashboardWebSocketMessage) => {
  if (msg.type === "telemetry") {
    setRealtimeData((prev) => ({
      ...prev,
      [msg.device_id]: { ...prev[msg.device_id], ...msg.data, _ts: Date.now() },
    }));
  }
}, []);

const { isConnected } = useDashboardWebSocket({
  tenantId,
  token,
  enabled: !isEditMode,
  onMessage: handleWsMessage,
});
```

4. Pass `realtimeData` to each widget as an optional prop so widgets can use it for instant updates instead of polling.

- [ ] **Step 4: Update one widget (KPICard) as the pattern for WebSocket integration**

In `web/src/components/Widgets/KPICard.tsx`, add an optional `realtimeData` prop:

```typescript
interface KPICardProps {
  // ... existing props
  realtimeData?: Record<string, any>;  // From dashboard WebSocket
}
```

Inside the component, when `realtimeData` has a fresh value for the widget's bound metric, use it immediately instead of waiting for the next poll cycle. Keep the polling interval as fallback for when WebSocket disconnects.

```typescript
// If realtimeData has a value for our device+metric, use it
useEffect(() => {
  if (realtimeData && boundDeviceId && metric) {
    const value = realtimeData[metric];
    if (value !== undefined) {
      setCurrentValue(value);
    }
  }
}, [realtimeData, boundDeviceId, metric]);
```

- [ ] **Step 5: Verify frontend build passes**

Run: `cd web && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add api/app/routers/websocket.py web/src/hooks/useDashboardWebSocket.ts web/src/components/DashboardBuilder/DashboardGrid.tsx web/src/components/Widgets/KPICard.tsx
git commit -m "feat: add tenant-level WebSocket for real-time dashboard widgets

Single WebSocket connection per dashboard multiplexes all device
telemetry. KPICard updated as reference pattern — other widgets
can follow the same pattern for instant updates."
```

---

## Task 8: Water Monitoring Template

**Files:**
- Create: `api/alembic/versions/013_solution_templates.py`
- Create: `api/app/services/solution_templates.py`
- Create: `api/app/routers/solution_templates.py`
- Create: `api/app/schemas/solution_template.py`
- Create: `api/tests/test_solution_templates.py`
- Modify: `api/app/main.py` (register template router)

**Note:** The original `solution_templates` table was dropped in migration 004. We are creating a new, simpler template system — not restoring the old one.

### Subtask 8A: Database migration for templates table

- [ ] **Step 1: Create migration `api/alembic/versions/013_solution_templates.py`**

```python
"""Re-create solution_templates table for industry vertical templates.

Revision ID: 013_solution_templates
Revises: 012_command_schema
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "013_solution_templates"
down_revision = "012_command_schema"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS solution_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(200) NOT NULL,
            slug VARCHAR(100) NOT NULL UNIQUE,
            description TEXT,
            industry VARCHAR(100) NOT NULL,
            icon VARCHAR(50),
            device_types JSONB NOT NULL DEFAULT '[]',
            dashboard_config JSONB NOT NULL DEFAULT '{}',
            alert_rules JSONB NOT NULL DEFAULT '[]',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- No RLS on solution_templates — they are global/shared
        COMMENT ON TABLE solution_templates IS 'Industry vertical templates (global, no RLS)';
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS solution_templates;")
```

- [ ] **Step 2: Run migration locally**

Run: `cd api && alembic upgrade head`
Expected: Migration applies successfully

- [ ] **Step 3: Commit**

```bash
git add api/alembic/versions/013_solution_templates.py
git commit -m "feat: add solution_templates migration for industry verticals"
```

### Subtask 8B: Template service and API

- [ ] **Step 4: Create Pydantic schemas `api/app/schemas/solution_template.py`**

```python
"""Pydantic schemas for solution templates."""

from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class DeviceTypeTemplate(BaseModel):
    name: str
    description: Optional[str] = None
    telemetry_schema: dict


class WidgetTemplate(BaseModel):
    widget_type: str
    title: str
    position_x: int
    position_y: int
    width: int
    height: int
    configuration: dict
    data_sources: list[dict] = []


class DashboardTemplate(BaseModel):
    name: str
    description: Optional[str] = None
    widgets: list[WidgetTemplate]


class AlertRuleTemplate(BaseModel):
    name: str
    description: Optional[str] = None
    rule_type: str = "threshold"
    metric_key: str
    operator: str
    threshold: float
    severity: str
    message: str
    duration_seconds: Optional[int] = None


class SolutionTemplateResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    description: Optional[str]
    industry: str
    icon: Optional[str]
    device_types: list[DeviceTypeTemplate]
    dashboard_config: DashboardTemplate
    alert_rules: list[AlertRuleTemplate]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SolutionTemplateListResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    description: Optional[str]
    industry: str
    icon: Optional[str]
    is_active: bool


class ApplyTemplateRequest(BaseModel):
    dashboard_name: Optional[str] = None
    create_demo_devices: bool = False
```

- [ ] **Step 5: Create template service `api/app/services/solution_templates.py`**

```python
"""Solution template service — applies industry templates to create
dashboards, device types, and alert rules for a tenant."""

from uuid import UUID
from sqlalchemy import text
import json
import logging

from app.database import RLSSession
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.device_type import DeviceType

logger = logging.getLogger(__name__)


class TemplateService:
    """Applies solution templates to tenant accounts."""

    def __init__(self, session: RLSSession):
        self.session = session

    async def get_template(self, template_id: UUID) -> dict | None:
        """Get a template by ID (no RLS — templates are global)."""
        result = await self.session.execute(
            text("SELECT * FROM solution_templates WHERE id = :id AND is_active = true"),
            {"id": str(template_id)},
        )
        row = result.mappings().first()
        return dict(row) if row else None

    async def get_template_by_slug(self, slug: str) -> dict | None:
        """Get a template by slug."""
        result = await self.session.execute(
            text("SELECT * FROM solution_templates WHERE slug = :slug AND is_active = true"),
            {"slug": slug},
        )
        row = result.mappings().first()
        return dict(row) if row else None

    async def list_templates(self, industry: str | None = None) -> list[dict]:
        """List all active templates, optionally filtered by industry."""
        if industry:
            result = await self.session.execute(
                text("SELECT id, name, slug, description, industry, icon, is_active FROM solution_templates WHERE is_active = true AND industry = :industry ORDER BY name"),
                {"industry": industry},
            )
        else:
            result = await self.session.execute(
                text("SELECT id, name, slug, description, industry, icon, is_active FROM solution_templates WHERE is_active = true ORDER BY name"),
            )
        return [dict(row) for row in result.mappings().all()]

    async def apply_template(
        self,
        template: dict,
        tenant_id: UUID,
        user_id: UUID,
        dashboard_name: str | None = None,
    ) -> Dashboard:
        """Apply a template: create device types, dashboard with widgets, and alert rules.

        Args:
            template: Template dict from database
            tenant_id: Target tenant
            user_id: User who will own the dashboard
            dashboard_name: Override for dashboard name

        Returns:
            Created Dashboard object
        """
        dashboard_config = template["dashboard_config"]
        if isinstance(dashboard_config, str):
            dashboard_config = json.loads(dashboard_config)

        # 1. Create device types (skip if they already exist by name)
        device_types_config = template.get("device_types", [])
        if isinstance(device_types_config, str):
            device_types_config = json.loads(device_types_config)

        for dt_config in device_types_config:
            existing = await self.session.execute(
                text("SELECT id FROM device_types WHERE tenant_id = :tid AND name = :name"),
                {"tid": str(tenant_id), "name": dt_config["name"]},
            )
            if not existing.first():
                device_type = DeviceType(
                    tenant_id=tenant_id,
                    name=dt_config["name"],
                    description=dt_config.get("description", ""),
                    telemetry_schema=dt_config.get("telemetry_schema", {}),
                )
                self.session.add(device_type)

        # 2. Create dashboard
        name = dashboard_name or dashboard_config.get("name", template["name"])
        dashboard = Dashboard(
            tenant_id=tenant_id,
            user_id=user_id,
            name=name,
            description=dashboard_config.get("description", f"Created from {template['name']} template"),
        )
        self.session.add(dashboard)
        await self.session.flush()  # Get dashboard.id

        # 3. Create widgets
        widgets_config = dashboard_config.get("widgets", [])
        for w in widgets_config:
            widget = DashboardWidget(
                dashboard_id=dashboard.id,
                tenant_id=tenant_id,
                widget_type=w["widget_type"],
                title=w["title"],
                position_x=w.get("position_x", 0),
                position_y=w.get("position_y", 0),
                width=w.get("width", 4),
                height=w.get("height", 3),
                configuration=w.get("configuration", {}),
                data_sources=w.get("data_sources", []),
            )
            self.session.add(widget)

        # 4. Create alert rules (if any)
        alert_rules_config = template.get("alert_rules", [])
        if isinstance(alert_rules_config, str):
            alert_rules_config = json.loads(alert_rules_config)

        for rule in alert_rules_config:
            # NOTE: The alert_rules table uses column names: `metric` (not metric_key),
            # `active` (not enabled). See api/app/models/unified_alert_rule.py.
            await self.session.execute(
                text("""
                    INSERT INTO alert_rules (tenant_id, name, description, rule_type, metric,
                        operator, threshold, severity, message, duration_seconds, active)
                    VALUES (:tid, :name, :desc, :rule_type, :metric, :op, :threshold,
                        :severity, :message, :duration, true)
                """),
                {
                    "tid": str(tenant_id),
                    "name": rule["name"],
                    "desc": rule.get("description", ""),
                    "rule_type": rule.get("rule_type", "threshold"),
                    "metric": rule["metric_key"],
                    "op": rule["operator"],
                    "threshold": rule["threshold"],
                    "severity": rule["severity"],
                    "message": rule["message"],
                    "duration": rule.get("duration_seconds"),
                },
            )

        await self.session.commit()
        return dashboard
```

- [ ] **Step 6: Create router `api/app/routers/solution_templates.py`**

```python
"""Solution template routes — list and apply industry templates."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
import logging

from app.database import get_session, RLSSession
from app.dependencies import get_current_user
from app.services.solution_templates import TemplateService
from app.schemas.solution_template import (
    SolutionTemplateListResponse,
    SolutionTemplateResponse,
    ApplyTemplateRequest,
)
from app.schemas.dashboard import DashboardResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tenants/{tenant_id}/solution-templates",
    tags=["solution-templates"],
)


@router.get("", response_model=list[SolutionTemplateListResponse])
async def list_templates(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
    industry: Optional[str] = Query(None, description="Filter by industry"),
):
    """List all available solution templates."""
    current_tenant_id, _ = current_user
    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    service = TemplateService(session)
    templates = await service.list_templates(industry=industry)
    return templates


@router.get("/{template_id}", response_model=SolutionTemplateResponse)
async def get_template(
    tenant_id: UUID,
    template_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Get template details."""
    current_tenant_id, _ = current_user
    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    service = TemplateService(session)
    template = await service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.post("/{template_id}/apply")
async def apply_template(
    tenant_id: UUID,
    template_id: UUID,
    body: ApplyTemplateRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_user: Annotated[tuple[UUID, UUID], Depends(get_current_user)],
):
    """Apply a template — creates device types, dashboard, and alert rules."""
    current_tenant_id, current_user_id = current_user
    if str(tenant_id) != str(current_tenant_id):
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    # Fetch template BEFORE setting tenant context — solution_templates has no RLS,
    # and setting context first would be fragile if RLS is added later.
    service = TemplateService(session)
    template = await service.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Now set tenant context for creating tenant-scoped resources
    await session.set_tenant_context(tenant_id, current_user_id)

    dashboard = await service.apply_template(
        template=template,
        tenant_id=tenant_id,
        user_id=current_user_id,
        dashboard_name=body.dashboard_name,
    )

    return {
        "message": f"Template '{template['name']}' applied successfully",
        "dashboard_id": str(dashboard.id),
    }
```

- [ ] **Step 7: Register template router in `api/app/main.py`**

Add to the router imports and registration:

```python
from app.routers import solution_templates as solution_templates_router
app.include_router(solution_templates_router.router, prefix="/api/v1")
```

- [ ] **Step 8: Commit**

```bash
git add api/app/schemas/solution_template.py api/app/services/solution_templates.py api/app/routers/solution_templates.py api/app/main.py
git commit -m "feat: add solution template system for industry verticals

Templates create device types, dashboards with widgets, and alert
rules in a single apply action. No RLS on templates (global)."
```

### Subtask 8C: Seed the Water Monitoring template

- [ ] **Step 9: Add Water template seed data**

Create a seed script or add to the migration. The simplest approach is a SQL INSERT in the migration file `013_solution_templates.py` (append to the `upgrade()` function):

```python
    # Seed Water Monitoring template
    op.execute("""
        INSERT INTO solution_templates (name, slug, description, industry, icon, device_types, dashboard_config, alert_rules)
        VALUES (
            'Water Monitoring',
            'water-monitoring',
            'Complete water infrastructure monitoring — tank levels, flow rates, pressure, and quality. Includes leak detection and low-level alerts.',
            'Water & Utilities',
            'droplets',
            '[
                {
                    "name": "Water Level Sensor",
                    "description": "Ultrasonic water tank level sensor",
                    "telemetry_schema": {
                        "level_percent": {"type": "number", "unit": "%", "min": 0, "max": 100},
                        "level_cm": {"type": "number", "unit": "cm", "min": 0, "max": 500},
                        "volume_liters": {"type": "number", "unit": "L", "min": 0}
                    }
                },
                {
                    "name": "Flow Meter",
                    "description": "Water flow rate and totalizer",
                    "telemetry_schema": {
                        "flow_rate_m3h": {"type": "number", "unit": "m³/hr", "min": 0},
                        "total_flow_m3": {"type": "number", "unit": "m³", "min": 0}
                    }
                },
                {
                    "name": "Pressure Sensor",
                    "description": "Pipe pressure sensor",
                    "telemetry_schema": {
                        "pressure_kpa": {"type": "number", "unit": "kPa", "min": 0, "max": 1000}
                    }
                },
                {
                    "name": "Water Quality Sensor",
                    "description": "pH and turbidity monitoring",
                    "telemetry_schema": {
                        "ph": {"type": "number", "unit": "pH", "min": 0, "max": 14},
                        "turbidity_ntu": {"type": "number", "unit": "NTU", "min": 0}
                    }
                }
            ]'::jsonb,
            '{
                "name": "Water Monitoring Dashboard",
                "description": "Real-time water infrastructure monitoring",
                "widgets": [
                    {"widget_type": "kpi_card", "title": "Tank Level", "position_x": 0, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "level_percent", "unit": "%", "warning_threshold": 20, "critical_threshold": 10, "trend_period": "24h"}, "data_sources": []},
                    {"widget_type": "kpi_card", "title": "Daily Consumption", "position_x": 3, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "total_flow_m3", "unit": "m³", "trend_period": "24h"}, "data_sources": []},
                    {"widget_type": "kpi_card", "title": "Flow Rate", "position_x": 6, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "flow_rate_m3h", "unit": "m³/hr", "trend_period": "1h"}, "data_sources": []},
                    {"widget_type": "kpi_card", "title": "Pressure", "position_x": 9, "position_y": 0, "width": 3, "height": 2, "configuration": {"metric": "pressure_kpa", "unit": "kPa", "trend_period": "1h"}, "data_sources": []},
                    {"widget_type": "chart", "title": "Tank Level Over Time", "position_x": 0, "position_y": 2, "width": 6, "height": 4, "configuration": {"chart_type": "area", "metrics": ["level_percent"], "time_range": "24h", "unit": "%"}, "data_sources": []},
                    {"widget_type": "chart", "title": "Flow Rate: Inlet vs Outlet", "position_x": 6, "position_y": 2, "width": 6, "height": 4, "configuration": {"chart_type": "line", "metrics": ["flow_rate_m3h"], "time_range": "24h", "unit": "m³/hr"}, "data_sources": []},
                    {"widget_type": "gauge", "title": "Tank Level", "position_x": 0, "position_y": 6, "width": 4, "height": 3, "configuration": {"metric": "level_percent", "unit": "%", "min": 0, "max": 100, "warning_threshold": 20, "critical_threshold": 10}, "data_sources": []},
                    {"widget_type": "status_matrix", "title": "Pump & Valve Status", "position_x": 4, "position_y": 6, "width": 4, "height": 3, "configuration": {}, "data_sources": []},
                    {"widget_type": "alarm_summary", "title": "Water System Alarms", "position_x": 0, "position_y": 9, "width": 12, "height": 3, "configuration": {"page_size": 50}, "data_sources": []}
                ]
            }'::jsonb,
            '[
                {"name": "Tank Level Low", "metric_key": "level_percent", "operator": "<", "threshold": 20, "severity": "WARNING", "message": "Tank level low", "duration_seconds": null},
                {"name": "Tank Level Critical", "metric_key": "level_percent", "operator": "<", "threshold": 10, "severity": "CRITICAL", "message": "Tank level critical", "duration_seconds": null},
                {"name": "Possible Leak", "metric_key": "flow_rate_m3h", "operator": ">", "threshold": 0, "severity": "CRITICAL", "message": "Possible leak detected — outlet flow exceeds inlet", "duration_seconds": 1800},
                {"name": "Sensor Offline", "metric_key": "_no_data", "operator": "no_data", "threshold": 900, "severity": "WARNING", "message": "Sensor offline — no data for 15 minutes", "duration_seconds": null}
            ]'::jsonb
        )
        ON CONFLICT (slug) DO NOTHING;
    """)
```

- [ ] **Step 10: Run migration to apply seed**

Run: `cd api && alembic upgrade head`
Expected: Template seeded into `solution_templates` table

- [ ] **Step 11: Test the template apply endpoint manually**

Run: `cd api && python -m uvicorn app.main:app --port 8000`

Then test (adjust UUIDs for your local setup):
```bash
# List templates
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/tenants/$TENANT_ID/solution-templates

# Apply template
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dashboard_name": "My Water Dashboard"}' \
  http://localhost:8000/api/v1/tenants/$TENANT_ID/solution-templates/$TEMPLATE_ID/apply
```

- [ ] **Step 12: Commit**

```bash
git add api/alembic/versions/013_solution_templates.py
git commit -m "feat: seed Water Monitoring template with dashboard and alert rules

Includes 4 device types (level, flow, pressure, quality),
9-widget dashboard layout, and 4 pre-configured alert rules
(low level, critical level, leak detection, sensor offline)."
```

---

## Task Dependency Summary

```
Task 1 (Auth consolidation)     ─── independent
Task 2 (Error boundaries)       ─── independent
Task 3 (Health check)           ─── independent
Task 4 (Rate limiting)          ─── independent
Task 5 (Fix async commits)      ─── independent
Task 6 (Digital twin)           ─── independent
Task 7 (Dashboard WebSocket)    ─── depends on Task 6 (uses digital twin for initial state)
Task 8 (Water template)         ─── independent (can run in parallel with 1-6)
```

Tasks 1-6 and 8 can be executed in parallel. Task 7 should run after Task 6.
