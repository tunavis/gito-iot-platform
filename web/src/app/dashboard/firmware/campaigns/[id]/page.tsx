'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/ui/PageShell';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ToastProvider';
import { OTACampaignStatusBadge, OTADeviceStatusBadge } from '@/components/ui/Badge';
import { ArrowLeft, PlayCircle, RefreshCw } from 'lucide-react';
import { btn } from '@/components/ui/buttonStyles';

interface Campaign {
  id: string;
  name: string;
  firmware_version_id: string;
  rollout_strategy: string;
  devices_per_hour: number | null;
  auto_rollback_threshold: number | null;
  scheduled_at: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface FirmwareVersion {
  id: string;
  name: string;
  version: string;
}

interface Device {
  id: string;
  name: string;
  device_type: string;
  status: string;
}

interface CampaignDeviceStatus {
  id: string;
  device_id: string;
  status: string;
  progress_percent: number;
  error_message: string | null;
}

interface StatusResponse {
  status: string;
  progress_percent: number;
  total_devices: number;
  by_status: Record<string, number>;
  devices: CampaignDeviceStatus[];
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [firmware, setFirmware] = useState<FirmwareVersion | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExecuteModal, setShowExecuteModal] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) { router.push('/auth/login'); return null; }
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    return { token, tenant, headers: { Authorization: `Bearer ${token}` } };
  }, [router]);

  const loadCampaign = useCallback(async () => {
    const auth = authHeaders();
    if (!auth) return;

    const res = await fetch(`/api/v1/tenants/${auth.tenant}/ota/campaigns/${campaignId}`, { headers: auth.headers });
    if (!res.ok) { setLoading(false); return; }
    const c: Campaign = await res.json();
    setCampaign(c);

    const fwRes = await fetch(`/api/v1/tenants/${auth.tenant}/firmware/versions/${c.firmware_version_id}`, { headers: auth.headers });
    if (fwRes.ok) setFirmware(await fwRes.json());

    if (c.status !== 'draft') {
      const statusRes = await fetch(`/api/v1/tenants/${auth.tenant}/ota/campaigns/${campaignId}/status`, { headers: auth.headers });
      if (statusRes.ok) setStatusData(await statusRes.json());
    }
    setLoading(false);
  }, [authHeaders, campaignId]);

  const loadDevices = useCallback(async () => {
    const auth = authHeaders();
    if (!auth) return;
    const res = await fetch(`/api/v1/tenants/${auth.tenant}/devices`, { headers: auth.headers });
    if (res.ok) setDevices((await res.json()).data || []);
  }, [authHeaders]);

  useEffect(() => {
    loadCampaign();
    loadDevices();
  }, [loadCampaign, loadDevices]);

  // Poll status while a campaign is actively rolling out.
  useEffect(() => {
    if (campaign?.status === 'in_progress') {
      pollRef.current = setInterval(loadCampaign, 5000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [campaign?.status, loadCampaign]);

  const deviceName = (id: string) => devices.find(d => d.id === id)?.name || id;

  if (loading) {
    return (
      <PageShell title="Campaign" subtitle="Loading...">
        <div className="gito-card p-8 text-center text-sm text-th-secondary">Loading...</div>
      </PageShell>
    );
  }

  if (!campaign) {
    return (
      <PageShell title="Campaign not found">
        <div className="gito-card p-8 text-center text-sm text-th-secondary">
          This campaign doesn&apos;t exist or you don&apos;t have access to it.
          <div className="mt-4"><Link href="/dashboard/firmware/campaigns" className={btn.secondary}>Back to Campaigns</Link></div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={campaign.name}
      subtitle={firmware ? `${firmware.name} (${firmware.version})` : undefined}
      action={
        <div className="flex items-center gap-2.5">
          <Link href="/dashboard/firmware/campaigns" className={btn.secondary}>
            <ArrowLeft className="w-4 h-4 inline mr-1.5 -mt-0.5" />Back
          </Link>
          {campaign.status === 'draft' && (
            <button onClick={() => setShowExecuteModal(true)} className={`${btn.primary} flex items-center gap-2`}>
              <PlayCircle className="w-4 h-4" />Execute Campaign
            </button>
          )}
          {campaign.status === 'in_progress' && (
            <button onClick={loadCampaign} className={`${btn.secondary} flex items-center gap-2`}>
              <RefreshCw className="w-4 h-4" />Refresh
            </button>
          )}
        </div>
      }
    >
      <div className="gito-card p-6 mb-4">
        <div className="grid grid-cols-4 gap-6">
          <div>
            <p className="text-[10px] font-bold text-th-muted uppercase tracking-widest mb-1">Status</p>
            <OTACampaignStatusBadge status={campaign.status} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-th-muted uppercase tracking-widest mb-1">Rollout Strategy</p>
            <p className="text-sm font-semibold text-th-primary capitalize">{campaign.rollout_strategy}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-th-muted uppercase tracking-widest mb-1">Started</p>
            <p className="text-sm text-th-primary">{campaign.started_at ? new Date(campaign.started_at).toLocaleString() : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-th-muted uppercase tracking-widest mb-1">Completed</p>
            <p className="text-sm text-th-primary">{campaign.completed_at ? new Date(campaign.completed_at).toLocaleString() : '—'}</p>
          </div>
        </div>
      </div>

      {campaign.status === 'draft' && (
        <div className="gito-card p-8 text-center text-sm text-th-secondary">
          This campaign is still a draft — nothing has been dispatched to devices yet. Click <strong>Execute Campaign</strong> to choose target devices and start the rollout.
        </div>
      )}

      {statusData && (
        <>
          <div className="gito-card p-6 mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-th-primary">Overall Progress</p>
              <p className="text-sm text-th-muted">{statusData.progress_percent}% complete ({statusData.total_devices} devices)</p>
            </div>
            <div className="w-full h-2 rounded-full bg-panel overflow-hidden">
              <div className="h-full bg-primary-600 transition-all" style={{ width: `${statusData.progress_percent}%` }} />
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {Object.entries(statusData.by_status).map(([status, count]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <OTADeviceStatusBadge status={status} />
                  <span className="text-xs text-th-muted">×{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="gito-card overflow-hidden">
            <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
              <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
                <div className="col-span-4">Device</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Progress</div>
                <div className="col-span-4">Error</div>
              </div>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {statusData.devices.map(d => (
                <div key={d.id} className="px-6 py-3 hover:bg-panel transition-colors">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-4">
                      <Link href={`/dashboard/devices/${d.device_id}`} className="text-sm font-medium text-th-primary hover:text-primary-600 hover:underline">
                        {deviceName(d.device_id)}
                      </Link>
                    </div>
                    <div className="col-span-2"><OTADeviceStatusBadge status={d.status} /></div>
                    <div className="col-span-2 text-sm text-th-muted">{d.progress_percent}%</div>
                    <div className="col-span-4 text-sm text-red-500 truncate">{d.error_message || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {showExecuteModal && (
        <ExecuteModal
          devices={devices}
          onClose={() => setShowExecuteModal(false)}
          onExecute={async (deviceIds) => {
            const auth = authHeaders();
            if (!auth) return;
            const res = await fetch(`/api/v1/tenants/${auth.tenant}/ota/campaigns/${campaignId}/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...auth.headers },
              body: JSON.stringify({ device_ids: deviceIds, start_immediately: true }),
            });
            if (res.ok) {
              const result = await res.json();
              toast.success('Campaign executed', `Dispatched to ${result.dispatched}/${result.total} devices${result.failed ? `, ${result.failed} failed to dispatch` : ''}.`);
              setShowExecuteModal(false);
              loadCampaign();
            } else {
              const e = await res.json().catch(() => ({}));
              toast.error('Failed to execute campaign', e.detail || 'Please try again.');
            }
          }}
        />
      )}
    </PageShell>
  );
}

function ExecuteModal({
  devices,
  onClose,
  onExecute,
}: {
  devices: Device[];
  onClose: () => void;
  onExecute: (deviceIds: string[] | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<'all' | 'select'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleExecute = async () => {
    setSubmitting(true);
    try {
      await onExecute(mode === 'all' ? null : Array.from(selected));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Execute Campaign" subtitle="Choose which devices to target" size="lg" scrollBody>
      <div className="space-y-4">
        <div className="flex gap-3">
          <label className={`flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${mode === 'all' ? 'border-primary-500 bg-primary-500/5' : 'border-th-default'}`}>
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
            <span className="text-sm font-medium text-th-primary">All devices ({devices.length})</span>
          </label>
          <label className={`flex-1 flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${mode === 'select' ? 'border-primary-500 bg-primary-500/5' : 'border-th-default'}`}>
            <input type="radio" checked={mode === 'select'} onChange={() => setMode('select')} />
            <span className="text-sm font-medium text-th-primary">Select specific devices</span>
          </label>
        </div>

        {mode === 'select' && (
          <div className="border border-th-default rounded-lg divide-y divide-[var(--color-border)] max-h-64 overflow-y-auto">
            {devices.length === 0 ? (
              <p className="p-4 text-sm text-th-secondary">No devices available.</p>
            ) : devices.map(d => (
              <label key={d.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel cursor-pointer">
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                <span className="text-sm text-th-primary flex-1">{d.name}</span>
                <span className="text-xs text-th-muted">{d.device_type}</span>
              </label>
            ))}
          </div>
        )}

        <p className="text-xs text-th-muted">
          This dispatches the firmware update immediately over each device&apos;s native protocol (MQTT/HTTP/LoRaWAN) — there&apos;s no undo once devices start downloading.
        </p>

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
          <button
            type="button"
            onClick={handleExecute}
            disabled={submitting || (mode === 'select' && selected.size === 0)}
            className={`${btn.primary} disabled:opacity-50`}
          >
            {submitting ? 'Dispatching...' : 'Execute Now'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
