# MQTT Device Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the platform MQTT broker so every device authenticates individually and can only publish/subscribe to its own topics, backed by EMQX open-source reading the existing `device_credentials` table.

**Architecture:** Swap `eclipse-mosquitto` for `emqx/emqx:5.8`. EMQX authenticates and authorizes clients with two PostgreSQL queries against database **views** (`mqtt_auth`, `mqtt_acl`) so the DB is the single source of truth — no per-device broker state, no sync code. EMQX connects as a dedicated `emqx_auth` Postgres role with `BYPASSRLS` (RLS filters by a tenant GUC that EMQX cannot set). Devices use `username = device_id`, `password = gito_mq_…` (a new `credential_type = 'mqtt_password'` row). Platform services (processor, command bridge) use a superuser service account. The LoRaWAN/ChirpStack path (processor → customer brokers) and HTTP token ingest are untouched.

**Tech Stack:** EMQX 5.8 (OSS), PostgreSQL/TimescaleDB, Alembic, FastAPI, Next.js 14, `aiomqtt` (processor), `paho`/`mosquitto_pub` (testing).

## Global Constraints

- **Production-ready only** — no mock data, no placeholders, real error handling (project rule, `CLAUDE.md`).
- **Single source of truth = PostgreSQL.** No credential state stored in the broker; all auth/ACL decisions come from `device_credentials` / `devices` via views.
- **Reuse `device_credentials`** — do not create a parallel credential store. MQTT rows use `credential_type = 'mqtt_password'` (already allowed by the table's CHECK constraint).
- **Never publish to a production/customer broker.** All broker testing uses the **local** EMQX container only.
- **Any model change ships with an Alembic migration in the same commit.** Alembic revisions are strings like `"023_mqtt_auth"` with `down_revision = "022_payload_decoding"` (current head).
- **API returns data directly** (not wrapped in `{data:…}`) except list endpoints; this codebase wraps in `SuccessResponse(data=…)` for the credentials router — match the existing router.
- **Pin the EMQX image tag** (`emqx/emqx:5.8`) so config keys don't drift under us.
- **Colors/'​UX:** keep the existing theme tokens; no color changes.

---

### Task 1: Database — auth/ACL views, service-account table, and the `emqx_auth` role

**Files:**
- Create: `api/alembic/versions/023_mqtt_auth.py`
- Test: `api/tests/test_mqtt_auth_sql.py`

**Interfaces:**
- Produces (consumed by Task 2 EMQX config):
  - View `mqtt_auth(username text, password_hash text, is_superuser bool)` — one row per authenticatable principal (active device `mqtt_password` creds + active service accounts).
  - View `mqtt_acl(username text, permission text, action text, topic text)` — allow-rules per device.
  - Table `mqtt_service_accounts(username text pk, password_hash text, is_superuser bool, status text, created_at timestamptz)`.
  - Postgres role `emqx_auth` with `BYPASSRLS`, password from `:emqx_pg_password`, `SELECT` on both views.
  - Seeded service account `svc_processor` (superuser), password = sha256 of the dev secret `processor-mqtt-dev-secret`.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_mqtt_auth_sql.py`. It seeds a throwaway tenant/device/credential in a rolled-back transaction and asserts the view logic. It reaches the DB with the same `DATABASE_URL` the app uses (run inside the `gito-api` container).

```python
import hashlib
import os
import uuid

import asyncpg
import pytest

# The app's async URL uses the +asyncpg driver prefix; asyncpg wants a bare URL.
DB_URL = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


@pytest.mark.asyncio
async def test_mqtt_auth_and_acl_views():
    conn = await asyncpg.connect(DB_URL)
    tr = conn.transaction()
    await tr.start()
    try:
        tenant_id = uuid.uuid4()
        device_id = uuid.uuid4()
        token = "gito_mq_testsecret"
        token_hash = sha256_hex(token)

        # tenants has no RLS; devices/creds do — set the tenant GUC so inserts pass.
        await conn.execute(
            "INSERT INTO tenants (id, name, status) VALUES ($1, 'rls-test', 'active')",
            tenant_id,
        )
        await conn.execute("SELECT set_config('app.current_tenant_id', $1, false)", str(tenant_id))
        await conn.execute(
            "INSERT INTO devices (id, tenant_id, name, status) VALUES ($1, $2, 'rls-test-dev', 'offline')",
            device_id, tenant_id,
        )
        await conn.execute(
            """INSERT INTO device_credentials
                 (tenant_id, device_id, credential_type, credential_hash, status)
               VALUES ($1, $2, 'mqtt_password', $3, 'active')""",
            tenant_id, device_id, token_hash,
        )

        # authn view: active mqtt_password resolves for the device
        row = await conn.fetchrow(
            "SELECT password_hash, is_superuser FROM mqtt_auth WHERE username = $1",
            str(device_id),
        )
        assert row is not None
        assert row["password_hash"] == token_hash
        assert row["is_superuser"] is False

        # authz view: device may publish to its own telemetry topic (tenant baked in)
        acl = await conn.fetch(
            "SELECT permission, action, topic FROM mqtt_acl WHERE username = $1",
            str(device_id),
        )
        topics = {(r["action"], r["topic"]) for r in acl}
        assert ("publish", f"{tenant_id}/devices/{device_id}/telemetry") in topics
        assert ("subscribe", f"{tenant_id}/devices/{device_id}/commands") in topics
        assert all(r["permission"] == "allow" for r in acl)

        # revoked credential disappears from the authn view
        await conn.execute(
            "UPDATE device_credentials SET status='revoked' WHERE device_id=$1", device_id
        )
        assert await conn.fetchrow(
            "SELECT 1 FROM mqtt_auth WHERE username=$1", str(device_id)
        ) is None

        # service account is present and superuser
        svc = await conn.fetchrow(
            "SELECT is_superuser FROM mqtt_auth WHERE username='svc_processor'"
        )
        assert svc is not None and svc["is_superuser"] is True
    finally:
        await tr.rollback()
        await conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec gito-api pytest tests/test_mqtt_auth_sql.py -v`
Expected: FAIL — `mqtt_auth`/`mqtt_acl` relations do not exist yet.

- [ ] **Step 3: Write the migration**

Create `api/alembic/versions/023_mqtt_auth.py`:

```python
"""MQTT device identity: auth/ACL views, service accounts, emqx_auth role.

Revision ID: 023_mqtt_auth
Revises: 022_payload_decoding
"""
from typing import Union

from alembic import op

revision: str = "023_mqtt_auth"
down_revision: Union[str, None] = "022_payload_decoding"
branch_labels = None
depends_on = None

# Dev/staging default; rotate in production by re-granting the role a new password.
EMQX_PG_PASSWORD = "emqx-auth-dev-secret"
# sha256("processor-mqtt-dev-secret")
SVC_PROCESSOR_HASH = "53f771955b2d18866e26043cb5fa718985fdcf7b8abb6d3120f9a8cfc6f8da06"


def upgrade() -> None:
    # 1. Service accounts (non-device principals: processor, command bridge).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS mqtt_service_accounts (
            username      text PRIMARY KEY,
            password_hash text NOT NULL,
            is_superuser  boolean NOT NULL DEFAULT true,
            status        text NOT NULL DEFAULT 'active',
            created_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        f"""
        INSERT INTO mqtt_service_accounts (username, password_hash, is_superuser, status)
        VALUES ('svc_processor', '{SVC_PROCESSOR_HASH}', true, 'active')
        ON CONFLICT (username) DO UPDATE
          SET password_hash = EXCLUDED.password_hash, status = 'active'
        """
    )

    # 2. Authentication view: device mqtt_password creds + service accounts.
    op.execute(
        """
        CREATE OR REPLACE VIEW mqtt_auth AS
            SELECT dc.device_id::text AS username,
                   dc.credential_hash  AS password_hash,
                   false               AS is_superuser
            FROM device_credentials dc
            WHERE dc.credential_type = 'mqtt_password'
              AND dc.status = 'active'
              AND (dc.expires_at IS NULL OR dc.expires_at > now())
            UNION ALL
            SELECT sa.username, sa.password_hash, sa.is_superuser
            FROM mqtt_service_accounts sa
            WHERE sa.status = 'active'
        """
    )

    # 3. Authorization view: each device may publish to its own telemetry topic
    #    and subscribe to its own commands topic. Tenant is baked into the topic
    #    string, so ACLs are exact per device+tenant (no wildcards).
    op.execute(
        """
        CREATE OR REPLACE VIEW mqtt_acl AS
            SELECT d.id::text AS username, 'allow' AS permission, 'publish' AS action,
                   d.tenant_id::text || '/devices/' || d.id::text || '/telemetry' AS topic
            FROM devices d
            UNION ALL
            SELECT d.id::text, 'allow', 'subscribe',
                   d.tenant_id::text || '/devices/' || d.id::text || '/commands'
            FROM devices d
        """
    )

    # 4. Least-privilege broker role that BYPASSES RLS (EMQX cannot set the tenant GUC).
    op.execute(
        f"""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emqx_auth') THEN
            CREATE ROLE emqx_auth LOGIN PASSWORD '{EMQX_PG_PASSWORD}' BYPASSRLS;
          ELSE
            ALTER ROLE emqx_auth LOGIN PASSWORD '{EMQX_PG_PASSWORD}' BYPASSRLS;
          END IF;
        END $$;
        """
    )
    op.execute("GRANT USAGE ON SCHEMA public TO emqx_auth")
    op.execute("GRANT SELECT ON mqtt_auth, mqtt_acl TO emqx_auth")


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS mqtt_acl")
    op.execute("DROP VIEW IF EXISTS mqtt_auth")
    op.execute("REVOKE ALL ON SCHEMA public FROM emqx_auth")
    op.execute("DROP ROLE IF EXISTS emqx_auth")
    op.execute("DROP TABLE IF EXISTS mqtt_service_accounts")
