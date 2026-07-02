# Connections Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Connections page for all external integrations (LoRaWAN, MQTT, HTTP), and clean up Settings by removing the Integrations tab (rename to Notifications, SMTP only).

**Architecture:** Extend the existing `integrations` table/API to support `mqtt` and `http` providers. The `config` JSONB field already stores outbound credentials (ChirpStack server URL + API key). Settings page keeps only SMTP under a "Notifications" tab. A new `/dashboard/connections` page provides full CRUD for the integrations API, following the ThingsBoard model: one connection object = both inbound (webhook URL + bearer key) and outbound (server URL + API key for ChirpStack).

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), Next.js 14 + React + Tailwind (frontend), pytest (tests)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `api/alembic/versions/016_extend_providers.py` | Create | Extend `valid_provider` constraint to include `mqtt` and `http` |
| `api/app/schemas/integration.py` | Modify | Add `mqtt`/`http` to `ProviderEnum` and `PROVIDER_DOCS`; rename `_webhook_url` to `_connection_endpoint` in router |
| `api/app/models/base.py` | Modify | Update `CheckConstraint` for `valid_provider` to match DB |
| `api/app/routers/integrations.py` | Modify | Update `_webhook_url` → `_connection_endpoint` (provider-aware URL) |
| `api/app/routers/settings.py` | Modify | Remove `mqtt_broker_url`, `chirpstack_api_key`, `chirpstack_server` from `IntegrationsConfig` |
| `api/tests/test_integration_schemas.py` | Create | Unit tests for ProviderEnum + PROVIDER_DOCS |
| `api/tests/test_settings_schema.py` | Create | Unit tests for stripped IntegrationsConfig |
| `web/src/app/dashboard/connections/page.tsx` | Create | Connections page — list, add, delete, rotate key |
| `web/src/app/dashboard/settings/page.tsx` | Modify | Remove Integrations tab; rename to Notifications (SMTP only) |
| `web/src/components/Sidebar.tsx` | Modify | Add Connections nav link |

---

## Task 1: DB Migration — Extend valid_provider constraint

**Files:**
- Create: `api/alembic/versions/016_extend_providers.py`

- [ ] **Step 1: Write migration**

```python
# api/alembic/versions/016_extend_providers.py
"""Extend valid_provider check constraint to include mqtt and http.

Revision ID: 016_extend_providers
Revises: 015_integrations
Create Date: 2026-04-10
"""
from typing import Sequence, Union
from alembic import op

revision: str = "016_extend_providers"
down_revision: Union[str, None] = "015_integrations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the old constraint, add expanded one
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE table_name = 'integrations' AND constraint_name = 'valid_provider'
            ) THEN
                ALTER TABLE integrations DROP CONSTRAINT valid_provider;
            END IF;
        END $$;
    """)
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http')
        );
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE integrations DROP CONSTRAINT IF EXISTS valid_provider;")
    op.execute("""
        ALTER TABLE integrations ADD CONSTRAINT valid_provider CHECK (
            provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom')
        );
    """)
```

- [ ] **Step 2: Verify migration runs**

```bash
cd api && alembic upgrade head
```

Expected: `Running upgrade 015_integrations -> 016_extend_providers`

- [ ] **Step 3: Commit**

```bash
git add api/alembic/versions/016_extend_providers.py
git commit -m "feat: extend valid_provider constraint to include mqtt and http"
```

---

## Task 2: Backend — Extend ProviderEnum + PROVIDER_DOCS + model constraint

**Files:**
- Modify: `api/app/schemas/integration.py`
- Modify: `api/app/models/base.py`
- Create: `api/tests/test_integration_schemas.py`

- [ ] **Step 1: Write failing tests**

