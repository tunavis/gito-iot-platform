'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import {
  Link2, Plus, RefreshCw, Trash2, CheckCircle, XCircle,
  Copy, Check, AlertCircle, ExternalLink, Wifi, Server,
  Radio, Globe, Activity, Key,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type ProviderKey = 'chirpstack' | 'ttn' | 'helium' | 'actility' | 'mqtt' | 'http' | 'custom' | 'chirpstack_mqtt';

interface Integration {
  id: string;
  tenant_id: string;
  name: string;
  provider: ProviderKey;
  key_prefix: string | null;
  bridge_status?: string;
  config: Record<string, string>;
  is_active: boolean;
  last_used_at: string | null;
  message_count: number;
  unknown_device_count?: number;
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

interface CreatedMqttIntegration {
  id: string;
  name: string;
  provider: ProviderKey;
  broker_url: string;
  port: number;
  bridge_status: string;
  created_at: string;
}

// ── Provider metadata ──────────────────────────────────────────────────────────

const PROVIDERS: Record<ProviderKey, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  chirpstack: {
    label: 'ChirpStack Webhook',
    description: 'ChirpStack sends uplinks to Gito (inbound)',
    icon: <Radio className="w-5 h-5" />,
    color: 'text-purple-400',
  },
  chirpstack_mqtt: {
    label: 'ChirpStack MQTT',
    description: 'Gito subscribes to ChirpStack MQTT broker (outbound)',
    icon: <Server className="w-5 h-5" />,
    color: 'text-purple-300',
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

// ── BridgeStatusDot ────────────────────────────────────────────────────────────

function BridgeStatusDot({ status }: { status: string }) {
  const isConnected = status === 'connected';
  const isReconnecting = status === 'reconnecting';
  const isPending = status === 'pending';

  const color = isConnected
    ? 'bg-emerald-400'
    : isReconnecting
    ? 'bg-amber-400'
    : isPending
    ? 'bg-slate-400'
    : 'bg-red-400';

  const label = isConnected
    ? 'Connected'
    : isReconnecting
    ? 'Reconnecting…'
    : isPending
    ? 'Pending'
    : status.replace('error: ', '');

  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
      {label}
    </span>
  );
}

// ── UnknownDevicesPanel ────────────────────────────────────────────────────────

interface UnknownDevice {
  dev_eui: string;
  first_seen: string;
}

interface DeviceTypeOption {
  id: string;
  name: string;
}

function UnknownDevicesPanel({
  integrationId,
  tenantId,
}: {
  integrationId: string;
  tenantId: string;
}) {
  const router = useRouter();
  const [devices, setDevices] = useState<UnknownDevice[]>([]);
  const [types, setTypes] = useState<DeviceTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // bulk-register form state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typeId, setTypeId] = useState('');
  const [namePrefix, setNamePrefix] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    Promise.all([
      fetch(`/api/v1/tenants/${tenantId}/integrations/${integrationId}/unknown-devices`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`/api/v1/tenants/${tenantId}/device-types?is_active=true`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([unknownRes, typesRes]) => {
        setDevices((unknownRes.data ?? unknownRes).unknown_devices ?? []);
        setTypes((typesRes.data ?? []).map((t: any) => ({ id: t.id, name: t.name })));
      })
      .catch(() => {
        setError('Failed to load');
        setDevices([]);
      })
      .finally(() => setLoading(false));
  }, [integrationId, tenantId]);

  function toggle(devEui: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(devEui) ? next.delete(devEui) : next.add(devEui);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === devices.length ? new Set() : new Set(devices.map((d) => d.dev_eui)),
    );
  }