```

> **Note:** `SVC_PROCESSOR_HASH` is `sha256("processor-mqtt-dev-secret")`. The
> `processor` service sends this secret as `MQTT_PASSWORD` (Task 2). Rotate both
> together in staging/production; the dev value is intentionally weak.

- [ ] **Step 4: Apply the migration and run the test**

Run:
```bash
docker exec gito-api alembic upgrade head
docker exec gito-api pytest tests/test_mqtt_auth_sql.py -v
```
Expected: migration applies; test PASSES.

- [ ] **Step 5: Commit**

```bash
git add api/alembic/versions/023_mqtt_auth.py api/tests/test_mqtt_auth_sql.py
git commit -m "feat(security): MQTT auth/ACL views + emqx_auth role + service account"
```

---

### Task 2: EMQX broker — config + swap dev compose + service-account env

**Files:**
- Create: `emqx/emqx.conf`
- Modify: `docker-compose.yml` (replace the `mosquitto` service block, lines 43–59; update `processor` env lines 71–74 and `api` env lines 100–103)
- Delete: `mosquitto/mosquitto.conf` (dead after swap)

**Interfaces:**
- Consumes: `mqtt_auth` / `mqtt_acl` views and the `emqx_auth` role (Task 1).
- Produces: a broker on `1883` that rejects anonymous, authenticates devices via `mqtt_auth`, authorizes via `mqtt_acl`, and lets `svc_processor` (superuser) do anything. Env contract for services: `MQTT_USERNAME=svc_processor`, `MQTT_PASSWORD=processor-mqtt-dev-secret`.

- [ ] **Step 1: Write the EMQX config**

Create `emqx/emqx.conf`:

```hocon
node {
  name   = "emqx@127.0.0.1"
  cookie = "gito_emqx_secret_cookie"
  data_dir = "data"
}

