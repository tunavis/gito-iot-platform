'use client';

import { useEffect, useMemo, useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import { useRouter } from 'next/navigation';
import {
  Bell,
  AlertOctagon,
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  Filter,
  User,
  Check,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import StatCard from '@/components/ui/StatCard';
import { AlarmSeverityBadge, AlarmStatusBadge } from '@/components/ui/Badge';
import { btn, input } from '@/components/ui/buttonStyles';

type AlarmSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING';
type AlarmStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED';

interface Alarm {
  id: string;
  tenant_id: string;
  device_id: string;
  alert_rule_id?: string | null;
  alarm_type: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  message?: string | null;
  source?: string | null;
  metric_name?: string | null;
  metric_value?: number | null;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  cleared_at?: string | null;
  fired_at: string;
}

interface PaginationMeta { page: number; per_page: number; total: number }

export default function AlarmsPage() {
  const router = useRouter();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlarmId, setSelectedAlarmId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<AlarmSeverity | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AlarmStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) { router.push('/auth/login'); return; }

        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;

        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('page_size', '50');
        if (severityFilter !== 'all') params.set('severity', severityFilter);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (typeFilter.trim()) params.set('alarm_type', typeFilter.trim());

        const res = await fetch(`/api/v1/tenants/${tenant}/alarms?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || 'Failed to load alarms');
        setAlarms(json.alarms || []);
        setMeta({ page: json.page, per_page: json.page_size, total: json.total });
        if (!selectedAlarmId && json.alarms?.length) setSelectedAlarmId(json.alarms[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load alarms');
      } finally { setLoading(false); }
    };
    load();
  }, [router, page, severityFilter, statusFilter, typeFilter, selectedAlarmId]);

  const selectedAlarm = useMemo(() => alarms.find(a => a.id === selectedAlarmId) || null, [alarms, selectedAlarmId]);

  const stats = useMemo(() => ({
    total: alarms.length,
    active: alarms.filter(a => a.status === 'ACTIVE').length,
    acknowledged: alarms.filter(a => a.status === 'ACKNOWLEDGED').length,
    cleared: alarms.filter(a => a.status === 'CLEARED').length,
    critical: alarms.filter(a => a.severity === 'CRITICAL').length,
  }), [alarms]);

  const acknowledge = async (alarmId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const payload = JSON.parse(atob(token.split('.')[1]));
    const tenant = payload.tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/alarms/${alarmId}/acknowledge`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (res.ok) {
      setAlarms(prev => prev.map(a => a.id === alarmId ? json : a));
    }
  };

  const clear = async (alarmId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const payload = JSON.parse(atob(token.split('.')[1]));
    const tenant = payload.tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/alarms/${alarmId}/clear`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (res.ok) {
      setAlarms(prev => prev.map(a => a.id === alarmId ? json : a));
    }
  };

  const getSeverityIcon = (s: AlarmSeverity) => {
    switch (s) {
      case 'CRITICAL': return <AlertOctagon className="w-4 h-4" />;
      case 'MAJOR': return <ShieldAlert className="w-4 h-4" />;
      case 'MINOR': return <AlertTriangle className="w-4 h-4" />;
      case 'WARNING': return <Info className="w-4 h-4" />;
    }
  };

  return (
    <PageShell
      title="Alarm Management"
      subtitle="Monitor and manage alarms across your devices"
      icon={<Bell className="w-6 h-6" />}
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard label="Total" value={meta?.total || 0} icon={<Bell className="w-4 h-4" />} />
          <StatCard label="Active" value={stats.active} icon={<AlertOctagon className="w-4 h-4" />} accent="#dc2626" color="#dc2626" />
          <StatCard label="Acknowledged" value={stats.acknowledged} icon={<Clock className="w-4 h-4" />} accent="#d97706" color="#d97706" />
          <StatCard label="Cleared" value={stats.cleared} icon={<CheckCircle2 className="w-4 h-4" />} accent="#16a34a" color="#16a34a" />
          <StatCard label="Critical" value={stats.critical} icon={<ShieldAlert className="w-4 h-4" />} accent="#dc2626" color="#dc2626" />
        </div>

        {/* Filters */}
        <div className="gito-card p-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="w-4 h-4 text-th-muted flex-shrink-0" />
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as any)} className={input.select} style={{ width: 'auto' }}>
              <option value="all">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="MAJOR">Major</option>
              <option value="MINOR">Minor</option>
              <option value="WARNING">Warning</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className={input.select} style={{ width: 'auto' }}>
              <option value="all">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="CLEARED">Cleared</option>
            </select>
            <input
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              placeholder="Filter by alarm type…"
              className={`${input.base} flex-1 min-w-[200px]`}
            />
            {!loading && (
              <span className="text-xs text-th-muted ml-auto">
                <span className="font-semibold text-th-primary">{alarms.length}</span> / <span className="font-semibold text-th-primary">{meta?.total || 0}</span> alarms
              </span>
            )}
          </div>
        </div>

        {/* Main content: list + detail */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="lg:col-span-1 gito-card overflow-hidden">
            <div className="border-b border-th-default px-5 py-3.5 bg-panel">
              <h3 className="text-xs font-bold text-th-secondary uppercase tracking-widest">Alarms</h3>
            </div>
            <div className="max-h-[calc(100vh-500px)] overflow-y-auto">
              {loading ? (
                <div className="p-12 text-center">
                  <div className="inline-block animate-spin mb-4">
                    <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
                  </div>
                  <p className="text-th-secondary">Loading alarms...</p>
                </div>
              ) : error ? (
                <div className="p-8 text-center">
                  <AlertOctagon className="w-12 h-12 text-red-600 mx-auto mb-4" />
                  <p className="text-red-600 font-medium">{error}</p>
                </div>
              ) : alarms.length === 0 ? (
                <div className="p-12 text-center">
                  <CheckCircle2 className="w-12 h-12 text-th-muted mx-auto mb-4" />
                  <p className="text-th-secondary">No alarms found</p>
                  <p className="text-th-secondary text-sm mt-2">Try adjusting your filters</p>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--color-border-subtle)]">
                  {alarms.map(a => (
                    <li key={a.id}>
                      <button
                        onClick={() => setSelectedAlarmId(a.id)}
                        className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors ${
                          selectedAlarmId === a.id
                            ? 'bg-primary-600/10 border-l-4 border-primary-600'
                            : 'hover:bg-panel border-l-4 border-transparent'
                        }`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <AlarmSeverityBadge severity={a.severity} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-th-primary truncate">{a.alarm_type}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Clock className="w-3 h-3 text-th-secondary" />
                            <p className="text-xs text-th-secondary">{new Date(a.fired_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}</p>
                          </div>
                          <p className="text-xs text-th-primary mt-2 line-clamp-2">{a.message || '—'}</p>
                        </div>
                        <div className="ml-auto flex-shrink-0"><AlarmStatusBadge status={a.status} /></div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            
            {/* Pagination */}
            {meta && meta.total > meta.per_page && (
              <div className="border-t border-th-default px-5 py-3 bg-page flex items-center justify-between">
                <button 
                  disabled={page<=1} 
                  onClick={() => setPage(p => Math.max(1, p-1))} 
                  className="px-4 py-2 border border-[var(--color-input-border)] rounded-lg bg-surface hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <span className="text-sm text-th-secondary font-medium">Page {page}</span>
                <button 
                  disabled={(page*meta.per_page)>=meta.total} 
                  onClick={() => setPage(p => p+1)} 
                  className="px-4 py-2 border border-[var(--color-input-border)] rounded-lg bg-surface hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="lg:col-span-2 gito-card p-8">
            {!selectedAlarm ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Bell className="w-14 h-14 text-th-muted mb-4 opacity-40" />
                <p className="text-th-secondary text-base font-semibold">Select an alarm to view details</p>
                <p className="text-th-muted text-sm mt-1">Choose an alarm from the list</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between pb-6 border-b border-th-default">
                  <div className="flex items-start gap-4">
                    <AlarmSeverityBadge severity={selectedAlarm.severity} />
                    <div>
                      <h2 className="text-2xl font-bold text-th-primary">{selectedAlarm.alarm_type}</h2>
                      <p className="text-sm text-th-secondary mt-1">Alarm ID: {selectedAlarm.id.substring(0, 16)}...</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <AlarmStatusBadge status={selectedAlarm.status} />
                  </div>
                </div>

                {/* Action Buttons */}
                {(selectedAlarm.status !== 'CLEARED') && (
                  <div className="flex gap-3">
                    {selectedAlarm.status === 'ACTIVE' && (
                      <button onClick={() => acknowledge(selectedAlarm.id)} className={`${btn.secondary} flex items-center gap-2`}>
                        <Clock className="w-4 h-4" />
                        Acknowledge
                      </button>
                    )}
                    <button onClick={() => clear(selectedAlarm.id)} className={`${btn.primary} flex items-center gap-2`}>
                      <Check className="w-4 h-4" />
                      Clear Alarm
                    </button>
                  </div>
                )}

                {/* Message */}
                <div className="bg-page rounded-lg p-5 border border-th-default">
                  <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide mb-2">Message</p>
                  <p className="text-sm text-th-primary whitespace-pre-wrap leading-relaxed">{selectedAlarm.message || 'No message provided'}</p>
                </div>

                {/* Timing Information */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-surface border border-th-default rounded-lg p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-th-secondary" />
                      <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide">Fired At</p>
                    </div>
                    <p className="text-sm font-medium text-th-primary">{new Date(selectedAlarm.fired_at).toLocaleString()}</p>
                  </div>
                  
                  {selectedAlarm.acknowledged_at && (
                    <div className="bg-surface border border-th-default rounded-lg p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="w-4 h-4 text-th-secondary" />
                        <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide">Acknowledged At</p>
                      </div>
                      <p className="text-sm font-medium text-th-primary">{new Date(selectedAlarm.acknowledged_at).toLocaleString()}</p>
                    </div>
                  )}

                  {selectedAlarm.cleared_at && (
                    <div className="bg-surface border border-th-default rounded-lg p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-4 h-4 text-th-secondary" />
                        <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide">Cleared At</p>
                      </div>
                      <p className="text-sm font-medium text-th-primary">{new Date(selectedAlarm.cleared_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {/* Additional Details */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide mb-2">Source</p>
                    <p className="text-sm text-th-primary font-medium">{selectedAlarm.source || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide mb-2">Device ID</p>
                    <p className="text-sm text-th-primary font-mono">{selectedAlarm.device_id.substring(0, 16)}...</p>
                  </div>
                  {selectedAlarm.metric_name && (
                    <>
                      <div>
                        <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide mb-2">Metric</p>
                        <p className="text-sm text-th-primary font-medium">{selectedAlarm.metric_name}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-th-secondary uppercase tracking-wide mb-2">Metric Value</p>
                        <p className="text-sm text-th-primary font-medium">{selectedAlarm.metric_value != null ? selectedAlarm.metric_value : '—'}</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Audit Trail */}
                <div className="border-t border-th-default pt-6">
                  <h3 className="text-sm font-semibold text-th-primary mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Audit Trail
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-th-muted mt-1.5 opacity-50"></div>
                      <div>
                        <p className="text-th-primary font-medium">Alarm created</p>
                        <p className="text-th-secondary text-xs">{new Date(selectedAlarm.fired_at).toLocaleString()}</p>
                      </div>
                    </div>
                    {selectedAlarm.acknowledged_at && (
                      <div className="flex items-start gap-3 text-sm">
                        <div className="w-2 h-2 rounded-full bg-yellow-500 mt-1.5"></div>
                        <div>
                          <p className="text-th-primary font-medium">Acknowledged</p>
                          <p className="text-th-secondary text-xs">{new Date(selectedAlarm.acknowledged_at).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                    {selectedAlarm.cleared_at && (
                      <div className="flex items-start gap-3 text-sm">
                        <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5"></div>
                        <div>
                          <p className="text-th-primary font-medium">Cleared</p>
                          <p className="text-th-secondary text-xs">{new Date(selectedAlarm.cleared_at).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
    </PageShell>
  );
}
