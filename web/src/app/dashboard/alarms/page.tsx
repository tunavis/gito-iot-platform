'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { useRouter } from 'next/navigation';

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
        const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id as string;

        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('per_page', '50');
        if (severityFilter !== 'all') params.set('severity', severityFilter);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (typeFilter.trim()) params.set('alarm_type', typeFilter.trim());

        const res = await fetch(`/api/v1/tenants/${tenant}/alarms?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || 'Failed to load alarms');
        setAlarms(json.data || []);
        setMeta(json.meta || null);
        if (!selectedAlarmId && json.data?.length) setSelectedAlarmId(json.data[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load alarms');
      } finally { setLoading(false); }
    };
    load();
  }, [router, page, severityFilter, statusFilter, typeFilter]);

  const selectedAlarm = useMemo(() => alarms.find(a => a.id === selectedAlarmId) || null, [alarms, selectedAlarmId]);

  const acknowledge = async (alarmId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id as string;
    const res = await fetch(`/api/v1/tenants/${tenant}/alarms/${alarmId}/acknowledge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (res.ok) {
      setAlarms(prev => prev.map(a => a.id === alarmId ? json.data : a));
    }
  };

  const clear = async (alarmId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id as string;
    const res = await fetch(`/api/v1/tenants/${tenant}/alarms/${alarmId}/clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (res.ok) {
      setAlarms(prev => prev.map(a => a.id === alarmId ? json.data : a));
    }
  };

  const severityColor = (s: AlarmSeverity) => {
    switch (s) {
      case 'CRITICAL': return 'bg-red-100 text-red-700 border-red-200';
      case 'MAJOR': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'MINOR': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'WARNING': return 'bg-blue-100 text-blue-700 border-blue-200';
    }
  };

  const statusBadge = (st: AlarmStatus) => {
    switch (st) {
      case 'ACTIVE': return <span className="px-2 py-0.5 text-xs rounded bg-red-50 text-red-700 border border-red-200">Active</span>;
      case 'ACKNOWLEDGED': return <span className="px-2 py-0.5 text-xs rounded bg-yellow-50 text-yellow-700 border border-yellow-200">Acknowledged</span>;
      case 'CLEARED': return <span className="px-2 py-0.5 text-xs rounded bg-green-50 text-green-700 border border-green-200">Cleared</span>;
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Alarms</h1>
            <p className="text-gray-600">Monitor and manage alarms across your devices</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-center">
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as any)} className="px-3 py-2 border border-gray-300 rounded bg-white">
              <option value="all">All severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="MAJOR">Major</option>
              <option value="MINOR">Minor</option>
              <option value="WARNING">Warning</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 border border-gray-300 rounded bg-white">
              <option value="all">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="CLEARED">Cleared</option>
            </select>
            <input value={typeFilter} onChange={e => setTypeFilter(e.target.value)} placeholder="Alarm type" className="px-3 py-2 border border-gray-300 rounded flex-1 min-w-[200px]" />
          </div>
        </div>

        {/* Main content: list + detail */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* List */}
          <div className="lg:col-span-1 bg-white border border-gray-200 rounded overflow-hidden">
            <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">Alarms list</span>
              {meta && (
                <span className="text-xs text-gray-500">{meta.total} total</span>
              )}
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <div className="p-6 text-center text-gray-600">Loading...</div>
              ) : error ? (
                <div className="p-6 text-center text-red-600">{error}</div>
              ) : alarms.length === 0 ? (
                <div className="p-6 text-center text-gray-600">No alarms found</div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {alarms.map(a => (
                    <li key={a.id}>
                      <button onClick={() => setSelectedAlarmId(a.id)} className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 ${selectedAlarmId === a.id ? 'bg-blue-50' : ''}`}>
                        <div className={`px-2 py-0.5 text-xs rounded border ${severityColor(a.severity)}`}>{a.severity}</div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{a.alarm_type}</p>
                          <p className="text-xs text-gray-600">{new Date(a.fired_at).toLocaleString()}</p>
                          <p className="text-xs text-gray-700 mt-1 line-clamp-2">{a.message || '—'}</p>
                        </div>
                        <div className="ml-auto">{statusBadge(a.status)}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* Pagination */}
            {meta && meta.total > meta.per_page && (
              <div className="border-t border-gray-200 px-4 py-2 flex items-center justify-between text-sm">
                <button disabled={page<=1} onClick={() => setPage(p => Math.max(1, p-1))} className="px-3 py-1 border border-gray-300 rounded bg-white disabled:opacity-50">Prev</button>
                <span className="text-gray-600">Page {page}</span>
                <button disabled={(page*meta.per_page)>=meta.total} onClick={() => setPage(p => p+1)} className="px-3 py-1 border border-gray-300 rounded bg-white disabled:opacity-50">Next</button>
              </div>
            )}
          </div>

          {/* Detail */}
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded p-6">
            {!selectedAlarm ? (
              <div className="text-gray-600">Select an alarm to view details</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`px-2 py-0.5 text-xs rounded border ${severityColor(selectedAlarm.severity)}`}>{selectedAlarm.severity}</div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedAlarm.alarm_type}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(selectedAlarm.status)}
                    {selectedAlarm.status === 'ACTIVE' && (
                      <button onClick={() => acknowledge(selectedAlarm.id)} className="px-3 py-1.5 text-sm rounded border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100">Acknowledge</button>
                    )}
                    {selectedAlarm.status !== 'CLEARED' && (
                      <button onClick={() => clear(selectedAlarm.id)} className="px-3 py-1.5 text-sm rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100">Clear</button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600">Status</p>
                    <p className="text-sm text-gray-900">{selectedAlarm.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Fired at</p>
                    <p className="text-sm text-gray-900">{new Date(selectedAlarm.fired_at).toLocaleString()}</p>
                  </div>
                  {selectedAlarm.acknowledged_at && (
                    <div>
                      <p className="text-xs text-gray-600">Acknowledged at</p>
                      <p className="text-sm text-gray-900">{new Date(selectedAlarm.acknowledged_at).toLocaleString()}</p>
                    </div>
                  )}
                  {selectedAlarm.cleared_at && (
                    <div>
                      <p className="text-xs text-gray-600">Cleared at</p>
                      <p className="text-sm text-gray-900">{new Date(selectedAlarm.cleared_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <p className="text-xs text-gray-600 mb-1">Message</p>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{selectedAlarm.message || '—'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600">Source</p>
                    <p className="text-sm text-gray-900">{selectedAlarm.source || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Metric</p>
                    <p className="text-sm text-gray-900">{selectedAlarm.metric_name || '—'} {selectedAlarm.metric_value != null ? `(${selectedAlarm.metric_value})` : ''}</p>
                  </div>
                </div>

                {/* Audit logs placeholder */}
                <div className="border-t border-gray-200 pt-4">
                  <p className="text-sm font-semibold text-gray-900 mb-2">Audit logs</p>
                  <div className="text-xs text-gray-600">Alarm created {new Date(selectedAlarm.fired_at).toLocaleString()}</div>
                  {selectedAlarm.acknowledged_at && (
                    <div className="text-xs text-gray-600">Acknowledged {new Date(selectedAlarm.acknowledged_at).toLocaleString()}</div>
                  )}
                  {selectedAlarm.cleared_at && (
                    <div className="text-xs text-gray-600">Cleared {new Date(selectedAlarm.cleared_at).toLocaleString()}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
