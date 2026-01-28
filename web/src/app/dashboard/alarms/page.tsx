'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
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

  const severityColor = (s: AlarmSeverity) => {
    switch (s) {
      case 'CRITICAL': return 'bg-red-100 text-red-700 border-red-300';
      case 'MAJOR': return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'MINOR': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'WARNING': return 'bg-blue-100 text-blue-700 border-blue-300';
    }
  };

  const statusBadge = (st: AlarmStatus) => {
    switch (st) {
      case 'ACTIVE': 
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-red-50 text-red-700 border border-red-200">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            Active
          </span>
        );
      case 'ACKNOWLEDGED': 
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
            <Clock className="w-3 h-3" />
            Acknowledged
          </span>
        );
      case 'CLEARED': 
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-green-50 text-green-700 border border-green-200">
            <CheckCircle2 className="w-3 h-3" />
            Cleared
          </span>
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Bell className="w-8 h-8 text-gray-900" />
                <h1 className="text-3xl font-bold text-gray-900">Alarm Management</h1>
              </div>
              <p className="text-gray-600">Monitor and manage alarms across your devices</p>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mt-6">
            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Total Alarms</p>
                  <p className="text-3xl font-bold text-slate-900">{meta?.total || 0}</p>
                </div>
                <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Bell className="w-6 h-6 text-slate-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-red-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Active</p>
                  <p className="text-3xl font-bold text-red-600">{stats.active}</p>
                </div>
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <AlertOctagon className="w-6 h-6 text-red-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-yellow-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Acknowledged</p>
                  <p className="text-3xl font-bold text-yellow-600">{stats.acknowledged}</p>
                </div>
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Cleared</p>
                  <p className="text-3xl font-bold text-green-600">{stats.cleared}</p>
                </div>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-red-300 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Critical</p>
                  <p className="text-3xl font-bold text-red-700">{stats.critical}</p>
                </div>
                <div className="w-12 h-12 bg-red-200 rounded-lg flex items-center justify-center">
                  <ShieldAlert className="w-6 h-6 text-red-700" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h3 className="text-sm font-semibold text-gray-900">Filter Alarms</h3>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <select 
              value={severityFilter} 
              onChange={e => setSeverityFilter(e.target.value as any)} 
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="MAJOR">Major</option>
              <option value="MINOR">Minor</option>
              <option value="WARNING">Warning</option>
            </select>
            <select 
              value={statusFilter} 
              onChange={e => setStatusFilter(e.target.value as any)} 
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="CLEARED">Cleared</option>
            </select>
            <input 
              value={typeFilter} 
              onChange={e => setTypeFilter(e.target.value)} 
              placeholder="Filter by alarm type..." 
              className="px-4 py-2.5 border border-gray-300 rounded-lg flex-1 min-w-[250px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" 
            />
          </div>

          {/* Alarm Count */}
          {!loading && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                Showing <span className="font-semibold text-gray-900">{alarms.length}</span> of{' '}
                <span className="font-semibold text-gray-900">{meta?.total || 0}</span> alarms
              </p>
            </div>
          )}
        </div>

        {/* Main content: list + detail */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="lg:col-span-1 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4 bg-slate-50">
              <h3 className="text-sm font-semibold text-gray-900">Alarms List</h3>
            </div>
            <div className="max-h-[calc(100vh-500px)] overflow-y-auto">
              {loading ? (
                <div className="p-12 text-center">
                  <div className="inline-block animate-spin mb-4">
                    <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
                  </div>
                  <p className="text-gray-600">Loading alarms...</p>
                </div>
              ) : error ? (
                <div className="p-8 text-center">
                  <AlertOctagon className="w-12 h-12 text-red-600 mx-auto mb-4" />
                  <p className="text-red-600 font-medium">{error}</p>
                </div>
              ) : alarms.length === 0 ? (
                <div className="p-12 text-center">
                  <CheckCircle2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No alarms found</p>
                  <p className="text-gray-500 text-sm mt-2">Try adjusting your filters</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {alarms.map(a => (
                    <li key={a.id}>
                      <button 
                        onClick={() => setSelectedAlarmId(a.id)} 
                        className={`w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-gray-50 transition-colors ${
                          selectedAlarmId === a.id ? 'bg-blue-50 border-l-4 border-primary-600' : ''
                        }`}
                      >
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border ${severityColor(a.severity)} flex-shrink-0`}>
                          {getSeverityIcon(a.severity)}
                          {a.severity}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{a.alarm_type}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Clock className="w-3 h-3 text-gray-500" />
                            <p className="text-xs text-gray-600">{new Date(a.fired_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}</p>
                          </div>
                          <p className="text-xs text-gray-700 mt-2 line-clamp-2">{a.message || '—'}</p>
                        </div>
                        <div className="ml-auto flex-shrink-0">{statusBadge(a.status)}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            
            {/* Pagination */}
            {meta && meta.total > meta.per_page && (
              <div className="border-t border-gray-200 px-5 py-3 bg-slate-50 flex items-center justify-between">
                <button 
                  disabled={page<=1} 
                  onClick={() => setPage(p => Math.max(1, p-1))} 
                  className="px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <span className="text-sm text-gray-600 font-medium">Page {page}</span>
                <button 
                  disabled={(page*meta.per_page)>=meta.total} 
                  onClick={() => setPage(p => p+1)} 
                  className="px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
            {!selectedAlarm ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Bell className="w-16 h-16 text-gray-300 mb-4" />
                <p className="text-gray-600 text-lg font-medium">Select an alarm to view details</p>
                <p className="text-gray-500 text-sm mt-2">Choose an alarm from the list to see its full information</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between pb-6 border-b border-gray-200">
                  <div className="flex items-start gap-4">
                    <div className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border ${severityColor(selectedAlarm.severity)}`}>
                      {getSeverityIcon(selectedAlarm.severity)}
                      {selectedAlarm.severity}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">{selectedAlarm.alarm_type}</h2>
                      <p className="text-sm text-gray-600 mt-1">Alarm ID: {selectedAlarm.id.substring(0, 16)}...</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {statusBadge(selectedAlarm.status)}
                  </div>
                </div>

                {/* Action Buttons */}
                {(selectedAlarm.status !== 'CLEARED') && (
                  <div className="flex gap-3">
                    {selectedAlarm.status === 'ACTIVE' && (
                      <button 
                        onClick={() => acknowledge(selectedAlarm.id)} 
                        className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition-colors flex items-center gap-2"
                      >
                        <Clock className="w-4 h-4" />
                        Acknowledge
                      </button>
                    )}
                    <button 
                      onClick={() => clear(selectedAlarm.id)} 
                      className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 transition-colors flex items-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      Clear Alarm
                    </button>
                  </div>
                )}

                {/* Message */}
                <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Message</p>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">{selectedAlarm.message || 'No message provided'}</p>
                </div>

                {/* Timing Information */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-gray-600" />
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Fired At</p>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{new Date(selectedAlarm.fired_at).toLocaleString()}</p>
                  </div>
                  
                  {selectedAlarm.acknowledged_at && (
                    <div className="bg-white border border-gray-200 rounded-lg p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="w-4 h-4 text-gray-600" />
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Acknowledged At</p>
                      </div>
                      <p className="text-sm font-medium text-gray-900">{new Date(selectedAlarm.acknowledged_at).toLocaleString()}</p>
                    </div>
                  )}

                  {selectedAlarm.cleared_at && (
                    <div className="bg-white border border-gray-200 rounded-lg p-5">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-4 h-4 text-gray-600" />
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Cleared At</p>
                      </div>
                      <p className="text-sm font-medium text-gray-900">{new Date(selectedAlarm.cleared_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {/* Additional Details */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Source</p>
                    <p className="text-sm text-gray-900 font-medium">{selectedAlarm.source || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Device ID</p>
                    <p className="text-sm text-gray-900 font-mono">{selectedAlarm.device_id.substring(0, 16)}...</p>
                  </div>
                  {selectedAlarm.metric_name && (
                    <>
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Metric</p>
                        <p className="text-sm text-gray-900 font-medium">{selectedAlarm.metric_name}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Metric Value</p>
                        <p className="text-sm text-gray-900 font-medium">{selectedAlarm.metric_value != null ? selectedAlarm.metric_value : '—'}</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Audit Trail */}
                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Audit Trail
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-gray-400 mt-1.5"></div>
                      <div>
                        <p className="text-gray-900 font-medium">Alarm created</p>
                        <p className="text-gray-600 text-xs">{new Date(selectedAlarm.fired_at).toLocaleString()}</p>
                      </div>
                    </div>
                    {selectedAlarm.acknowledged_at && (
                      <div className="flex items-start gap-3 text-sm">
                        <div className="w-2 h-2 rounded-full bg-yellow-500 mt-1.5"></div>
                        <div>
                          <p className="text-gray-900 font-medium">Acknowledged</p>
                          <p className="text-gray-600 text-xs">{new Date(selectedAlarm.acknowledged_at).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                    {selectedAlarm.cleared_at && (
                      <div className="flex items-start gap-3 text-sm">
                        <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5"></div>
                        <div>
                          <p className="text-gray-900 font-medium">Cleared</p>
                          <p className="text-gray-600 text-xs">{new Date(selectedAlarm.cleared_at).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