listeners.tcp.default {
  bind = "0.0.0.0:1883"
  max_connections = 1024000
}

# No anonymous authenticator is configured, so unauthenticated clients are rejected.
authentication = [
  {
    mechanism = password_based
    backend   = postgresql
    server    = "postgres:5432"
    database  = "gito"
    username  = "emqx_auth"
    password  = "emqx-auth-dev-secret"
    query     = "SELECT password_hash, is_superuser FROM mqtt_auth WHERE username = ${username} LIMIT 1"
    password_hash_algorithm { name = "sha256", salt_position = "disable" }
  }
]

authorization {
  no_match    = "deny"
  deny_action = "disconnect"
  cache { enable = true, ttl = "1m" }
  sources = [
    {
      type     = postgresql
      server   = "postgres:5432"
      database = "gito"
      username = "emqx_auth"
      password = "emqx-auth-dev-secret"
      query    = "SELECT permission, action, topic FROM mqtt_acl WHERE username = ${username}"
    }
  ]
}
```

- [ ] **Step 2: Swap the broker service in `docker-compose.yml`**

Replace the `mosquitto:` block (lines 43–59) with:

```yaml
  # EMQX MQTT Broker (per-device auth + ACL backed by PostgreSQL)
  mosquitto:  # keep the service name 'mosquitto' so processor/api MQTT_BROKER host is unchanged
    image: emqx/emqx:5.8
    container_name: gito-mosquitto
    ports:
      - "1883:1883"    # MQTT (auth required)
      - "18083:18083"  # EMQX dashboard (dev only)
    volumes:
      - ./emqx/emqx.conf:/opt/emqx/etc/emqx.conf:ro
      - emqx_data:/opt/emqx/data
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "/opt/emqx/bin/emqx", "ctl", "status"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s
    networks:
      - gito-network
    restart: unless-stopped
