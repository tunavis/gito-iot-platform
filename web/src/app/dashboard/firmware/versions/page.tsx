'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ToastProvider';
import { Badge, BadgeVariant } from '@/components/ui/Badge';
import { Trash2, UploadCloud, HardDrive, Rocket } from 'lucide-react';
import { btn, input } from '@/components/ui/buttonStyles';

interface FirmwareVersion {
  id: string;
  name: string;
  version: string;
  url: string;
  size_bytes: number;
  hash: string;
  release_type: 'beta' | 'production' | 'hotfix';
  changelog: string | null;
  created_at: string;
}

const RELEASE_TYPE_VARIANT: Record<string, BadgeVariant> = {
  production: 'success',
  hotfix: 'danger',
  beta: 'warning',
};

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export default function FirmwareVersionsPage() {
  const toast = useToast();
  const [versions, setVersions] = useState<FirmwareVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  const loadData = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/firmware/versions?page=1&per_page=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json();
      setVersions(json.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deleteVersion = async (id: string) => {
    const ok = await toast.confirm('Delete this firmware version? Campaigns referencing it will keep working, but you will no longer be able to target it in new campaigns.', { title: 'Delete Firmware Version', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/firmware/versions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setVersions(prev => prev.filter(v => v.id !== id));
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error('Failed to delete firmware version', e.detail || 'It may still be referenced by a campaign.');
    }
  };

  return (
    <PageShell
      title="Firmware Versions"
      subtitle="Upload and manage firmware images used by OTA campaigns"
      action={
        <div className="flex items-center gap-2.5">
          <Link href="/dashboard/firmware/campaigns" className={btn.secondary}>
            <Rocket className="w-4 h-4 inline mr-1.5 -mt-0.5" />Campaigns
          </Link>
          <button onClick={() => setShowNewForm(true)} className={`${btn.primary} flex items-center gap-2`}>
            <UploadCloud className="w-4 h-4" />Register Version
          </button>
        </div>
      }
    >
      {showNewForm && (
        <FirmwareVersionForm
          onSuccess={() => {
            setShowNewForm(false);
            loadData();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {loading ? (
        <div className="gito-card p-8 text-center text-sm text-th-secondary">Loading...</div>
      ) : versions.length === 0 ? (
        <EmptyState
          icon={<HardDrive className="w-8 h-8" />}
          title="No firmware versions yet"
          description="Register a firmware image (hosted URL + SHA256 hash) before you can create an OTA campaign."
          action={{ label: 'Register Version', onClick: () => setShowNewForm(true) }}
        />
      ) : (
        <div className="gito-card overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
            <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Version</div>
              <div className="col-span-2">Release Type</div>
              <div className="col-span-2">Size</div>
              <div className="col-span-2">Registered</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {versions.map(v => (
              <div key={v.id} className="px-6 py-4 hover:bg-panel transition-colors">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <p className="text-sm font-semibold text-th-primary">{v.name}</p>
                    {v.changelog && <p className="text-xs text-th-muted mt-0.5 truncate">{v.changelog}</p>}
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm font-mono text-th-primary">{v.version}</span>
                  </div>
                  <div className="col-span-2">
                    <Badge variant={RELEASE_TYPE_VARIANT[v.release_type] ?? 'neutral'} label={v.release_type} />
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-th-muted">{formatBytes(v.size_bytes)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-th-muted">{new Date(v.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => deleteVersion(v.id)} className={btn.iconDanger} title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}

function FirmwareVersionForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [formData, setFormData] = useState({
    name: '',
    version: '',
    url: '',
    size_bytes: '',
    hash: '',
    release_type: 'beta' as 'beta' | 'production' | 'hotfix',
    changelog: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!/^\d+\.\d+\.\d+$/.test(formData.version)) {
      toast.warning('Validation', 'Version must be in semver form, e.g. 1.2.0.');
      return;
    }
    const hash = formData.hash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      toast.warning('Validation', 'SHA256 hash must be exactly 64 hex characters.');
      return;
    }
    const sizeBytes = Number(formData.size_bytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      toast.warning('Validation', 'Size (bytes) must be a positive number.');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/firmware/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: formData.name,
        version: formData.version,
        url: formData.url,
        size_bytes: sizeBytes,
        hash,
        release_type: formData.release_type,
        changelog: formData.changelog || null,
      }),
    });

    if (res.ok) {
      onSuccess();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error('Failed to register firmware version', e.detail || 'Please check your input and try again.');
    }
  };

  return (
    <div className="gito-card p-6 mb-4">
      <h3 className="text-lg font-bold text-th-primary mb-1">Register Firmware Version</h3>
      <p className="text-sm text-th-secondary mb-5">
        Host the firmware image yourself (S3, CDN, etc.) and register its URL and SHA256 hash here — devices download and verify from that URL when a campaign dispatches to them.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Name *</label>
            <input type="text" required value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} className={input.base} placeholder="e.g. Flow Meter Firmware" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Version *</label>
            <input type="text" required value={formData.version} onChange={e => setFormData(prev => ({ ...prev, version: e.target.value }))} className={`${input.base} font-mono`} placeholder="1.2.0" />
            <p className="text-xs text-th-muted mt-1">Semantic version: major.minor.patch</p>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Firmware URL *</label>
            <input type="url" required value={formData.url} onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))} className={input.base} placeholder="https://cdn.example.com/firmware/flow-meter-1.2.0.bin" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Size (bytes) *</label>
            <input type="number" required min={1} value={formData.size_bytes} onChange={e => setFormData(prev => ({ ...prev, size_bytes: e.target.value }))} className={input.base} placeholder="e.g. 458752" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Release Type</label>
            <select value={formData.release_type} onChange={e => setFormData(prev => ({ ...prev, release_type: e.target.value as any }))} className={input.select}>
              <option value="beta">Beta</option>
              <option value="production">Production</option>
              <option value="hotfix">Hotfix</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">SHA256 Hash *</label>
            <input type="text" required value={formData.hash} onChange={e => setFormData(prev => ({ ...prev, hash: e.target.value }))} className={`${input.base} font-mono`} placeholder="64 hex characters" />
            <p className="text-xs text-th-muted mt-1">Devices verify the download against this hash before installing — get it from `sha256sum firmware.bin`.</p>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Changelog</label>
            <textarea value={formData.changelog} onChange={e => setFormData(prev => ({ ...prev, changelog: e.target.value }))} className={`${input.base} resize-none`} rows={2} placeholder="What changed in this version..." />
          </div>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>Register Version</button>
        </div>
      </form>
    </div>
  );
}
