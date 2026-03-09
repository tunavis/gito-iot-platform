'use client';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '@/components/ui/PageShell';
import {
  Building2, Plus, Smartphone, Users, AlertTriangle,
  CheckCircle2, XCircle, X, Eye, RefreshCw, Loader2,
} from 'lucide-react';
import { useTenant, TenantInfo } from '@/components/TenantContext';
import { useRouter } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────

interface TenantDetail extends TenantInfo {
  slug: string;
  created_at?: string;
  updated_at?: string;
}

interface CreateForm {
  name: string;
  slug: string;
  admin_email: string;
  admin_name: string;
  admin_password: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getAuth() {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { token, tenantType: payload.tenant_type as string };
  } catch { return null; }
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === 'active';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'
    }`}>
      {isActive
        ? <CheckCircle2 className="w-3 h-3" />
        : <XCircle className="w-3 h-3" />
      }
      {status}
    </span>
  );
}

// ── Create Tenant Modal ────────────────────────────────────────────────────

function CreateTenantModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: { tenant: TenantDetail; admin_email: string; admin_password: string }) => void;
}) {
  const [form, setForm] = useState<CreateForm>({
    name: '', slug: '', admin_email: '', admin_name: '', admin_password: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const auth = getAuth();
    if (!auth) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/tenants', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          admin_email: form.admin_email,
          admin_name: form.admin_name,
          admin_password: form.admin_password || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || `HTTP ${res.status}`);
      }
      onCreated(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="gito-card rounded-2xl w-full max-w-md shadow-2xl" style={{ background: 'var(--color-panel)' }}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">New Client Tenant</h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Creates a new isolated tenant with its own login</p>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Company Name</label>
            <input
              required value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: autoSlug(e.target.value) }))}
              placeholder="Sasol Ltd"
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Slug (URL identifier)</label>
            <input
              required value={form.slug}
              onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
              placeholder="sasol"
              pattern="^[a-z0-9-]+$"
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-3 uppercase tracking-wide">First Admin User</p>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Admin Email</label>
                <input
                  required type="email" value={form.admin_email}
                  onChange={e => setForm(f => ({ ...f, admin_email: e.target.value }))}
                  placeholder="admin@sasol.co.za"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Admin Full Name</label>
                <input
                  required value={form.admin_name}
                  onChange={e => setForm(f => ({ ...f, admin_name: e.target.value }))}
                  placeholder="Sasol Administrator"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Password <span className="opacity-50">(leave blank to auto-generate)</span>
                </label>
                <input
                  type="password" value={form.admin_password}
                  onChange={e => setForm(f => ({ ...f, admin_password: e.target.value }))}
                  placeholder="Auto-generate"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? 'Creating…' : 'Create Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Credentials reveal modal ───────────────────────────────────────────────

function CredentialsModal({
  email, password, tenantName, onClose,
}: {
  email: string; password: string; tenantName: string; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="gito-card rounded-2xl w-full max-w-sm shadow-2xl" style={{ background: 'var(--color-panel)' }}>
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 text-emerald-400 mb-1">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-semibold text-[var(--color-text-primary)]">Tenant Created</span>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            <strong>{tenantName}</strong> is ready. Share these credentials with the client.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">Login Email</p>
            <p className="text-sm font-mono text-[var(--color-text-primary)] bg-[var(--color-bg)] px-3 py-2 rounded-lg border border-[var(--color-border)]">{email}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">Temporary Password</p>
            <p className="text-sm font-mono text-amber-400 bg-[var(--color-bg)] px-3 py-2 rounded-lg border border-amber-500/30">{password}</p>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] opacity-70">
            This password will not be shown again. Copy it now.
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tenant Card ────────────────────────────────────────────────────────────

function TenantCard({
  tenant,
  onView,
}: {
  tenant: TenantDetail;
  onView: (t: TenantDetail) => void;
}) {
  const alarmColor = tenant.active_alarms > 0 ? 'text-red-400' : 'text-[var(--color-text-secondary)]';

  return (
    <div className={`gito-card rounded-2xl p-5 flex flex-col gap-4 transition-all hover:border-[var(--color-border-hover)] ${
      tenant.status !== 'active' ? 'opacity-60' : ''
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' }}
          >
            {tenant.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)] leading-tight">{tenant.name}</p>
            <p className="text-xs font-mono text-[var(--color-text-secondary)] opacity-60">{tenant.slug}</p>
          </div>
        </div>
        <StatusBadge status={tenant.status} />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <p className="text-lg font-bold text-[var(--color-text-primary)]">{tenant.device_count}</p>
          <p className="text-[10px] text-[var(--color-text-secondary)] flex items-center justify-center gap-1">
            <Smartphone className="w-3 h-3" /> Devices
          </p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-[var(--color-text-primary)]">{tenant.user_count}</p>
          <p className="text-[10px] text-[var(--color-text-secondary)] flex items-center justify-center gap-1">
            <Users className="w-3 h-3" /> Users
          </p>
        </div>
        <div className="text-center">
          <p className={`text-lg font-bold ${alarmColor}`}>{tenant.active_alarms}</p>
          <p className={`text-[10px] flex items-center justify-center gap-1 ${alarmColor}`}>
            <AlertTriangle className="w-3 h-3" /> Alarms
          </p>
        </div>
      </div>

      {/* Action */}
      <button
        onClick={() => onView(tenant)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-blue-400 hover:border-blue-500/40 transition-colors"
      >
        <Eye className="w-4 h-4" />
        View Tenant
      </button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string; tenantName: string } | null>(null);

  const { switchToTenant } = useTenant();
  const router = useRouter();

  const fetchTenants = useCallback(async (isRefresh = false) => {
    const auth = getAuth();
    if (!auth) return;
    if (auth.tenantType !== 'management') {
      setError('Access denied: management tenant required');
      setLoading(false);
      return;
    }
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/tenants', {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTenants(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  function handleCreated(result: { tenant: TenantDetail; admin_email: string; admin_password: string }) {
    setShowCreate(false);
    setTenants(prev => [...prev, result.tenant]);
    setCreatedCreds({
      email: result.admin_email,
      password: result.admin_password,
      tenantName: result.tenant.name,
    });
  }

  function handleView(tenant: TenantDetail) {
    switchToTenant(tenant);
    router.push('/dashboard');
  }

  return (
    <PageShell
      title="Tenant Management"
      subtitle="Create and manage client tenants — each with full data isolation"
      icon={<Building2 className="w-5 h-5" />}
      action={
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchTenants(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Tenant
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="gito-card rounded-2xl p-5 h-44 animate-pulse" />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-[var(--color-text-secondary)]">
            <Building2 className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No client tenants yet</p>
            <p className="text-xs mt-1 opacity-60">Create your first client tenant to get started</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Create First Tenant
            </button>
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
              <span>{tenants.length} {tenants.length === 1 ? 'tenant' : 'tenants'}</span>
              <span className="text-emerald-400">{tenants.filter(t => t.status === 'active').length} active</span>
              {tenants.some(t => t.active_alarms > 0) && (
                <span className="text-red-400">
                  {tenants.reduce((s, t) => s + t.active_alarms, 0)} active alarms
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tenants.map(t => (
                <TenantCard key={t.id} tenant={t} onView={handleView} />
              ))}
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <CreateTenantModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {createdCreds && (
        <CredentialsModal
          email={createdCreds.email}
          password={createdCreds.password}
          tenantName={createdCreds.tenantName}
          onClose={() => setCreatedCreds(null)}
        />
      )}
    </PageShell>
  );
}