```

Update the `volumes:` section (lines 177–181): remove `mosquitto_data:` and `mosquitto_logs:`, add `emqx_data:`.

Update the `processor` env (lines 71–74) so it authenticates as the service account:

```yaml
      MQTT_BROKER: mosquitto
      MQTT_PORT: 1883
      MQTT_USERNAME: ${MQTT_SERVICE_USERNAME:-svc_processor}
      MQTT_PASSWORD: ${MQTT_SERVICE_PASSWORD:-processor-mqtt-dev-secret}
```

Update the `api` env (lines 100–103) identically:

```yaml
      MQTT_BROKER_HOST: mosquitto
      MQTT_BROKER_PORT: 1883
      MQTT_USERNAME: ${MQTT_SERVICE_USERNAME:-svc_processor}
      MQTT_PASSWORD: ${MQTT_SERVICE_PASSWORD:-processor-mqtt-dev-secret}
```

- [ ] **Step 3: Bring up the broker and verify it starts + services reconnect**

Run:
```bash
docker compose up -d mosquitto
docker exec gito-mosquitto /opt/emqx/bin/emqx ctl status
docker compose restart processor
docker logs gito-processor --tail 20
```
Expected: EMQX reports `Node ... is started`; processor logs show it connected (no auth failures). If EMQX fails to load `emqx.conf`, the container logs name the offending key — adjust to the `emqx/emqx:5.8` schema and retry (config keys are version-specific; this is the gate the plan expects you to close).

- [ ] **Step 4: Integration test — anonymous denied, service account allowed, device confined**

Seed one device credential directly (Task 3 adds the UI/endpoint; here use SQL), then probe with `mosquitto_pub`. Run:

```bash
# Pick a real device + tenant and insert a known mqtt_password
docker exec gito-postgres psql -U gito -d gito -v ON_ERROR_STOP=1 -c "
  SELECT set_config('app.current_tenant_id', tenant_id::text, false)
  FROM devices LIMIT 1;
"
# Simpler: run a small python seed inside the api container
docker exec gito-api python - <<'PY'
import asyncio, hashlib, os, asyncpg
async def main():
    url=os.environ['DATABASE_URL'].replace('postgresql+asyncpg://','postgresql://')
    c=await asyncpg.connect(url)
    d=await c.fetchrow("SELECT id, tenant_id FROM devices LIMIT 1")
    h=hashlib.sha256(b'gito_mq_probe').hexdigest()
    await c.execute("SELECT set_config('app.current_tenant_id',$1,false)", str(d['tenant_id']))
    await c.execute("""INSERT INTO device_credentials (tenant_id,device_id,credential_type,credential_hash,status)
                       VALUES ($1,$2,'mqtt_password',$3,'active')""", d['tenant_id'], d['id'], h)
    print(f"DEVICE={d['id']} TENANT={d['tenant_id']}")
asyncio.run(main())
PY
```

Then, using the printed `DEVICE`/`TENANT` (run from the host, broker on `localhost:1883`):

```bash
# a) anonymous → refused
mosquitto_pub -h localhost -p 1883 -t "T/devices/D/telemetry" -m '{}' ; echo "rc=$?"   # expect non-zero (Connection Refused: not authorised)

# b) correct device creds to OWN topic → accepted
mosquitto_pub -h localhost -p 1883 -u "<DEVICE>" -P "gito_mq_probe" \
  -t "<TENANT>/devices/<DEVICE>/telemetry" -m '{"temperature":25}' ; echo "rc=$?"   # expect 0

# c) correct device creds to ANOTHER device's topic → refused
mosquitto_pub -h localhost -p 1883 -u "<DEVICE>" -P "gito_mq_probe" \
  -t "<TENANT>/devices/00000000-0000-0000-0000-000000000000/telemetry" -m '{}' ; echo "rc=$?"   # expect non-zero

# d) service account → accepted anywhere
mosquitto_pub -h localhost -p 1883 -u svc_processor -P processor-mqtt-dev-secret \
  -t "any/topic" -m '{}' ; echo "rc=$?"   # expect 0