```python
# api/tests/test_integration_schemas.py
import pytest
from pydantic import ValidationError
from app.schemas.integration import (
    IntegrationCreate,
    ProviderEnum,
    build_setup_instructions,
)


def test_mqtt_provider_accepted():
    body = IntegrationCreate(name="My MQTT", provider=ProviderEnum.mqtt, config={})
    assert body.provider == ProviderEnum.mqtt


def test_http_provider_accepted():
    body = IntegrationCreate(name="My HTTP", provider=ProviderEnum.http, config={})
    assert body.provider == ProviderEnum.http


def test_invalid_provider_rejected():
    with pytest.raises(ValidationError):
        IntegrationCreate(name="Bad", provider="fakelowan", config={})


def test_build_setup_instructions_mqtt():
    instructions = build_setup_instructions("mqtt", "mqtt://iot.gito.co.za:1883", "gito_ik_abc1")
    assert instructions.provider_name == "MQTT"
    assert len(instructions.steps) > 0
    assert any("mqtt://iot.gito.co.za:1883" in s for s in instructions.steps)


def test_build_setup_instructions_http():
    instructions = build_setup_instructions("http", "https://iot.gito.co.za/api/v1/ingest/http", "gito_ik_abc1")
    assert instructions.provider_name == "HTTP Ingest"
    assert len(instructions.steps) > 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && python -m pytest tests/test_integration_schemas.py -v
```

Expected: FAIL — `mqtt` not in `ProviderEnum`, `build_setup_instructions` missing `mqtt`/`http` keys

- [ ] **Step 3: Update `api/app/schemas/integration.py`**

Replace the `PROVIDER_DOCS` dict and `ProviderEnum`:

```python
PROVIDER_DOCS = {
    "chirpstack": {
        "name": "ChirpStack",
        "docs_url": "https://www.chirpstack.io/docs/chirpstack/integrations/http.html",
        "steps": [
            "In ChirpStack, go to Applications → Your Application → Integrations",
            "Click 'Add integration' → Select 'HTTP'",
            "Set Event endpoint URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Enable 'Uplink' events and click Save",
        ],
    },
    "ttn": {
        "name": "The Things Network (TTN v3)",
        "docs_url": "https://www.thethingsindustries.com/docs/integrations/webhooks/",
        "steps": [
            "In TTN Console, go to Applications → Your App → Integrations → Webhooks",
            "Click 'Add webhook' → Choose 'Custom webhook'",
            "Set Base URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Enable 'Uplink message' under message types and click Save",
        ],
    },
    "helium": {
        "name": "Helium",
        "docs_url": "https://docs.helium.com/use-the-network/console/integrations/http/",
        "steps": [
            "In Helium Console, go to Integrations → Add Integration → HTTP",
            "Set Endpoint URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Connect your devices to this integration and Save",
        ],
    },
    "actility": {
        "name": "Actility ThingPark",
        "docs_url": "https://docs.thingpark.com/thingpark-enterprise/",
        "steps": [
            "In ThingPark, go to Application Servers → Create",
            "Set Type to 'HTTP Application Server'",
            "Set Destination URL to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Link your devices to this application server",
        ],
    },
    "mqtt": {
        "name": "MQTT",
        "docs_url": None,
        "steps": [
            "Configure your MQTT client or gateway to connect to: {webhook_url}",
            "Use your device EUI or identifier as the MQTT username",
            "Use this key as the MQTT password: {key_preview}...",
            "Publish telemetry to topic: devices/<dev_eui>/telemetry",
            "Payload must be JSON: { \"metric_key\": value, ... }",
        ],
    },
    "http": {
        "name": "HTTP Ingest",
        "docs_url": None,
        "steps": [
            "POST device telemetry as JSON to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Payload must be JSON: { \"dev_eui\": \"...\", \"metrics\": { \"temperature\": 22.5 } }",
        ],
    },
    "custom": {
        "name": "Custom / Other",
        "docs_url": None,
        "steps": [
            "Configure your LNS to POST to: {webhook_url}",
            "Add header: Authorization = Bearer {key_preview}...",
            "Payload must be JSON with: { \"dev_eui\": \"...\", \"metrics\": { ... } }",
        ],
    },
}


class ProviderEnum(str, Enum):
    chirpstack = "chirpstack"
    ttn = "ttn"
    helium = "helium"
    actility = "actility"
    mqtt = "mqtt"
    http = "http"
    custom = "custom"
```

