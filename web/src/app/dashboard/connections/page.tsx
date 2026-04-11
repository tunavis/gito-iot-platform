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
          {integration.is_active
            ? <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle className="w-3.5 h-3.5" />Active</span>
            : <span className="flex items-center gap-1 text-xs text-slate-400"><XCircle className="w-3.5 h-3.5" />Inactive</span>
          }
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