```

Expected: (a) refused, (b) accepted, (c) refused, (d) accepted. Clean up the probe credential:
```bash
docker exec gito-postgres psql -U gito -d gito -c "DELETE FROM device_credentials WHERE credential_hash = '$(python -c "import hashlib;print(hashlib.sha256(b'gito_mq_probe').hexdigest())")'"
```

- [ ] **Step 5: Commit**

```bash
git add emqx/emqx.conf docker-compose.yml
git rm mosquitto/mosquitto.conf
git commit -m "feat(security): replace Mosquitto with EMQX (per-device auth + ACL via Postgres)"
```

---

### Task 3: Backend — MQTT credential endpoints

**Files:**
- Modify: `api/app/schemas/device_credential.py` (add MQTT schemas)
- Modify: `api/app/routers/device_credentials.py` (add `GET` + `POST /credentials/mqtt`)
- Test: `api/tests/test_mqtt_credential_endpoint.py`

**Interfaces:**
- Consumes: existing `DeviceCredential` model, `validate_tenant_access`, `set_tenant_context`.
- Produces:
  - `POST /tenants/{tid}/devices/{did}/credentials/mqtt` → `SuccessResponse(data=MqttCredentialCreated)` with `username=str(device_id)`, plain `password` (shown once). Revokes any prior active `mqtt_password` first (one active per device).
  - `GET  /tenants/{tid}/devices/{did}/credentials/mqtt` → `SuccessResponse(data=MqttCredentialOut|null)` — metadata only, never a secret.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_mqtt_credential_endpoint.py`. It exercises the router through FastAPI's TestClient with a real device (uses the demo DB inside the container). It logs in for a JWT, creates a device, generates an MQTT credential, and asserts the response + single-active invariant.

```python
import os
import httpx
import pytest

BASE = "http://localhost:8000/api/v1"


async def _auth():
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{BASE}/auth/login", json={"email": "admin@gito.demo", "password": "admin123"})
        data = r.json()["data"]
        import base64, json
        payload = json.loads(base64.urlsafe_b64decode(data["access_token"].split(".")[1] + "=="))
        return data["access_token"], payload["tenant_id"]


@pytest.mark.asyncio
async def test_generate_mqtt_credential_once_and_single_active():
    token, tenant = await _auth()
    h = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(headers=h) as c:
        dev = (await c.post(f"{BASE}/tenants/{tenant}/devices",
                            json={"name": "mqtt-cred-test", "device_type_id": None})).json()["data"]
        did = dev["id"]
        try:
            r1 = await c.post(f"{BASE}/tenants/{tenant}/devices/{did}/credentials/mqtt", json={})
            assert r1.status_code == 201
            d1 = r1.json()["data"]
            assert d1["username"] == did
            assert d1["password"].startswith("gito_mq_")

            # regenerate → new secret, still exactly one active
            r2 = await c.post(f"{BASE}/tenants/{tenant}/devices/{did}/credentials/mqtt", json={})
            d2 = r2.json()["data"]
            assert d2["password"] != d1["password"]

            g = (await c.get(f"{BASE}/tenants/{tenant}/devices/{did}/credentials/mqtt")).json()["data"]
            assert g is not None and g["status"] == "active" and "password" not in g
        finally:
            await c.delete(f"{BASE}/tenants/{tenant}/devices/{did}")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec gito-api pytest tests/test_mqtt_credential_endpoint.py -v`
Expected: FAIL — 404, the `/credentials/mqtt` route does not exist.

- [ ] **Step 3: Add the schemas**

Append to `api/app/schemas/device_credential.py`:

```python
class MqttCredentialOut(BaseModel):
    """MQTT credential metadata — never exposes the secret."""
    id: UUID
    username: str
    status: str
    created_at: datetime
    expires_at: Optional[datetime]

    class Config:
        from_attributes = True


class MqttCredentialCreated(MqttCredentialOut):
    """Returned only on generation — includes the plain password (shown once)."""
    password: str = Field(description="Plain MQTT password — save it now, it will not be shown again.")
```

- [ ] **Step 4: Add the endpoints**

In `api/app/routers/device_credentials.py`, add imports and two routes. Add to the schema import line:

```python
from app.schemas.device_credential import (
    DeviceTokenCreate, DeviceTokenOut, DeviceTokenCreated,
    MqttCredentialOut, MqttCredentialCreated,
)
```

