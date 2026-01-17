'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TelemetryChart from '@/components/TelemetryChart';

interface Device {
  id: string;
  name: string;
  device_type: string;
  status: 'online' | 'offline' | 'idle';
  last_seen: string | null;
  battery_level: number | null;
}

export default function DeviceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deviceId = params?.id as string;
  const [device, setDevice] = useState<Device | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [telemetryData, setTelemetryData] = useState<{temp: any[], humidity: any[], battery: any[]}>({temp: [], humidity: [], battery: []});

  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return router.push('/auth/login');
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
      
      const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setDevice((await res.json()).data);
      
      // Fetch device telemetry
      const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const telRes = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}/telemetry?start_time=${startTime}&aggregation=avg&per_page=24`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (telRes.ok) {
        const telData = (await telRes.json()).data || [];
        setTelemetryData({
          temp: telData.map((d: any) => ({time: new Date(d.time_bucket).getHours() + 'h', value: d.temperature || 0})),
          humidity: telData.map((d: any) => ({time: new Date(d.time_bucket).getHours() + 'h', value: d.humidity || 0})),
          battery: telData.map((d: any) => ({time: new Date(d.time_bucket).getHours() + 'h', value: d.battery || 0}))
        });
      }
      
      setLoading(false);
    };
    if (deviceId) load();
  }, [deviceId, router]);

  // WebSocket for real-time updates
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token || !deviceId) return;

    const ws = new WebSocket(`ws://localhost:8000/api/v1/ws/devices/${deviceId}?token=${token}`);
    
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'telemetry' && data.data) {
          setDevice(prev => prev ? {...prev, last_seen: new Date().toISOString(), battery_level: data.data.battery || prev.battery_level} : null);
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };

    return () => ws.close();
  }, [deviceId]);

  if (loading) return <div className="flex min-h-screen bg-gray-50"><Sidebar /><main className="flex-1 ml-64 p-8 flex items-center justify-center"><div className="text-center"><div className="inline-block animate-spin mb-4"><div className="w-12 h-12 border-4 border-gray-300 border-t-gray-700 rounded-full"></div></div><p className="text-gray-600 font-medium">Loading device...</p></div></main></div>;
  if (!device) return <div className="flex min-h-screen bg-gray-50"><Sidebar /><main className="flex-1 ml-64 p-8"><div className="bg-red-50 border border-red-200 rounded p-8 text-center"><p className="text-red-600 mb-4">Device not found</p><button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">Back to Dashboard</button></div></main></div>;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <button onClick={() => router.push('/dashboard/devices')} className="text-gray-600 hover:text-gray-900 font-medium mb-4 transition-colors">← Back to Devices</button>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{device.name}</h1>
            <p className="text-gray-600 mt-1">{device.device_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
          </div>
          <div className="flex items-center gap-3">
            {wsConnected && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                <span className="text-sm font-medium text-green-700">Live</span>
              </div>
            )}
            <div className={`px-4 py-2 rounded border ${device.status === 'online' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}`}>
              <span className="font-semibold capitalize">{device.status}</span>
            </div>
          </div>
        </div>
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {['overview', 'telemetry', 'alerts', 'settings'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2 px-1 border-b-2 capitalize font-medium transition-colors ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{tab}</button>
            ))}
          </nav>
        </div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-4 gap-6">
              <div className="bg-white rounded p-4 border border-green-200 shadow-sm">
                <p className="text-green-700 text-sm font-medium">Battery</p>
                <p className="text-3xl font-bold mt-2 text-green-900">{device.battery_level !== null && device.battery_level !== undefined ? `${Math.round(device.battery_level)}%` : 'N/A'}</p>
              </div>
              <div className="bg-white rounded p-4 border border-blue-200 shadow-sm">
                <p className="text-blue-700 text-sm font-medium">Last Seen</p>
                <p className="text-sm font-semibold mt-2 text-blue-900">{device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}</p>
              </div>
              <div className="bg-white rounded p-4 border border-purple-200 shadow-sm">
                <p className="text-purple-700 text-sm font-medium">Signal Strength</p>
                <p className="text-2xl font-bold mt-2 text-purple-900">{device.signal_strength ? `${device.signal_strength} dBm` : 'N/A'}</p>
              </div>
              <div className={`bg-white rounded p-4 border shadow-sm ${device.status === 'online' ? 'border-green-200' : 'border-red-200'}`}>
                <p className={`text-sm font-medium ${device.status === 'online' ? 'text-green-700' : 'text-red-700'}`}>Status</p>
                <p className={`text-xl font-bold mt-2 capitalize ${device.status === 'online' ? 'text-green-900' : 'text-red-900'}`}>{device.status}</p>
              </div>
            </div>
            
            <div className="bg-white rounded p-6 border border-gray-200 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Device Information</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Device ID</p>
                  <p className="font-mono text-sm text-slate-900 bg-slate-50 px-3 py-2 rounded border border-slate-200">{deviceId}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Device Type</p>
                  <p className="text-sm text-slate-900 bg-slate-50 px-3 py-2 rounded border border-slate-200">{device.device_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                </div>
                {device.dev_eui && (
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Device EUI</p>
                    <p className="font-mono text-sm text-slate-900 bg-slate-50 px-3 py-2 rounded border border-slate-200">{device.dev_eui}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-slate-600 mb-1">Created</p>
                  <p className="text-sm text-slate-900 bg-slate-50 px-3 py-2 rounded border border-slate-200">{new Date(device.created_at).toLocaleDateString()}</p>
                </div>
                {device.ttn_app_id && (
                  <div>
                    <p className="text-sm text-slate-600 mb-1">TTN App ID</p>
                    <p className="font-mono text-sm text-slate-900 bg-slate-50 px-3 py-2 rounded border border-slate-200">{device.ttn_app_id}</p>
                  </div>
                )}
                {device.device_profile_id && (
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Device Profile</p>
                    <p className="font-mono text-sm text-slate-900 bg-slate-50 px-3 py-2 rounded border border-slate-200">{device.device_profile_id}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'telemetry' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TelemetryChart title="Temperature (Last 24h)" data={telemetryData.temp} color="#ef4444" unit="°C" type="area" />
            <TelemetryChart title="Humidity (Last 24h)" data={telemetryData.humidity} color="#3b82f6" unit="%" type="line" />
            <TelemetryChart title="Battery Level (Last 24h)" data={telemetryData.battery} color="#10b981" unit="%" type="line" />
          </div>
        )}
        {activeTab === 'alerts' && (
          <DeviceAlarms deviceId={deviceId as string} />
        )}
        {activeTab === 'settings' && <div className="bg-white rounded border border-gray-200 p-8 text-center shadow-sm"><p className="text-gray-600">Device settings coming soon...</p></div>}
      </main>
    </div>
  );
}

function DeviceAlarms({ deviceId }: { deviceId: string }) {
  type AlarmSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING';
  type AlarmStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED';
  interface Alarm {
    id: string;
    tenant_id: string;
    device_id: string;
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

  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<AlarmSeverity | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AlarmStatus | 'all'>('all');

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id as string;
        const params = new URLSearchParams();
        params.set('page', '1');
        params.set('per_page', '50');
        params.set('device_id', deviceId);
        if (severityFilter !== 'all') params.set('severity', severityFilter);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        const res = await fetch(`/api/v1/tenants/${tenant}/alarms?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }});
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || 'Failed to load alarms');
        setAlarms(json.data || []);
        if (!selectedId && json.data?.length) setSelectedId(json.data[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load alarms');
      } finally { setLoading(false); }
    };
    load();
  }, [deviceId, severityFilter, statusFilter]);

  const acknowledge = async (alarmId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id as string;
    const res = await fetch(`/api/v1/tenants/${tenant}/alarms/${alarmId}/acknowledge`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (res.ok) setAlarms(prev => prev.map(a => a.id === alarmId ? json.data : a));
  };

  const clear = async (alarmId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id as string;
    const res = await fetch(`/api/v1/tenants/${tenant}/alarms/${alarmId}/clear`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (res.ok) setAlarms(prev => prev.map(a => a.id === alarmId ? json.data : a));
  };

  const severityChip = (s: AlarmSeverity) => {
    const base = 'px-2 py-0.5 text-xs rounded border ';
    switch (s) {
      case 'CRITICAL': return base + 'bg-red-100 text-red-700 border-red-200';
      case 'MAJOR': return base + 'bg-orange-100 text-orange-700 border-orange-200';
      case 'MINOR': return base + 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'WARNING': return base + 'bg-blue-100 text-blue-700 border-blue-200';
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Filters */}
      <div className="lg:col-span-3 bg-white border border-gray-200 rounded p-4">
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
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">Device alarms</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-gray-600">Loading...</div>
          ) : error ? (
            <div className="p-6 text-center text-red-600">{error}</div>
          ) : alarms.length === 0 ? (
            <div className="p-6 text-center text-gray-600">No alarms for this device</div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {alarms.map(a => (
                <li key={a.id}>
                  <button onClick={() => setSelectedId(a.id)} className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 ${selectedId === a.id ? 'bg-blue-50' : ''}`}>
                    <div className={severityChip(a.severity)}>{a.severity}</div>
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
      </div>

      {/* Detail */}
      <div className="lg:col-span-2 bg-white border border-gray-200 rounded p-6">
        {!selectedId ? (
          <div className="text-gray-600">Select an alarm to view details</div>
        ) : (
          (() => {
            const a = alarms.find(x => x.id === selectedId)!;
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={severityChip(a.severity)}>{a.severity}</div>
                    <h3 className="text-lg font-semibold text-gray-900">{a.alarm_type}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(a.status)}
                    {a.status === 'ACTIVE' && (
                      <button onClick={() => acknowledge(a.id)} className="px-3 py-1.5 text-sm rounded border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100">Acknowledge</button>
                    )}
                    {a.status !== 'CLEARED' && (
                      <button onClick={() => clear(a.id)} className="px-3 py-1.5 text-sm rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100">Clear</button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600">Status</p>
                    <p className="text-sm text-gray-900">{a.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Fired at</p>
                    <p className="text-sm text-gray-900">{new Date(a.fired_at).toLocaleString()}</p>
                  </div>
                  {a.acknowledged_at && (
                    <div>
                      <p className="text-xs text-gray-600">Acknowledged at</p>
                      <p className="text-sm text-gray-900">{new Date(a.acknowledged_at).toLocaleString()}</p>
                    </div>
                  )}
                  {a.cleared_at && (
                    <div>
                      <p className="text-xs text-gray-600">Cleared at</p>
                      <p className="text-sm text-gray-900">{new Date(a.cleared_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <p className="text-xs text-gray-600 mb-1">Message</p>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{a.message || '—'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600">Source</p>
                    <p className="text-sm text-gray-900">{a.source || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600">Metric</p>
                    <p className="text-sm text-gray-900">{a.metric_name || '—'} {a.metric_value != null ? `(${a.metric_value})` : ''}</p>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <p className="text-sm font-semibold text-gray-900 mb-2">Audit logs</p>
                  <div className="text-xs text-gray-600">Alarm created {new Date(a.fired_at).toLocaleString()}</div>
                  {a.acknowledged_at && (
                    <div className="text-xs text-gray-600">Acknowledged {new Date(a.acknowledged_at).toLocaleString()}</div>
                  )}
                  {a.cleared_at && (
                    <div className="text-xs text-gray-600">Cleared {new Date(a.cleared_at).toLocaleString()}</div>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}