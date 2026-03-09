'use client';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '@/components/ui/PageShell';
import {
  User, Globe, Link2, Database, Save, Check, AlertCircle,
  Mail, Clock, Server, Key, Wifi, Settings,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntegrationsConfig {
  mqtt_broker_url?: string;
  chirpstack_api_key?: string;
  chirpstack_server?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_from?: string;
}

interface TenantProfile {
  id: string;
  name: string;
  slug: string;
  status: string;
  contact_email?: string;
  timezone?: string;
  retention_days: number;
  integrations: IntegrationsConfig;
}

type Tab = 'profile' | 'integrations' | 'retention';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getAuth() {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return { token, tenantId: payload.tenant_id as string };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-4 py-4 border-b border-[var(--color-border)] last:border-0">
      <div className="sm:col-span-1">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
        {hint && <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{hint}</p>}
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

function SaveButton({ loading, saved }: { loading: boolean; saved: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
    >
      {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
      {loading ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
    </button>
  );
}

// ── Tab content ────────────────────────────────────────────────────────────────

function ProfileTab({
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
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.contact_email ?? '');
  const [tz, setTz] = useState(profile.timezone ?? '');

  useEffect(() => {
    setName(profile.name);
    setEmail(profile.contact_email ?? '');
    setTz(profile.timezone ?? '');
  }, [profile]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ name, contact_email: email || undefined, timezone: tz || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-0">
      <FieldRow label="Tenant name" hint="The display name for your organisation">
        <Input value={name} onChange={setName} placeholder="My Company" />
      </FieldRow>
      <FieldRow label="Slug" hint="Unique URL-safe identifier (read-only)">
        <Input value={profile.slug} onChange={() => {}} disabled />
      </FieldRow>
      <FieldRow label="Status" hint="Current account status">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
          ${profile.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
          {profile.status}
        </span>
      </FieldRow>
      <FieldRow label="Contact email" hint="Primary contact for billing and alerts">
        <Input value={email} onChange={setEmail} placeholder="ops@company.com" type="email" />
      </FieldRow>
      <FieldRow label="Timezone" hint="Used for scheduled reports and event timestamps">
        <Input value={tz} onChange={setTz} placeholder="Africa/Johannesburg" />
      </FieldRow>
      <div className="pt-4 flex justify-end">
        <SaveButton loading={saving} saved={saved} />
      </div>
    </form>
  );
}

function IntegrationsTab({
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
  const [mqttUrl, setMqttUrl] = useState(integ.mqtt_broker_url ?? '');
  const [csServer, setCsServer] = useState(integ.chirpstack_server ?? '');
  const [csKey, setCsKey] = useState(integ.chirpstack_api_key ?? '');
  const [smtpHost, setSmtpHost] = useState(integ.smtp_host ?? '');
  const [smtpPort, setSmtpPort] = useState(String(integ.smtp_port ?? ''));
  const [smtpUser, setSmtpUser] = useState(integ.smtp_user ?? '');
  const [smtpFrom, setSmtpFrom] = useState(integ.smtp_from ?? '');

  useEffect(() => {
    const i = profile.integrations ?? {};
    setMqttUrl(i.mqtt_broker_url ?? '');
    setCsServer(i.chirpstack_server ?? '');
    setCsKey(i.chirpstack_api_key ?? '');
    setSmtpHost(i.smtp_host ?? '');
    setSmtpPort(String(i.smtp_port ?? ''));
    setSmtpUser(i.smtp_user ?? '');
    setSmtpFrom(i.smtp_from ?? '');
  }, [profile]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      integrations: {
        mqtt_broker_url: mqttUrl || undefined,
        chirpstack_server: csServer || undefined,
        chirpstack_api_key: csKey || undefined,
        smtp_host: smtpHost || undefined,
        smtp_port: smtpPort ? parseInt(smtpPort) : undefined,
        smtp_user: smtpUser || undefined,
        smtp_from: smtpFrom || undefined,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* MQTT */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Wifi className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">MQTT Broker</h3>
        </div>
        <div className="space-y-0 rounded-xl border border-[var(--color-border)] px-4 bg-[var(--color-panel)]">
          <FieldRow label="Broker URL" hint="mqtt:// or mqtts:// connection string">
            <Input value={mqttUrl} onChange={setMqttUrl} placeholder="mqtt://broker.example.com:1883" />
          </FieldRow>
        </div>
      </div>

      {/* ChirpStack */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Server className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">ChirpStack / LoRaWAN</h3>
        </div>
        <div className="space-y-0 rounded-xl border border-[var(--color-border)] px-4 bg-[var(--color-panel)]">
          <FieldRow label="Server URL" hint="ChirpStack gRPC or REST endpoint">
            <Input value={csServer} onChange={setCsServer} placeholder="https://chirpstack.example.com" />
          </FieldRow>
          <FieldRow label="API Key" hint="ChirpStack application API key">
            <Input value={csKey} onChange={setCsKey} placeholder="eyJ…" type="password" />
          </FieldRow>
        </div>
      </div>

      {/* SMTP */}
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

function RetentionTab({
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
  const options = [
    { value: 7,    label: '7 days',   desc: 'Short-term — minimal storage' },
    { value: 30,   label: '30 days',  desc: 'Standard — one month rolling window' },
    { value: 90,   label: '90 days',  desc: 'Extended — quarterly data' },
    { value: 365,  label: '1 year',   desc: 'Annual — full operational year' },
    { value: 1825, label: '5 years',  desc: 'Long-term — compliance and auditing' },
  ];
  const [selected, setSelected] = useState(profile.retention_days ?? 90);

  useEffect(() => setSelected(profile.retention_days ?? 90), [profile]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ retention_days: selected });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Configure how long telemetry data is stored. Shorter retention reduces storage costs;
        longer periods support auditing and trend analysis.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setSelected(opt.value)}
            className={`text-left p-4 rounded-xl border transition-colors ${
              selected === opt.value
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-[var(--color-border)] bg-[var(--color-panel)] hover:border-blue-400'
            }`}
          >
            <p className={`text-sm font-semibold ${selected === opt.value ? 'text-blue-400' : 'text-[var(--color-text-primary)]'}`}>
              {opt.label}
            </p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
      <div className="flex justify-end pt-2">
        <SaveButton loading={saving} saved={saved} />
      </div>
    </form>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    const auth = getAuth();
    if (!auth) return;
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/settings/profile`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setProfile(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleSave = useCallback(async (patch: Partial<TenantProfile>) => {
    const auth = getAuth();
    if (!auth || !profile) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/v1/tenants/${auth.tenantId}/settings/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      setProfile(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [profile]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',      label: 'Profile',      icon: <User className="w-4 h-4" /> },
    { id: 'integrations', label: 'Integrations', icon: <Link2 className="w-4 h-4" /> },
    { id: 'retention',    label: 'Retention',    icon: <Database className="w-4 h-4" /> },
  ];

  return (
    <PageShell
      title="Settings"
      subtitle="Manage tenant profile, integrations, and data retention"
      icon={<Settings className="w-5 h-5" />}
    >
    <div className="max-w-4xl mx-auto space-y-6">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-[var(--color-text-secondary)] text-sm">
          Loading settings…
        </div>
      ) : profile ? (
        <div className="gito-card rounded-xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[var(--color-border)] px-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-6">
            {activeTab === 'profile' && (
              <ProfileTab profile={profile} onSave={handleSave} saving={saving} saved={saved} />
            )}
            {activeTab === 'integrations' && (
              <IntegrationsTab profile={profile} onSave={handleSave} saving={saving} saved={saved} />
            )}
            {activeTab === 'retention' && (
              <RetentionTab profile={profile} onSave={handleSave} saving={saving} saved={saved} />
            )}
          </div>
        </div>
      ) : null}
    </div>
    </PageShell>
  );
}