  async function handleBulkRegister() {
    if (selected.size === 0 || !typeId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/v1/tenants/${tenantId}/devices/bulk-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dev_euis: Array.from(selected),
          device_type_id: typeId,
          name_prefix: namePrefix.trim() || undefined,
          integration_id: integrationId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Bulk register failed');
      const data = json.data ?? json;
      // Drop the registered ones from the list
      setDevices((prev) => prev.filter((d) => !selected.has(d.dev_eui)));
      setSelected(new Set());
      setResult(data.message ?? `Registered ${data.registered} device(s)`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Bulk register failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-xs text-slate-400 py-2">Loading...</p>;
  if (error) return <p className="text-xs text-red-400 py-2">Could not load devices.</p>;
  if (devices.length === 0)
    return <p className="text-xs text-slate-400 py-2">No unregistered devices.</p>;

  return (
    <div className="mt-3 space-y-3">
      {/* Bulk register toolbar */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-lg p-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={selected.size === devices.length && devices.length > 0}
            ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < devices.length; }}
            onChange={toggleAll}
          />
          {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
        </label>
        <select
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200"
        >
          <option value="">Device type…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <input
          value={namePrefix}
          onChange={(e) => setNamePrefix(e.target.value)}
          placeholder="Name prefix (optional)"
          className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200 w-40"
        />
        <button
          onClick={handleBulkRegister}
          disabled={selected.size === 0 || !typeId || submitting}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 rounded font-medium"
        >
          {submitting ? 'Registering…' : `Register ${selected.size || ''} selected`}
        </button>
        {result && <span className="text-xs text-emerald-400">{result}</span>}
      </div>

      {/* Device rows */}
      {devices.map((d) => (
        <div key={d.dev_eui} className="flex items-center justify-between bg-slate-800 rounded px-3 py-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={selected.has(d.dev_eui)} onChange={() => toggle(d.dev_eui)} />
            <span>
              <span className="block text-xs font-mono text-slate-200">{d.dev_eui}</span>
              <span className="block text-xs text-slate-500">
                First seen {new Date(d.first_seen).toLocaleString()}
              </span>
            </span>
          </label>
          <button
            onClick={() =>
              router.push(`/dashboard/devices/new?dev_eui=${encodeURIComponent(d.dev_eui)}&source=bridge`)
            }
            className="text-xs text-slate-400 hover:text-indigo-400 px-2 py-1"
            title="Register with the full wizard instead"
          >
            wizard →
          </button>
        </div>
      ))}
    </div>
  );
}

// ── ConnectionCard ─────────────────────────────────────────────────────────────

function ConnectionCard({
  integration,
  tenantId,
  onToggle,
  onDelete,
  onRotate,
}: {
  integration: Integration;
  tenantId: string;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  onRotate: (id: string) => void;
}) {
  const meta = PROVIDERS[integration.provider] ?? PROVIDERS.custom;
  const [expanded, setExpanded] = useState(false);
  const [showUnknown, setShowUnknown] = useState(false);

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
          <p className="text-xs text-[var(--color-text-secondary)]">
            {meta.label}{integration.key_prefix ? ` · ${integration.key_prefix}...` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {integration.is_active
            ? <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle className="w-3.5 h-3.5" />Active</span>
            : <span className="flex items-center gap-1 text-xs text-slate-400"><XCircle className="w-3.5 h-3.5" />Inactive</span>
          }
          {integration.provider === 'chirpstack_mqtt' && integration.bridge_status && (
            <BridgeStatusDot status={integration.bridge_status} />
          )}
          {integration.provider === 'chirpstack_mqtt' && (integration.unknown_device_count ?? 0) > 0 && (
            <button
              onClick={() => setShowUnknown((v) => !v)}
              className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
            >
              <AlertCircle className="w-3 h-3" />
              {integration.unknown_device_count} unregistered device{integration.unknown_device_count !== 1 ? 's' : ''}
            </button>
          )}
          <span className="text-xs text-[var(--color-text-secondary)] pl-2 border-l border-[var(--color-border)]">
            {integration.message_count.toLocaleString()} msgs
          </span>
          <button
            onClick={() => setExpanded(e => !e)}
            className="ml-1 text-xs text-blue-400 hover:underline"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>

      {/* Unknown devices panel */}
      {showUnknown && integration.provider === 'chirpstack_mqtt' && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 bg-white/2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Unregistered devices</p>
          <UnknownDevicesPanel integrationId={integration.id} tenantId={tenantId} />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-4 space-y-3 bg-white/2">
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

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onToggle(integration.id, !integration.is_active)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {integration.is_active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
              {integration.is_active ? 'Deactivate' : 'Activate'}
            </button>
            {integration.provider !== 'chirpstack_mqtt' && (
              <button
                onClick={() => onRotate(integration.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-amber-400 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Rotate key
              </button>
            )}
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

// ── AddConnectionModal ─────────────────────────────────────────────────────────

type ModalStep = 'pick' | 'form' | 'success';

function AddConnectionModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [step, setStep] = useState<ModalStep>('pick');
  const [provider, setProvider] = useState<ProviderKey | null>(null);
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedIntegration | null>(null);
  const [brokerUrl, setBrokerUrl] = useState('');
  const [brokerPort, setBrokerPort] = useState('1883');
  const [mqttUsername, setMqttUsername] = useState('');
  const [mqttPassword, setMqttPassword] = useState('');
  const [mqttTls, setMqttTls] = useState(false);
  const [createdMqtt, setCreatedMqtt] = useState<CreatedMqttIntegration | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    const auth = getAuth();
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      if (provider === 'chirpstack_mqtt') {
        const config: Record<string, unknown> = {
          broker_url: brokerUrl.trim(),
          port: parseInt(brokerPort, 10) || 1883,
          tls: mqttTls,
        };
        if (mqttUsername.trim()) config.username = mqttUsername.trim();
        if (mqttPassword) config.password = mqttPassword;

        const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({ name, provider, config }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || 'Failed to create connection');
        }
        const data: CreatedMqttIntegration = await res.json();
        setCreatedMqtt(data);
        setStep('success');
        return;
      }

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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[var(--color-panel)] border border-[var(--color-border)] shadow-2xl overflow-hidden">
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

            {/* chirpstack_mqtt: outbound MQTT broker config */}
            {provider === 'chirpstack_mqtt' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Broker address
                  </label>
                  <input
                    value={brokerUrl}
                    onChange={e => setBrokerUrl(e.target.value)}
                    placeholder="10.0.0.5"
                    required
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Port
                  </label>
                  <input
                    value={brokerPort}
                    onChange={e => setBrokerPort(e.target.value)}
                    placeholder="1883"
                    type="number"
                    min={1}
                    max={65535}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Username <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span>
                  </label>
                  <input
                    value={mqttUsername}
                    onChange={e => setMqttUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Password <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span>
                  </label>
                  <input
                    type="password"
                    value={mqttPassword}
                    onChange={e => setMqttPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mqttTls}
                    onChange={e => setMqttTls(e.target.checked)}
                    className="rounded"
                  />
                  Use TLS
                </label>
              </>
            )}

            {/* ChirpStack-specific: outbound config */}
            {provider === 'chirpstack' && (
              <>
                <p className="text-xs text-[var(--color-text-secondary)] pt-1">
                  Optional: provide your ChirpStack server details so Gito can send downlinks and sync devices.
                </p>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    ChirpStack server URL <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span>
                  </label>
                  <input
                    value={serverUrl}
                    onChange={e => setServerUrl(e.target.value)}
                    placeholder="https://chirpstack.example.com"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    ChirpStack API key <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span>
                  </label>
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

        {/* Step: success — MQTT bridge */}
        {step === 'success' && createdMqtt && (
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              Bridge created — connecting to ChirpStack MQTT…
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5">Broker</p>
              <div className="flex items-center gap-2 font-mono text-xs bg-black/20 rounded-lg px-3 py-2">
                <span className="flex-1 text-[var(--color-text-primary)]">
                  {createdMqtt.broker_url}:{createdMqtt.port}
                </span>
                <CopyButton value={`${createdMqtt.broker_url}:${createdMqtt.port}`} />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5">Status</p>
              <BridgeStatusDot status={createdMqtt.bridge_status} />
            </div>

            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              Make sure your devices are registered in Gito with matching <span className="font-mono">dev_eui</span> values.
              Uplinks will flow automatically once the bridge connects (typically within 60 seconds).
            </p>

            <button onClick={onClose} className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors">
              Done
            </button>
          </div>
        )}

        {/* Step: success — webhook */}
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

// ── ConnectionsPage ────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const auth = getAuth();
  const tenantId = auth?.tenantId ?? '';

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);

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

  // Auto-refresh every 10s if any MQTT bridge integration is present
  useEffect(() => {
    const hasBridge = integrations.some(i => i.provider === 'chirpstack_mqtt');
    if (!hasBridge) return;
    const interval = setInterval(fetchIntegrations, 10_000);
    return () => clearInterval(interval);
  }, [integrations, fetchIntegrations]);

  const handleToggle = useCallback(async (id: string, active: boolean) => {
    const auth = getAuth();
    if (!auth) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ is_active: active }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      const updated: Integration = result.data;
      setIntegrations(prev => prev.map(i => i.id === id ? updated : i));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const auth = getAuth();
    if (!auth) return;
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/integrations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setIntegrations(prev => prev.filter(i => i.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

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
                tenantId={tenantId}
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
          onClose={() => { setShowAdd(false); fetchIntegrations(); }}
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