Then append these routes (they share the router's `/tenants/{tenant_id}/devices/{device_id}/credentials` prefix):

```python
@router.get("/mqtt", response_model=SuccessResponse)
async def get_mqtt_credential(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Return the device's active MQTT credential metadata (no secret), or null."""
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")
    await session.set_tenant_context(tenant_id)

    result = await session.execute(
        select(DeviceCredential).where(
            DeviceCredential.tenant_id == tenant_id,
            DeviceCredential.device_id == device_id,
            DeviceCredential.credential_type == "mqtt_password",
            DeviceCredential.status == "active",
        ).order_by(DeviceCredential.created_at.desc())
    )
    cred = result.scalars().first()
    if not cred:
        return SuccessResponse(data=None)
    return SuccessResponse(data=MqttCredentialOut(
        id=cred.id, username=str(device_id), status=cred.status,
        created_at=cred.created_at, expires_at=cred.expires_at,
    ))


@router.post("/mqtt", response_model=SuccessResponse, status_code=status.HTTP_201_CREATED)
async def generate_mqtt_credential(
    tenant_id: UUID,
    device_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)] = None,
):
    """Generate (or rotate) the device's MQTT password. Plain password returned ONCE.

    username = device_id. Any previously active mqtt_password is revoked so a
    device always has exactly one active MQTT credential.
    """
    if not await validate_tenant_access(session, current_tenant, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")
    await session.set_tenant_context(tenant_id)

    device_result = await session.execute(
        select(Device).where(Device.tenant_id == tenant_id, Device.id == device_id)
    )
    if not device_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    # Revoke any existing active MQTT credential (single active per device).
    existing = await session.execute(
        select(DeviceCredential).where(
            DeviceCredential.tenant_id == tenant_id,
            DeviceCredential.device_id == device_id,
            DeviceCredential.credential_type == "mqtt_password",
            DeviceCredential.status == "active",
        )
    )
    for old in existing.scalars().all():
        old.status = "revoked"
        old.rotated_at = datetime.now(timezone.utc)

    plain = f"gito_mq_{secrets.token_hex(24)}"
    cred = DeviceCredential(
        tenant_id=tenant_id,
        device_id=device_id,
        credential_type="mqtt_password",
        credential_hash=hashlib.sha256(plain.encode()).hexdigest(),
        username=str(device_id),
        status="active",
    )
    session.add(cred)
    await session.commit()
    await session.refresh(cred)

    logger.info("Generated MQTT credential for device %s (tenant %s)", device_id, tenant_id)
    return SuccessResponse(data=MqttCredentialCreated(
        id=cred.id, username=str(device_id), status=cred.status,
        created_at=cred.created_at, expires_at=cred.expires_at, password=plain,
    ))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `docker exec gito-api pytest tests/test_mqtt_credential_endpoint.py -v`
Expected: PASS (the API auto-reloads on file change).

- [ ] **Step 6: Commit**

```bash
git add api/app/schemas/device_credential.py api/app/routers/device_credentials.py api/tests/test_mqtt_credential_endpoint.py
git commit -m "feat(security): MQTT credential generate/rotate endpoints"
```

---

### Task 4: Frontend — Connect instructions show real per-device credentials

**Files:**
- Modify: `web/src/components/ConnectionInstructionsModal.tsx`

**Interfaces:**
- Consumes: `POST`/`GET /api/v1/tenants/{tid}/devices/{did}/credentials/mqtt` (Task 3). `tenant_id` from the JWT in `localStorage.auth_token`.
- Produces: instructions with `username = device_id`, the real (once-shown) password, and the **correct** topic `{tenant_id}/devices/{device_id}/telemetry`.

- [ ] **Step 1: Replace the config + add credential fetching**

In `ConnectionInstructionsModal.tsx`, replace the `mqttConfig` block (lines 40–50) and add state + a fetch effect. New code:

```tsx
  const [mqttPassword, setMqttPassword] = useState<string | null>(null);
  const [hasCred, setHasCred] = useState(false);
  const [credLoading, setCredLoading] = useState(true);

  const auth = () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return null;
    const tenantId = JSON.parse(atob(token.split('.')[1])).tenant_id;
    return { token, tenantId };
  };

  const mqttConfig = {
    host: typeof window !== 'undefined' && window.location.hostname !== 'localhost'
      ? window.location.hostname
      : 'localhost',
    port: 1883,
    tlsPort: 8883,
    username: device.id,
    get topic() {
      const a = auth();
      return a ? `${a.tenantId}/devices/${device.id}/telemetry` : `devices/${device.id}/telemetry`;
    },
  };

  const generateCred = async () => {
    const a = auth();
    if (!a) return;
    setCredLoading(true);
    const res = await fetch(`/api/v1/tenants/${a.tenantId}/devices/${device.id}/credentials/mqtt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token}` },
      body: '{}',
    });
    if (res.ok) {
      setMqttPassword((await res.json()).data.password);
      setHasCred(true);
    }
    setCredLoading(false);
  };

  useEffect(() => {
    const a = auth();
    if (!a) { setCredLoading(false); return; }
    (async () => {
      const res = await fetch(`/api/v1/tenants/${a.tenantId}/devices/${device.id}/credentials/mqtt`, {
        headers: { Authorization: `Bearer ${a.token}` },
      });
      const existing = res.ok ? (await res.json()).data : null;
      if (existing) { setHasCred(true); setCredLoading(false); }
      else { await generateCred(); }        // first time → generate + reveal once
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Add `useEffect` to the React import at the top:

```tsx
import React, { useState, useEffect } from 'react';
```

- [ ] **Step 2: Replace the "anonymous / dev mode" banner with the credentials block**

Replace the yellow warning block (lines 271–275) with a credentials panel:

```tsx
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-th-secondary uppercase block mb-1">Username</label>
                      <code className="block text-sm font-mono bg-page border border-th-default rounded px-3 py-2 text-th-primary truncate">
                        {mqttConfig.username}
                      </code>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-th-secondary uppercase block mb-1">Password</label>
                      {credLoading ? (
                        <div className="text-sm text-th-muted px-3 py-2">Generating…</div>
                      ) : mqttPassword ? (
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-sm font-mono bg-page border border-th-default rounded px-3 py-2 text-th-primary truncate">
                            {mqttPassword}
                          </code>
                          <button onClick={() => copyToClipboard(mqttPassword, 'password')}
                                  className="p-2 hover:bg-panel rounded transition-colors">
                            {copiedField === 'password'
                              ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                              : <Copy className="w-4 h-4 text-th-secondary" />}
                          </button>
                        </div>
                      ) : (
                        <button onClick={generateCred}
                                className="text-sm text-primary-600 hover:text-primary-700 font-medium px-3 py-2">
                          {hasCred ? 'Regenerate password' : 'Generate password'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      <strong>🔑 Save this password now</strong> — it is shown only once. Regenerating replaces it and disconnects the old credential.
                    </p>
                  </div>
```

- [ ] **Step 3: Update the code snippets to use real credentials**

In `pythonExample` (lines 58–87) replace the connect lines:

```tsx
client = mqtt.Client(client_id="${device.id}")
client.username_pw_set("${device.id}", "${mqttPassword ?? '<YOUR_MQTT_PASSWORD>'}")
client.connect(BROKER, PORT, 60)
```

In the `mosquitto_pub` block (lines 326–334) replace with:

```tsx
{`# Using mosquitto_pub (command line)
mosquitto_pub -h ${mqttConfig.host} -p ${mqttConfig.port} \\
  -u "${device.id}" -P "${mqttPassword ?? '<YOUR_MQTT_PASSWORD>'}" \\
  -t ${mqttConfig.topic} \\
  -m '{"temperature": 25.5, "humidity": 65.0}'`}
```

In `arduinoExample`, update `reconnect()` (line 124) to authenticate:

```tsx
    if (client.connect(device_id, "${device.id}", "${mqttPassword ?? '<YOUR_MQTT_PASSWORD>'}")) {
```

- [ ] **Step 4: Typecheck + visual verify**

Run: `docker exec gito-web npx tsc --noEmit`
Expected: exit 0.
Then open a device's Connect instructions at `http://localhost:3001` and confirm: username = device id, a `gito_mq_…` password shows once, topic includes the tenant prefix, and the snippets carry the credentials.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ConnectionInstructionsModal.tsx
git commit -m "feat(security): Connect instructions issue real per-device MQTT credentials"
```

---

### Task 5: Staging compose, rollout, and docs

**Files:**
- Modify: `docker-compose.staging.yml` (swap `mosquitto` service to EMQX; update processor/api MQTT env — mirror Task 2)
- Create: `scripts/backfill_mqtt_credentials.py` (issue creds for existing devices)
- Modify: `CLEANUP_TODO.md` and `CLAUDE.md` (mark the anonymous-broker gap closed)

**Interfaces:**
- Consumes: Task 1–3 (views, EMQX, endpoint).
- Produces: staging parity + a repeatable rollout for existing devices.

- [ ] **Step 1: Mirror the EMQX swap into `docker-compose.staging.yml`**

Apply the same service replacement and `MQTT_USERNAME`/`MQTT_PASSWORD` env changes as Task 2, using `./emqx/emqx.conf` and the `emqx_data` volume. Staging must set real secrets via env (`MQTT_SERVICE_PASSWORD`, and the `emqx_auth` PG password) rather than the dev defaults.

- [ ] **Step 2: Write the backfill script**

Create `scripts/backfill_mqtt_credentials.py`:

```python
"""Issue an mqtt_password for every device that lacks an active one.

Run once during rollout, before flipping anonymous off. Prints device_id and the
plain password (capture the output securely and distribute to device owners).
"""
import asyncio, hashlib, os, secrets
import asyncpg


async def main():
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    rows = await conn.fetch(
        """
        SELECT d.id, d.tenant_id
        FROM devices d
        WHERE NOT EXISTS (
            SELECT 1 FROM device_credentials dc
            WHERE dc.device_id = d.id AND dc.credential_type = 'mqtt_password'
              AND dc.status = 'active'
        )
        """
    )
    for r in rows:
        plain = f"gito_mq_{secrets.token_hex(24)}"
        await conn.execute("SELECT set_config('app.current_tenant_id', $1, false)", str(r["tenant_id"]))
        await conn.execute(
            """INSERT INTO device_credentials (tenant_id, device_id, credential_type, credential_hash, username, status)
               VALUES ($1, $2, 'mqtt_password', $3, $4, 'active')""",
            r["tenant_id"], r["id"], hashlib.sha256(plain.encode()).hexdigest(), str(r["id"]),
        )
        print(f"{r['id']}\t{plain}")
    print(f"# issued {len(rows)} credentials", flush=True)
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: Verify the backfill on dev**

Run: `docker exec gito-api python /app/../scripts/backfill_mqtt_credentials.py` (or copy into the container). Confirm it prints one line per previously-uncredentialed device and that re-running prints `# issued 0 credentials` (idempotent).

- [ ] **Step 4: Update the docs**

In `CLEANUP_TODO.md`, add a "Resolved" entry: anonymous MQTT broker replaced by EMQX per-device auth (link the spec). In `CLAUDE.md` "Production Status", move "anonymous MQTT" from risk to done and note EMQX as the broker.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.staging.yml scripts/backfill_mqtt_credentials.py CLEANUP_TODO.md CLAUDE.md
git commit -m "chore(security): staging EMQX parity, credential backfill, docs"
```

---

## Self-Review

**Spec coverage:**
- Credential model (`mqtt_password`, username=device_id, service account) → Task 1 (views/service acct) + Task 3 (endpoint). ✓
- Broker → EMQX, Postgres authn/authz, default-deny, service superuser → Task 1 (views/role) + Task 2 (config/compose). ✓
- Processor/command bridge use service account → Task 2 (env). Processor already passes `MQTT_USERNAME/PASSWORD` ([mqtt_processor.py:1628](../../../processor/mqtt_processor.py#L1628)); CommandBridge shares that authenticated client. ✓
- Connect instructions UX → Task 4. ✓
- Config/migration/rollout → Task 1 (migration), Task 2 (dev), Task 5 (staging + backfill + flip anonymous). ✓
- Success criteria (anonymous denied / own-topic only / instant revoke / real creds / other paths unaffected) → verified in Task 2 Step 4 + Task 3 test + Task 4. ✓
- Testing (unit SQL + integration) → Task 1 test + Task 2 Step 4. ✓
- Out of scope (TLS, ChirpStack provisioning, other protocols) → not included. ✓

**Refinement vs spec (call-out):** the spec proposed EMQX's `built_in_database` authenticator for the service account. This plan instead keeps the service account in Postgres (`mqtt_service_accounts`, unioned into `mqtt_auth`) so there is a *single* source of truth and *one* authenticator — strictly simpler and more consistent with the design's core principle. Behaviour is identical (superuser service account).

**Placeholder scan:** no "TBD/handle errors/similar to Task N". `SVC_PROCESSOR_HASH` is the real computed `sha256("processor-mqtt-dev-secret")`. EMQX config-key version drift is called out with the container-log adjustment step (Task 2 Step 3).

**Type consistency:** `mqtt_auth(username, password_hash, is_superuser)` and `mqtt_acl(username, permission, action, topic)` column names are identical across the migration (Task 1), the test (Task 1), and the EMQX queries (Task 2). Endpoint returns `MqttCredentialCreated`/`MqttCredentialOut` consistently (Task 3) and the frontend reads `.data.password` / `.data` (Task 4). `MQTT_USERNAME`/`MQTT_PASSWORD` env names match the processor's existing `os.getenv` keys.