- [ ] **Step 4: Update `api/app/routers/integrations.py` — rename `_webhook_url` to `_connection_endpoint`**

Replace the `_webhook_url` function:

```python
def _connection_endpoint(provider: str) -> str:
    settings = get_settings()
    base = getattr(settings, "API_BASE_URL", "https://iot.gito.co.za")
    if provider == "mqtt":
        domain = base.replace("https://", "").replace("http://", "").split("/")[0]
        return f"mqtt://{domain}:1883"
    elif provider == "http":
        return f"{base}/api/v1/ingest/http"
    else:
        return f"{base}/api/v1/ingest/lorawan/{provider}"
```

Then replace all four call sites of `_webhook_url(...)` with `_connection_endpoint(...)` in the same file:
- In `create_integration`: `webhook_url = _connection_endpoint(body.provider.value)`
- In `get_integration`: `webhook_url = _connection_endpoint(integration.provider)`
- In `rotate_key` (×2): `webhook_url = _connection_endpoint(integration.provider)`

- [ ] **Step 5: Update `api/app/models/base.py` CheckConstraint for Integration**

Find the `__table_args__` in the `Integration` class and update:

```python
__table_args__ = (
    Index("idx_integrations_tenant", "tenant_id"),
    CheckConstraint(
        "provider IN ('chirpstack', 'ttn', 'helium', 'actility', 'custom', 'mqtt', 'http')",
        name="valid_provider",
    ),
)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd api && python -m pytest tests/test_integration_schemas.py -v
```

Expected: All 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add api/app/schemas/integration.py api/app/models/base.py api/app/routers/integrations.py api/tests/test_integration_schemas.py
git commit -m "feat: add mqtt and http provider support to integrations"
```

---

## Task 3: Backend — Clean up Settings IntegrationsConfig

**Files:**
- Modify: `api/app/routers/settings.py`
- Create: `api/tests/test_settings_schema.py`

- [ ] **Step 1: Write failing test**

```python
# api/tests/test_settings_schema.py
from app.routers.settings import IntegrationsConfig


def test_integrations_config_smtp_fields_present():
    config = IntegrationsConfig(smtp_host="smtp.example.com", smtp_port=587, smtp_user="apikey", smtp_from="alerts@example.com")
    assert config.smtp_host == "smtp.example.com"
    assert config.smtp_port == 587


def test_integrations_config_no_chirpstack_fields():
    """Outbound credentials belong in the integrations table, not settings."""
    assert not hasattr(IntegrationsConfig(), "chirpstack_api_key")
    assert not hasattr(IntegrationsConfig(), "chirpstack_server")
    assert not hasattr(IntegrationsConfig(), "mqtt_broker_url")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && python -m pytest tests/test_settings_schema.py -v
