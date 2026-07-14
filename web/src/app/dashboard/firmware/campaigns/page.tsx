'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ToastProvider';
import { OTACampaignStatusBadge } from '@/components/ui/Badge';
import { Trash2, Pencil, Rocket, HardDrive } from 'lucide-react';
import { btn, input } from '@/components/ui/buttonStyles';

interface FirmwareVersion {
  id: string;
  name: string;
  version: string;
}

interface Campaign {
  id: string;
  name: string;
  firmware_version_id: string;
  rollout_strategy: 'immediate' | 'staggered' | 'scheduled';
  devices_per_hour: number | null;
  auto_rollback_threshold: number | null;
  scheduled_at: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export default function OTACampaignsPage() {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [versions, setVersions] = useState<FirmwareVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);

  const loadData = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const [campaignsRes, versionsRes] = await Promise.all([
      fetch(`/api/v1/tenants/${tenant}/ota/campaigns?page=1&per_page=100`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`/api/v1/tenants/${tenant}/firmware/versions?page=1&per_page=100`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    if (campaignsRes.ok) setCampaigns((await campaignsRes.json()).data || []);
    if (versionsRes.ok) setVersions((await versionsRes.json()).data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const versionLabel = (id: string) => {
    const v = versions.find(v => v.id === id);
    return v ? `${v.name} (${v.version})` : id;
  };

  const deleteCampaign = async (id: string) => {
    const ok = await toast.confirm('Delete this draft campaign?', { title: 'Delete Campaign', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const res = await fetch(`/api/v1/tenants/${tenant}/ota/campaigns/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setCampaigns(prev => prev.filter(c => c.id !== id));
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error('Failed to delete campaign', e.detail || 'Only draft campaigns can be deleted.');
    }
  };

  return (
    <PageShell
      title="OTA Campaigns"
      subtitle="Roll out firmware updates to your fleet"
      action={
        <div className="flex items-center gap-2.5">
          <Link href="/dashboard/firmware/versions" className={btn.secondary}>
            <HardDrive className="w-4 h-4 inline mr-1.5 -mt-0.5" />Versions
          </Link>
          <button
            onClick={() => setShowNewForm(true)}
            className={`${btn.primary} flex items-center gap-2`}
            disabled={versions.length === 0}
            title={versions.length === 0 ? 'Register a firmware version first' : undefined}
          >
            <Rocket className="w-4 h-4" />New Campaign
          </button>
        </div>
      }
    >
      {versions.length === 0 && !loading && (
        <div className="gito-card p-4 mb-4 text-sm text-th-secondary">
          No firmware versions registered yet.{' '}
          <Link href="/dashboard/firmware/versions" className="text-primary-600 font-semibold hover:underline">Register one</Link>{' '}
          before creating a campaign.
        </div>
      )}

      {showNewForm && (
        <CampaignForm
          versions={versions}
          onSuccess={() => { setShowNewForm(false); loadData(); }}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {editingCampaign && (
        <CampaignForm
          campaign={editingCampaign}
          versions={versions}
          onSuccess={() => { setEditingCampaign(null); loadData(); }}
          onCancel={() => setEditingCampaign(null)}
        />
      )}

      {loading ? (
        <div className="gito-card p-8 text-center text-sm text-th-secondary">Loading...</div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<Rocket className="w-8 h-8" />}
          title="No OTA campaigns yet"
          description="Create a campaign to roll a firmware version out to your devices."
          action={versions.length > 0 ? { label: 'New Campaign', onClick: () => setShowNewForm(true) } : undefined}
        />
      ) : (
        <div className="gito-card overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
            <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
              <div className="col-span-3">Name</div>
              <div className="col-span-3">Firmware</div>
              <div className="col-span-2">Strategy</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {campaigns.map(c => (
              <div key={c.id} className="px-6 py-4 hover:bg-panel transition-colors">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-3">
                    <Link href={`/dashboard/firmware/campaigns/${c.id}`} className="text-sm font-semibold text-th-primary hover:text-primary-600 hover:underline">
                      {c.name}
                    </Link>
                  </div>
                  <div className="col-span-3">
                    <span className="text-sm text-th-muted">{versionLabel(c.firmware_version_id)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-th-primary capitalize">{c.rollout_strategy}</span>
                  </div>
                  <div className="col-span-2">
                    <OTACampaignStatusBadge status={c.status} />
                  </div>
                  <div className="col-span-2 flex gap-1 justify-end">
                    {c.status === 'draft' && (
                      <>
                        <button onClick={() => setEditingCampaign(c)} className={btn.icon} title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteCampaign(c.id)} className={btn.iconDanger} title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </>
                    )}
                    <Link href={`/dashboard/firmware/campaigns/${c.id}`} className={btn.secondary}>View</Link>
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

function CampaignForm({
  campaign,
  versions,
  onSuccess,
  onCancel,
}: {
  campaign?: Campaign;
  versions: FirmwareVersion[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [formData, setFormData] = useState({
    name: campaign?.name || '',
    firmware_version_id: campaign?.firmware_version_id || versions[0]?.id || '',
    rollout_strategy: campaign?.rollout_strategy || 'immediate',
    devices_per_hour: campaign?.devices_per_hour != null ? String(campaign.devices_per_hour) : '100',
    auto_rollback_threshold: campaign?.auto_rollback_threshold != null ? String(campaign.auto_rollback_threshold) : '0.1',
    scheduled_at: campaign?.scheduled_at ? campaign.scheduled_at.slice(0, 16) : '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.firmware_version_id) {
      toast.warning('Validation', 'Select a firmware version.');
      return;
    }
    if (formData.rollout_strategy === 'scheduled' && !formData.scheduled_at) {
      toast.warning('Validation', 'Scheduled campaigns need a scheduled date/time.');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    const url = campaign
      ? `/api/v1/tenants/${tenant}/ota/campaigns/${campaign.id}`
      : `/api/v1/tenants/${tenant}/ota/campaigns`;
    const method = campaign ? 'PUT' : 'POST';

    const basePayload = {
      name: formData.name,
      rollout_strategy: formData.rollout_strategy,
      devices_per_hour: Number(formData.devices_per_hour) || 100,
      auto_rollback_threshold: Number(formData.auto_rollback_threshold),
    };
    const payload = campaign
      ? basePayload
      : {
          ...basePayload,
          firmware_version_id: formData.firmware_version_id,
          scheduled_at: formData.rollout_strategy === 'scheduled' ? new Date(formData.scheduled_at).toISOString() : null,
        };

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      onSuccess();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error('Failed to save campaign', e.detail || 'Please check your input and try again.');
    }
  };

  return (
    <div className="gito-card p-6 mb-4">
      <h3 className="text-lg font-bold text-th-primary mb-1">{campaign ? 'Edit Campaign' : 'New OTA Campaign'}</h3>
      <p className="text-sm text-th-secondary mb-5">
        {campaign ? 'Draft campaigns can be edited before you execute them.' : 'Create a draft — you choose which devices to target when you execute it.'}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Campaign Name *</label>
            <input type="text" required value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} className={input.base} placeholder="e.g. Flow Meter fleet — v1.2.0" />
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Firmware Version *</label>
            <select
              value={formData.firmware_version_id}
              onChange={e => setFormData(prev => ({ ...prev, firmware_version_id: e.target.value }))}
              className={input.select}
              disabled={!!campaign}
              required
            >
              <option value="">Select firmware version...</option>
              {versions.map(v => (<option key={v.id} value={v.id}>{v.name} ({v.version})</option>))}
            </select>
            {campaign && <p className="text-xs text-th-muted mt-1">Firmware version can&apos;t change after a campaign is created — delete and recreate instead.</p>}
          </div>
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Rollout Strategy</label>
            <select value={formData.rollout_strategy} onChange={e => setFormData(prev => ({ ...prev, rollout_strategy: e.target.value as any }))} className={input.select} disabled={!!campaign}>
              <option value="immediate">Immediate — all target devices at once</option>
              <option value="staggered">Staggered — throttled by devices/hour</option>
              <option value="scheduled">Scheduled — starts at a future time</option>
            </select>
          </div>
          {formData.rollout_strategy === 'staggered' && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Devices per Hour</label>
              <input type="number" min={1} value={formData.devices_per_hour} onChange={e => setFormData(prev => ({ ...prev, devices_per_hour: e.target.value }))} className={input.base} />
            </div>
          )}
          {formData.rollout_strategy === 'scheduled' && !campaign && (
            <div>
              <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Scheduled At *</label>
              <input type="datetime-local" required value={formData.scheduled_at} onChange={e => setFormData(prev => ({ ...prev, scheduled_at: e.target.value }))} className={input.base} />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-th-muted uppercase tracking-wider mb-1.5">Auto-Rollback Threshold</label>
            <input type="number" min={0} max={1} step={0.05} value={formData.auto_rollback_threshold} onChange={e => setFormData(prev => ({ ...prev, auto_rollback_threshold: e.target.value }))} className={input.base} />
            <p className="text-xs text-th-muted mt-1">Fraction of devices that must fail (0–1) before Gito flags the campaign for rollback.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={btn.secondary}>Cancel</button>
          <button type="submit" className={btn.primary}>{campaign ? 'Update' : 'Create'} Campaign</button>
        </div>
      </form>
    </div>
  );
}