```

Expected: `test_integrations_config_no_chirpstack_fields` FAILS — those fields exist on the model

- [ ] **Step 3: Update `api/app/routers/settings.py`**

Replace `IntegrationsConfig` with SMTP-only version:

```python
class IntegrationsConfig(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_from: Optional[str] = None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd api && python -m pytest tests/test_settings_schema.py tests/test_integration_schemas.py -v
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/app/routers/settings.py api/tests/test_settings_schema.py
git commit -m "fix: remove outbound credentials from Settings (moved to Connections)"
```

---

## Task 4: Frontend — Settings page: Integrations tab → Notifications (SMTP only)

**Files:**
- Modify: `web/src/app/dashboard/settings/page.tsx`

- [ ] **Step 1: Update the `IntegrationsConfig` interface** (frontend type)

Replace the existing interface at the top of the file:

```typescript
interface IntegrationsConfig {
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_from?: string;
}
```

- [ ] **Step 2: Replace `IntegrationsTab` with `NotificationsTab`**

Remove the entire `IntegrationsTab` function and replace with:

```typescript
function NotificationsTab({
  profile,
  onSave,
  saving,
  saved,
}: {
  profile: TenantProfile;
  onSave: (patch: Partial<TenantProfile>) => void;
  saving: boolean;
  saved: boolean;
}) {
  const integ = profile.integrations ?? {};
  const [smtpHost, setSmtpHost] = useState(integ.smtp_host ?? '');
  const [smtpPort, setSmtpPort] = useState(String(integ.smtp_port ?? ''));
  const [smtpUser, setSmtpUser] = useState(integ.smtp_user ?? '');
  const [smtpFrom, setSmtpFrom] = useState(integ.smtp_from ?? '');

  useEffect(() => {
    const i = profile.integrations ?? {};
    setSmtpHost(i.smtp_host ?? '');
    setSmtpPort(String(i.smtp_port ?? ''));
    setSmtpUser(i.smtp_user ?? '');
    setSmtpFrom(i.smtp_from ?? '');
  }, [profile]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      integrations: {
        smtp_host: smtpHost || undefined,
        smtp_port: smtpPort ? parseInt(smtpPort) : undefined,
        smtp_user: smtpUser || undefined,
        smtp_from: smtpFrom || undefined,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Configure the SMTP server Gito uses to send alarm and notification emails.
        To configure device data connections (LoRaWAN, MQTT), visit the{' '}
        <a href="/dashboard/connections" className="text-blue-400 hover:underline">Connections</a> page.
      </p>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Mail className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Email (SMTP)</h3>
        </div>
        <div className="space-y-0 rounded-xl border border-[var(--color-border)] px-4 bg-[var(--color-panel)]">
          <FieldRow label="SMTP host" hint="e.g. smtp.sendgrid.net">
            <Input value={smtpHost} onChange={setSmtpHost} placeholder="smtp.sendgrid.net" />
          </FieldRow>
          <FieldRow label="Port" hint="Usually 587 (TLS) or 465 (SSL)">
            <Input value={smtpPort} onChange={setSmtpPort} placeholder="587" type="number" />
          </FieldRow>
          <FieldRow label="Username">
            <Input value={smtpUser} onChange={setSmtpUser} placeholder="apikey" />
          </FieldRow>
          <FieldRow label="From address" hint="Sender address for notifications">
            <Input value={smtpFrom} onChange={setSmtpFrom} placeholder="alerts@company.com" type="email" />
          </FieldRow>
        </div>
      </div>
      <div className="flex justify-end">
        <SaveButton loading={saving} saved={saved} />
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Update the tab type and tabs array**

Replace `type Tab = 'profile' | 'integrations' | 'retention';` with:

```typescript
type Tab = 'profile' | 'notifications' | 'retention';
```

Replace the `tabs` array in `SettingsPage`:

```typescript
const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile',       label: 'Profile',       icon: <User className="w-4 h-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Mail className="w-4 h-4" /> },
  { id: 'retention',     label: 'Retention',     icon: <Database className="w-4 h-4" /> },
];
```

- [ ] **Step 4: Update the tab content render section**

Replace:
```typescript
{activeTab === 'integrations' && (
  <IntegrationsTab profile={profile} onSave={handleSave} saving={saving} saved={saved} />
)}
```

With:
```typescript
{activeTab === 'notifications' && (
  <NotificationsTab profile={profile} onSave={handleSave} saving={saving} saved={saved} />
)}
```

Also update `setActiveTab` default state from `'profile'` — it's already `'profile'` so no change needed.

- [ ] **Step 5: Remove unused imports**

Remove from the import line: `Link2`, `Server`, `Key`, `Wifi`, `Settings` (check if still used — `Settings` is used in the `PageShell` icon, keep it; remove `Link2`, `Server`, `Key`, `Wifi`).

Final import line:
```typescript
import {
  User, Globe, Database, Save, Check, AlertCircle,
  Mail, Clock, Settings,
} from 'lucide-react';
```

- [ ] **Step 6: Manual test**

Navigate to `/dashboard/settings`. Verify:
- Three tabs: Profile, Notifications, Retention
- Notifications tab shows only SMTP fields
- No ChirpStack or MQTT fields visible
- Saving SMTP fields works

- [ ] **Step 7: Commit**

```bash
git add web/src/app/dashboard/settings/page.tsx
git commit -m "refactor: rename Settings Integrations tab to Notifications (SMTP only)"
```

---

## Task 5: Frontend — Connections page

**Files:**
- Create: `web/src/app/dashboard/connections/page.tsx`

- [ ] **Step 1: Create the file with types and helpers**

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '@/components/ui/PageShell';
import {
  Link2, Plus, RefreshCw, Trash2, CheckCircle, XCircle,
  Copy, Check, AlertCircle, ExternalLink, Wifi, Server,
  Radio, Globe, Activity, Key,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type ProviderKey = 'chirpstack' | 'ttn' | 'helium' | 'actility' | 'mqtt' | 'http' | 'custom';

interface Integration {
  id: string;
  tenant_id: string;
  name: string;
  provider: ProviderKey;
  key_prefix: string;
  config: Record<string, string>;
  is_active: boolean;
  last_used_at: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface CreatedIntegration {
  id: string;
  name: string;
  provider: ProviderKey;
  key: string;
  key_prefix: string;
  webhook_url: string;
  setup_instructions: {
    provider_name: string;
    steps: string[];
    docs_url: string | null;
  };
  created_at: string;
}

// ── Provider metadata ──────────────────────────────────────────────────────────

const PROVIDERS: Record<ProviderKey, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  chirpstack: {
    label: 'ChirpStack',
    description: 'Open-source LoRaWAN Network Server',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-purple-400',
  },
  ttn: {
    label: 'The Things Network',
    description: 'TTN v3 LoRaWAN network',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-blue-400',
  },
  helium: {
    label: 'Helium',
    description: 'Helium LoRaWAN network',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-emerald-400',
  },
  actility: {
    label: 'Actility ThingPark',
    description: 'Enterprise LoRaWAN platform',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-orange-400',
  },
  mqtt: {
    label: 'MQTT',
    description: 'Devices connecting via MQTT broker',
    icon: <Wifi className="w-5 h-5" />,
    color: 'text-cyan-400',
  },
  http: {
    label: 'HTTP Ingest',
    description: 'Generic HTTP device posting',
    icon: <Globe className="w-5 h-5" />,
    color: 'text-yellow-400',
  },
  custom: {
    label: 'Custom',
    description: 'Custom LNS or device protocol',
    icon: <Server className="w-5 h-5" />,
    color: 'text-slate-400',
  },
};

// ── Auth helper ────────────────────────────────────────────────────────────────

function getAuth() {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return { token, tenantId: payload.tenant_id as string };
}

// ── CopyButton ─────────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />}
    </button>
  );
}
```

- [ ] **Step 2: Add `ConnectionCard` component**

```typescript
// ── ConnectionCard ─────────────────────────────────────────────────────────────

function ConnectionCard({
  integration,
  onToggle,
  onDelete,
  onRotate,
}: {
  integration: Integration;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  onRotate: (id: string) => void;
}) {
  const meta = PROVIDERS[integration.provider] ?? PROVIDERS.custom;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`gito-card rounded-xl overflow-hidden border transition-colors ${
      integration.is_active ? 'border-[var(--color-border)]' : 'border-[var(--color-border)] opacity-60'
    }`}>
      {/* Header row */}
      <div className="flex items-center gap-3 p-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/5 ${meta.color}`}>
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{integration.name}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">{meta.label} · {integration.key_prefix}...</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Active badge */}
          {integration.is_active
            ? <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle className="w-3.5 h-3.5" />Active</span>
            : <span className="flex items-center gap-1 text-xs text-slate-400"><XCircle className="w-3.5 h-3.5" />Inactive</span>
          }
          {/* Stats */}
          <span className="text-xs text-[var(--color-text-secondary)] pl-2 border-l border-[var(--color-border)]">
            {integration.message_count.toLocaleString()} msgs
          </span>
          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="ml-1 text-xs text-blue-400 hover:underline"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-4 space-y-3 bg-white/2">
          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
            <span>
              <Activity className="w-3.5 h-3.5 inline mr-1" />
              Last message: {integration.last_used_at
                ? new Date(integration.last_used_at).toLocaleString()
                : 'Never'}
            </span>
            <span>Created: {new Date(integration.created_at).toLocaleDateString()}</span>
          </div>

          {/* Outbound config (ChirpStack only) */}
          {integration.provider === 'chirpstack' && (integration.config.server_url || integration.config.api_key) && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Outbound (ChirpStack API)</p>
              {integration.config.server_url && (
                <div className="flex items-center gap-2 font-mono text-xs bg-black/20 rounded-lg px-3 py-2">
                  <span className="flex-1 text-[var(--color-text-primary)]">{integration.config.server_url}</span>
                </div>
              )}
              {integration.config.api_key && (
                <div className="flex items-center gap-2 font-mono text-xs bg-black/20 rounded-lg px-3 py-2">
                  <span className="flex-1 text-[var(--color-text-secondary)]">API key: ••••••••••••</span>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onToggle(integration.id, !integration.is_active)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {integration.is_active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
              {integration.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              onClick={() => onRotate(integration.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-amber-400 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              Rotate key
            </button>
            <button
              onClick={() => onDelete(integration.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add `AddConnectionModal` component**

```typescript
// ── AddConnectionModal ─────────────────────────────────────────────────────────

type ModalStep = 'pick' | 'form' | 'success';

function AddConnectionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (integration: CreatedIntegration) => void;
}) {
  const [step, setStep] = useState<ModalStep>('pick');
  const [provider, setProvider] = useState<ProviderKey | null>(null);
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedIntegration | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    const auth = getAuth();
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      const config: Record<string, string> = {};
      if (provider === 'chirpstack') {
        if (serverUrl) config.server_url = serverUrl;
        if (apiKey) config.api_key = apiKey;
      }
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ name, provider, config }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create connection');
      }
      const data: CreatedIntegration = await res.json();
      setCreated(data);
      setStep('success');
      onCreate(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[var(--color-panel)] border border-[var(--color-border)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {step === 'pick' ? 'Add Connection' : step === 'form' ? `New ${provider ? PROVIDERS[provider].label : ''} Connection` : 'Connection Created'}
          </h2>
          <button onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xl leading-none">×</button>
        </div>

        {/* Step: provider picker */}
        {step === 'pick' && (
          <div className="p-6 grid grid-cols-2 gap-3">
            {(Object.entries(PROVIDERS) as [ProviderKey, typeof PROVIDERS[ProviderKey]][]).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => { setProvider(key); setStep('form'); }}
                className="flex items-start gap-3 p-4 rounded-xl border border-[var(--color-border)] hover:border-blue-500 hover:bg-blue-500/5 transition-colors text-left"
              >
                <span className={`mt-0.5 ${meta.color}`}>{meta.icon}</span>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{meta.label}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{meta.description}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step: form */}
        {step === 'form' && provider && (
          <form onSubmit={handleCreate} className="p-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Connection name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={`My ${PROVIDERS[provider].label}`}
                required
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* ChirpStack-specific: outbound config */}
            {provider === 'chirpstack' && (
              <>
                <p className="text-xs text-[var(--color-text-secondary)] pt-1">
                  Optional: provide your ChirpStack server details so Gito can send downlinks and sync devices.
                </p>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">ChirpStack server URL <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span></label>
                  <input
                    value={serverUrl}
                    onChange={e => setServerUrl(e.target.value)}
                    placeholder="https://chirpstack.example.com"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">ChirpStack API key <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span></label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="eyJ…"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setStep('pick')} className="flex-1 px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                Back
              </button>
              <button type="submit" disabled={loading || !name.trim()} className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {loading ? 'Creating…' : 'Create connection'}
              </button>
            </div>
          </form>
        )}

        {/* Step: success */}
        {step === 'success' && created && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              Connection created. Copy your bearer key now — it will not be shown again.
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5">Webhook URL</p>
              <div className="flex items-center gap-2 font-mono text-xs bg-black/20 rounded-lg px-3 py-2">
                <span className="flex-1 text-[var(--color-text-primary)] break-all">{created.webhook_url}</span>
                <CopyButton value={created.webhook_url} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5">Bearer key (copy now)</p>
              <div className="flex items-center gap-2 font-mono text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <span className="flex-1 text-amber-300 break-all">{created.key}</span>
                <CopyButton value={created.key} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">Setup instructions</p>
              <ol className="space-y-1.5">
                {created.setup_instructions.steps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-xs text-[var(--color-text-secondary)]">
                    <span className="font-semibold text-[var(--color-text-primary)] shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {created.setup_instructions.docs_url && (
                <a href={created.setup_instructions.docs_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:underline mt-2">
                  <ExternalLink className="w-3 h-3" />
                  Documentation
                </a>
              )}
            </div>

            <button onClick={onClose} className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add `RotateKeyModal` component**

```typescript
// ── RotateKeyModal ─────────────────────────────────────────────────────────────

function RotateKeyModal({
  integrationId,
  onClose,
}: {
  integrationId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<CreatedIntegration | null>(null);

  async function handleRotate() {
    const auth = getAuth();
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations/${integrationId}/rotate-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to rotate key');
      }
      setRotated(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--color-panel)] border border-[var(--color-border)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Rotate key</h2>
          <button onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {!rotated ? (
            <>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>This will immediately invalidate the current key. Your devices will stop sending data until you update them with the new key.</span>
              </div>
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleRotate} disabled={loading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-60 transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" />
                  {loading ? 'Rotating…' : 'Rotate key'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4 shrink-0" />
                Key rotated. Copy your new key — it will not be shown again.
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5">New bearer key</p>
                <div className="flex items-center gap-2 font-mono text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  <span className="flex-1 text-amber-300 break-all">{rotated.key}</span>
                  <CopyButton value={rotated.key} />
                </div>
              </div>
              <button onClick={onClose} className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the main `ConnectionsPage` component**

```typescript
// ── ConnectionsPage ────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    const auth = getAuth();
    if (!auth) return;
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      setIntegrations(result.data ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  const handleToggle = useCallback(async (id: string, active: boolean) => {
    const auth = getAuth();
    if (!auth) return;
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ is_active: active }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      setIntegrations(prev => prev.map(i => i.id === id ? result.data : i));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const auth = getAuth();
    if (!auth) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setIntegrations(prev => prev.filter(i => i.id !== id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }, []);

  function handleCreated(created: CreatedIntegration) {
    // After modal closes, refetch to get the clean IntegrationResponse object
    fetchIntegrations();
  }

  return (
    <PageShell
      title="Connections"
      subtitle="External integrations — LoRaWAN networks, MQTT, HTTP ingest"
      icon={<Link2 className="w-5 h-5" />}
      action={
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add connection
        </button>
      }
    >
      <div className="max-w-3xl mx-auto space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48 text-[var(--color-text-secondary)] text-sm">
            Loading connections…
          </div>
        ) : integrations.length === 0 ? (
          <div className="gito-card rounded-xl p-12 text-center">
            <Link2 className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-secondary)] opacity-40" />
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No connections yet</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 mb-4">
              Add your first connection to start receiving device data from ChirpStack, TTN, or MQTT.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add connection
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {integrations.map(integration => (
              <ConnectionCard
                key={integration.id}
                integration={integration}
                onToggle={handleToggle}
                onDelete={id => {
                  if (confirm(`Delete connection "${integration.name}"? This cannot be undone.`)) {
                    handleDelete(id);
                  }
                }}
                onRotate={setRotatingId}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddConnectionModal
          onClose={() => setShowAdd(false)}
          onCreate={handleCreated}
        />
      )}

      {rotatingId && (
        <RotateKeyModal
          integrationId={rotatingId}
          onClose={() => { setRotatingId(null); fetchIntegrations(); }}
        />
      )}
    </PageShell>
  );
}
```

- [ ] **Step 6: Manual test**

Navigate to `/dashboard/connections`:
1. Page loads with "No connections yet" empty state
2. Click "Add connection" → type picker modal opens
3. Select ChirpStack → form shows name + optional server URL + API key fields
4. Fill name, click "Create connection" → success state shows webhook URL + bearer key
5. Close modal → integration card appears in the list
6. Click "Details" → expanded card shows stats and action buttons
7. Click "Deactivate" → card shows Inactive badge
8. Click "Rotate key" → warning modal, rotate, new key displayed
9. Click "Delete" with confirm → connection removed

- [ ] **Step 7: Commit**

```bash
git add web/src/app/dashboard/connections/page.tsx
git commit -m "feat: add Connections page for external integrations management"
```

---

## Task 6: Frontend — Add Connections to Sidebar

**Files:**
- Modify: `web/src/components/Sidebar.tsx`

- [ ] **Step 1: Add import for `Link2` icon**

The `Link2` icon is already imported from lucide-react in other files but needs to be in Sidebar. Add `Link2` to the existing lucide-react import:

```typescript
import {
  Home,
  Smartphone,
  BarChart3,
  FolderTree,
  LayoutGrid,
  Settings,
  ChevronRight,
  Activity,
  GitBranch,
  Building2,
  ChevronDown,
  Check,
  Users,
  Link2,
} from 'lucide-react';
```

- [ ] **Step 2: Add Connections entry to `navEntries`**

Add after the `Device Types` single entry and before the `Management` group:

```typescript
{ label: 'Connections', href: '/dashboard/connections', icon: <Link2 className="w-4 h-4" />, single: true },
```

The full `navEntries` array relevant section:
```typescript
{ label: 'Device Types', href: '/dashboard/device-types', icon: <LayoutGrid className="w-4 h-4" />, single: true },
{ label: 'Connections',  href: '/dashboard/connections',  icon: <Link2 className="w-4 h-4" />,    single: true },
{
  label: 'Management',
  icon: <Settings className="w-4 h-4" />,
  items: [
    { label: 'Alarms',        href: '/dashboard/alarms' },
    { label: 'Alert Rules',   href: '/dashboard/alert-rules' },
    { label: 'Notifications', href: '/dashboard/notifications' },
    { label: 'Users',         href: '/dashboard/users' },
    { label: 'Events',        href: '/dashboard/events' },
    { label: 'Settings',      href: '/dashboard/settings' },
  ],
},
```

- [ ] **Step 3: Manual test**

Verify "Connections" appears in the sidebar between "Device Types" and "Management". Clicking it navigates to `/dashboard/connections`. Active state highlights correctly.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Sidebar.tsx
git commit -m "feat: add Connections link to sidebar navigation"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| Connections page shows ChirpStack, TTN, Helium, Actility | Task 5 (providers list + CRUD) |
| ChirpStack: inbound webhook URL + outbound server URL/API key in one card | Task 5 (AddConnectionModal ChirpStack fields + ConnectionCard expanded view) |
| MQTT as a connection type | Tasks 1+2 (DB+enum) + Task 5 (PROVIDERS map) |
| HTTP ingest as a connection type | Tasks 1+2 (DB+enum) + Task 5 (PROVIDERS map) |
| Settings: remove Integrations tab, rename to Notifications (SMTP only) | Tasks 3+4 |
| Bearer key shown once on create | Task 5 (success state in AddConnectionModal) |
| Rotate key with warning | Task 5 (RotateKeyModal) |
| Delete connection | Task 5 (handleDelete) |
| Toggle active/inactive | Task 5 (handleToggle) |
| Sidebar navigation | Task 6 |
| Provider constraint in DB | Task 1 |

### Placeholder scan

No TBDs or TODOs in plan. All code blocks are complete.

### Type consistency

- `Integration` interface in Connections page uses `ProviderKey` union type — matches `ProviderEnum` values in backend
- `CreatedIntegration.setup_instructions` shape matches `SetupInstructions` schema
- `result.data` used for list response (matches `SuccessResponse` wrapper)
- `handleToggle` receives `result.data` from PUT response (matches `SuccessResponse` wrapper)
- `onDelete` uses `confirm()` — no async state issues since `deletingId` is set/cleared correctly
