'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import {
  Activity,
  Battery,
  Signal,
  Clock,
  MapPin,
  TrendingUp,
  TrendingDown,
  Wifi,
  WifiOff,
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings,
  Edit2,
  Trash2,
  Bell,
  BarChart3,
  Calendar
} from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Device {
  id: string;
  name: string;
  device_type: string;
  status: 'online' | 'offline' | 'idle';
  last_seen: string | null;
  battery_level: number | null;
  signal_strength: number | null;
  dev_eui: string | null;
  created_at: string;
  location?: { latitude: number; longitude: number } | null;
  firmware_version?: string | null;
  hardware_version?: string | null;
}

interface TelemetryPoint {
  timestamp: string;
  temperature?: number | null;
  humidity?: number | null;
  battery?: number | null;
  rssi?: number | null;
  pressure?: number | null;
  payload?: Record<string, any> | null;
}

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';

export default function DeviceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deviceId = params?.id as string;

  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [telemetryData, setTelemetryData] = useState<TelemetryPoint[]>([]);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [alarms, setAlarms] = useState<any[]>([]);

  // Calculate time range
  const getTimeRangeHours = (range: TimeRange): number => {
    const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 };
    return map[range];
  };

  // Load device and initial data
  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return router.push('/auth/login');
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

      try {
        // Load device details
        const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          setDevice((await res.json()).data);
        }

        // Load recent alarms
        const alarmsRes = await fetch(`/api/v1/tenants/${tenant}/alarms?device_id=${deviceId}&page=1&per_page=5&status=ACTIVE`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (alarmsRes.ok) {
          const json = await alarmsRes.json();
          setAlarms(json.data || []);
        }
      } catch (err) {
        console.error('Failed to load device:', err);
      } finally {
        setLoading(false);
      }
    };

    if (deviceId) load();
  }, [deviceId, router]);

  // Load telemetry when time range changes
  useEffect(() => {
    const loadTelemetry = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token || !device) return;
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

      setTelemetryLoading(true);
      try {
        const hours = getTimeRangeHours(timeRange);
        const startTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        const res = await fetch(
          `/api/v1/tenants/${tenant}/devices/${deviceId}/telemetry?start_time=${startTime}&per_page=100`,
          { headers: { Authorization: `Bearer ${token}` }}
        );

        if (res.ok) {
          const json = await res.json();
          setTelemetryData(json.data || []);
        }
      } catch (err) {
        console.error('Failed to load telemetry:', err);
      } finally {
        setTelemetryLoading(false);
      }
    };

    loadTelemetry();
  }, [deviceId, device, timeRange]);

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
          setDevice(prev => prev ? {
            ...prev,
            last_seen: new Date().toISOString(),
            battery_level: data.data.battery ?? prev.battery_level,
            signal_strength: data.data.rssi ?? prev.signal_strength
          } : null);

          // Add to telemetry data
          setTelemetryData(prev => [...prev, {
            timestamp: new Date().toISOString(),
            temperature: data.data.temperature,
            humidity: data.data.humidity,
            battery: data.data.battery,
            rssi: data.data.rssi,
            pressure: data.data.pressure
          }].slice(-100)); // Keep last 100 points
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };

    return () => ws.close();
  }, [deviceId]);

  // Calculate device health score
  const healthScore = useMemo(() => {
    if (!device) return 0;
    let score = 100;

    if (device.status === 'offline') score -= 50;
    else if (device.status === 'idle') score -= 20;

    if (device.battery_level !== null) {
      if (device.battery_level < 20) score -= 20;
      else if (device.battery_level < 50) score -= 10;
    }

    if (device.signal_strength !== null) {
      if (device.signal_strength < -100) score -= 15;
      else if (device.signal_strength < -80) score -= 5;
    }

    if (alarms.length > 0) score -= Math.min(alarms.length * 5, 20);

    return Math.max(0, score);
  }, [device, alarms]);

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  // Calculate trends
  const calculateTrend = (metric: 'temperature' | 'humidity' | 'battery' | 'rssi') => {
    if (telemetryData.length < 2) return null;
    const recentData = telemetryData.slice(-10).filter(d => d[metric] !== null && d[metric] !== undefined);
    if (recentData.length < 2) return null;

    const values = recentData.map(d => d[metric]!);
    const avg1 = values.slice(0, Math.floor(values.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(values.length / 2);
    const avg2 = values.slice(Math.floor(values.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(values.length / 2);

    const change = ((avg2 - avg1) / avg1) * 100;
    return { value: change, direction: change > 0 ? 'up' : 'down' };
  };

  const exportTelemetry = () => {
    if (telemetryData.length === 0) return;

    const csv = [
      ['Timestamp', 'Temperature (°C)', 'Humidity (%)', 'Battery (%)', 'RSSI (dBm)', 'Pressure (hPa)'].join(','),
      ...telemetryData.map(d => [
        d.timestamp,
        d.temperature ?? '',
        d.humidity ?? '',
        d.battery ?? '',
        d.rssi ?? '',
        d.pressure ?? ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${device?.name || deviceId}_telemetry_${timeRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 ml-64 p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin mb-4">
              <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
            </div>
            <p className="text-gray-600 font-medium">Loading device...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 ml-64 p-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
            <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <p className="text-red-900 font-semibold mb-2">Device not found</p>
            <p className="text-red-600 text-sm mb-4">The device you're looking for doesn't exist or you don't have access.</p>
            <button
              onClick={() => router.push('/dashboard/devices')}
              className="px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              Back to Devices
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/dashboard/devices')}
            className="text-gray-600 hover:text-gray-900 font-medium mb-4 transition-colors flex items-center gap-2"
          >
            ← Back to Devices
          </button>

          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-gray-900">{device.name}</h1>
                {wsConnected && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    <span className="text-sm font-medium text-green-700">Live</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span className="font-mono bg-gray-100 px-2 py-1 rounded">{deviceId}</span>
                <span>•</span>
                <span>{device.device_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                {device.location && (
                  <>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span>{device.location.latitude.toFixed(4)}, {device.location.longitude.toFixed(4)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border font-semibold ${
                device.status === 'online'
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : device.status === 'offline'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-200'
              }`}>
                {device.status === 'online' ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
                <span className="capitalize">{device.status}</span>
              </div>

              <div className={`px-4 py-2.5 rounded-lg border font-semibold ${getHealthColor(healthScore)}`}>
                Health: {healthScore}%
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {/* Battery */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <Battery className="w-5 h-5 text-green-600" />
                </div>
                <span className="text-sm font-medium text-gray-600">Battery Level</span>
              </div>
              {calculateTrend('battery') && (
                <div className={`flex items-center gap-1 text-xs font-medium ${
                  calculateTrend('battery')!.direction === 'up' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {calculateTrend('battery')!.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(calculateTrend('battery')!.value).toFixed(1)}%
                </div>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {device.battery_level !== null && device.battery_level !== undefined
                ? `${Math.round(device.battery_level)}%`
                : 'N/A'}
            </p>
            <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  device.battery_level && device.battery_level > 50
                    ? 'bg-green-500'
                    : device.battery_level && device.battery_level > 20
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${device.battery_level || 0}%` }}
              ></div>
            </div>
          </div>

          {/* Signal Strength */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Signal className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-gray-600">Signal Strength</span>
              </div>
              {calculateTrend('rssi') && (
                <div className={`flex items-center gap-1 text-xs font-medium ${
                  calculateTrend('rssi')!.direction === 'up' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {calculateTrend('rssi')!.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(calculateTrend('rssi')!.value).toFixed(1)}%
                </div>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {device.signal_strength ? `${device.signal_strength} dBm` : 'N/A'}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {device.signal_strength && device.signal_strength > -70 ? 'Excellent' :
               device.signal_strength && device.signal_strength > -85 ? 'Good' :
               device.signal_strength && device.signal_strength > -100 ? 'Fair' : 'Poor'}
            </p>
          </div>

          {/* Last Seen */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-purple-600" />
              </div>
              <span className="text-sm font-medium text-gray-600">Last Seen</span>
            </div>
            <p className="text-lg font-semibold text-gray-900">
              {device.last_seen
                ? new Date(device.last_seen).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Never'}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {device.last_seen
                ? `${Math.round((Date.now() - new Date(device.last_seen).getTime()) / 1000 / 60)} min ago`
                : 'Device has not reported'}
            </p>
          </div>

          {/* Active Alarms */}
          <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                alarms.length > 0 ? 'bg-red-100' : 'bg-green-100'
              }`}>
                {alarms.length > 0 ? (
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                )}
              </div>
              <span className="text-sm font-medium text-gray-600">Active Alarms</span>
            </div>
            <p className={`text-3xl font-bold ${alarms.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {alarms.length}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {alarms.length > 0 ? 'Requires attention' : 'All systems normal'}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {['overview', 'telemetry', 'alarms', 'settings'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 px-2 border-b-2 capitalize font-medium transition-colors ${
                  activeTab === tab
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Device Information */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Device Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Device ID</p>
                  <p className="font-mono text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">{deviceId}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Device Type</p>
                  <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                    {device.device_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Status</p>
                  <p className={`text-sm font-semibold px-3 py-2 rounded border capitalize ${
                    device.status === 'online'
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : device.status === 'offline'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                  }`}>
                    {device.status}
                  </p>
                </div>
                {device.dev_eui && (
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Device EUI</p>
                    <p className="font-mono text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">{device.dev_eui}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-600 mb-1">Created</p>
                  <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                    {new Date(device.created_at).toLocaleDateString()}
                  </p>
                </div>
                {device.firmware_version && (
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Firmware Version</p>
                    <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border border-gray-200">{device.firmware_version}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary-600" />
                Recent Activity
              </h3>
              <div className="space-y-3">
                {telemetryData.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <p className="font-medium">No telemetry data available</p>
                    <p className="text-sm mt-1">This device hasn't sent any data yet.</p>
                  </div>
                ) : (
                  telemetryData.slice(-5).reverse().map((point, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                          <Activity className="w-4 h-4 text-primary-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">Telemetry received</p>
                          <p className="text-xs text-gray-500">
                            {new Date(point.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {point.temperature && (
                          <p className="text-sm text-gray-600">Temp: {point.temperature.toFixed(1)}°C</p>
                        )}
                        {point.humidity && (
                          <p className="text-xs text-gray-500">Humidity: {point.humidity.toFixed(1)}%</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Telemetry Tab */}
        {activeTab === 'telemetry' && (
          <div className="space-y-6">
            {/* Time Range Selector */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-gray-400" />
                <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-1">
                  {(['1h', '6h', '24h', '7d', '30d'] as TimeRange[]).map(range => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
                        timeRange === range
                          ? 'bg-primary-600 text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTimeRange(timeRange)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                <button
                  onClick={exportTelemetry}
                  disabled={telemetryData.length === 0}
                  className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>
            </div>

            {telemetryLoading ? (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
                <div className="inline-block animate-spin mb-4">
                  <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
                </div>
                <p className="text-gray-600">Loading telemetry data...</p>
              </div>
            ) : telemetryData.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
                <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-900 font-semibold mb-2">No telemetry data available</p>
                <p className="text-gray-600 text-sm">
                  This device hasn't sent any telemetry data in the selected time range.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Temperature Chart */}
                {telemetryData.some(d => d.temperature !== null && d.temperature !== undefined) && (
                  <TelemetryChartCard
                    title="Temperature"
                    data={telemetryData}
                    dataKey="temperature"
                    unit="°C"
                    color="#ef4444"
                  />
                )}

                {/* Humidity Chart */}
                {telemetryData.some(d => d.humidity !== null && d.humidity !== undefined) && (
                  <TelemetryChartCard
                    title="Humidity"
                    data={telemetryData}
                    dataKey="humidity"
                    unit="%"
                    color="#3b82f6"
                  />
                )}

                {/* Battery Chart */}
                {telemetryData.some(d => d.battery !== null && d.battery !== undefined) && (
                  <TelemetryChartCard
                    title="Battery Level"
                    data={telemetryData}
                    dataKey="battery"
                    unit="%"
                    color="#10b981"
                  />
                )}

                {/* RSSI Chart */}
                {telemetryData.some(d => d.rssi !== null && d.rssi !== undefined) && (
                  <TelemetryChartCard
                    title="Signal Strength (RSSI)"
                    data={telemetryData}
                    dataKey="rssi"
                    unit="dBm"
                    color="#8b5cf6"
                  />
                )}

                {/* Pressure Chart */}
                {telemetryData.some(d => d.pressure !== null && d.pressure !== undefined) && (
                  <TelemetryChartCard
                    title="Pressure"
                    data={telemetryData}
                    dataKey="pressure"
                    unit="hPa"
                    color="#f59e0b"
                  />
                )}

                {/* Payload Charts - for device-specific telemetry */}
                {/* Voltage Chart */}
                {telemetryData.some(d => d.payload?.voltage !== null && d.payload?.voltage !== undefined) && (
                  <TelemetryChartCard
                    title="Voltage"
                    data={telemetryData}
                    payloadKey="voltage"
                    unit="V"
                    color="#6366f1"
                  />
                )}

                {/* Current Chart */}
                {telemetryData.some(d => d.payload?.current !== null && d.payload?.current !== undefined) && (
                  <TelemetryChartCard
                    title="Current"
                    data={telemetryData}
                    payloadKey="current"
                    unit="A"
                    color="#ec4899"
                  />
                )}

                {/* Power Chart */}
                {telemetryData.some(d => d.payload?.power !== null && d.payload?.power !== undefined) && (
                  <TelemetryChartCard
                    title="Power"
                    data={telemetryData}
                    payloadKey="power"
                    unit="W"
                    color="#f59e0b"
                  />
                )}

                {/* Energy Chart */}
                {telemetryData.some(d => d.payload?.energy !== null && d.payload?.energy !== undefined) && (
                  <TelemetryChartCard
                    title="Energy"
                    data={telemetryData}
                    payloadKey="energy"
                    unit="kWh"
                    color="#10b981"
                  />
                )}

                {/* Flow Rate Chart */}
                {telemetryData.some(d => d.payload?.flow_rate !== null && d.payload?.flow_rate !== undefined) && (
                  <TelemetryChartCard
                    title="Flow Rate"
                    data={telemetryData}
                    payloadKey="flow_rate"
                    unit="L/min"
                    color="#3b82f6"
                  />
                )}

                {/* Total Volume Chart */}
                {telemetryData.some(d => d.payload?.total_volume !== null && d.payload?.total_volume !== undefined) && (
                  <TelemetryChartCard
                    title="Total Volume"
                    data={telemetryData}
                    payloadKey="total_volume"
                    unit="L"
                    color="#8b5cf6"
                  />
                )}

                {/* Speed Chart (GPS Trackers) */}
                {telemetryData.some(d => d.payload?.speed !== null && d.payload?.speed !== undefined) && (
                  <TelemetryChartCard
                    title="Speed"
                    data={telemetryData}
                    payloadKey="speed"
                    unit="km/h"
                    color="#ef4444"
                  />
                )}

                {/* CPU Usage Chart (Gateways) */}
                {telemetryData.some(d => d.payload?.cpu_usage !== null && d.payload?.cpu_usage !== undefined) && (
                  <TelemetryChartCard
                    title="CPU Usage"
                    data={telemetryData}
                    payloadKey="cpu_usage"
                    unit="%"
                    color="#f59e0b"
                  />
                )}

                {/* Memory Usage Chart (Gateways) */}
                {telemetryData.some(d => d.payload?.memory_usage !== null && d.payload?.memory_usage !== undefined) && (
                  <TelemetryChartCard
                    title="Memory Usage"
                    data={telemetryData}
                    payloadKey="memory_usage"
                    unit="%"
                    color="#8b5cf6"
                  />
                )}

                {/* Air Quality Chart */}
                {telemetryData.some(d => d.payload?.air_quality !== null && d.payload?.air_quality !== undefined) && (
                  <TelemetryChartCard
                    title="Air Quality Index"
                    data={telemetryData}
                    payloadKey="air_quality"
                    unit="AQI"
                    color="#ef4444"
                  />
                )}

                {/* Target Temperature Chart (Thermostats) */}
                {telemetryData.some(d => d.payload?.target_temperature !== null && d.payload?.target_temperature !== undefined) && (
                  <TelemetryChartCard
                    title="Target Temperature"
                    data={telemetryData}
                    payloadKey="target_temperature"
                    unit="°C"
                    color="#10b981"
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Alarms Tab */}
        {activeTab === 'alarms' && <DeviceAlarms deviceId={deviceId} />}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <DeviceSettings device={device} deviceId={deviceId} onUpdate={setDevice} />
        )}
      </main>
    </div>
  );
}

// Telemetry Chart Card Component
function TelemetryChartCard({
  title,
  data,
  dataKey,
  unit,
  color,
  payloadKey
}: {
  title: string;
  data: TelemetryPoint[];
  dataKey?: keyof TelemetryPoint;
  unit: string;
  color: string;
  payloadKey?: string;
}) {
  const chartData = data
    .map(d => {
      let value: number | null | undefined;

      // Check payload first if payloadKey is provided
      if (payloadKey && d.payload && typeof d.payload[payloadKey] === 'number') {
        value = d.payload[payloadKey];
      } else if (dataKey && d[dataKey] !== null && d[dataKey] !== undefined) {
        value = d[dataKey] as number;
      }

      return {
        time: new Date(d.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        value
      };
    })
    .filter(d => d.value !== null && d.value !== undefined) as { time: string; value: number }[];

  if (chartData.length === 0) return null;

  const latestValue = chartData[chartData.length - 1]?.value;
  const minValue = Math.min(...chartData.map(d => d.value));
  const maxValue = Math.max(...chartData.map(d => d.value));
  const avgValue = chartData.reduce((acc, d) => acc + d.value, 0) / chartData.length;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <span className="text-2xl font-bold" style={{ color }}>
          {latestValue?.toFixed(1)} {unit}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="time"
            stroke="#64748b"
            style={{ fontSize: '12px' }}
            tick={{ fill: '#64748b' }}
          />
          <YAxis
            stroke="#64748b"
            style={{ fontSize: '12px' }}
            tick={{ fill: '#64748b' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#gradient-${dataKey})`}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-200">
        <div>
          <p className="text-xs text-gray-500">Min</p>
          <p className="text-sm font-semibold text-gray-900">{minValue.toFixed(1)} {unit}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Avg</p>
          <p className="text-sm font-semibold text-gray-900">{avgValue.toFixed(1)} {unit}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Max</p>
          <p className="text-sm font-semibold text-gray-900">{maxValue.toFixed(1)} {unit}</p>
        </div>
      </div>
    </div>
  );
}

// Device Alarms Component
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
  }, [deviceId, severityFilter, statusFilter, selectedId]);

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
      <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as any)} className="px-3 py-2.5 border border-gray-300 rounded-lg bg-white text-sm">
            <option value="all">All severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="MAJOR">Major</option>
            <option value="MINOR">Minor</option>
            <option value="WARNING">Warning</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2.5 border border-gray-300 rounded-lg bg-white text-sm">
            <option value="all">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="CLEARED">Cleared</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
          <span className="text-sm font-semibold text-gray-800">Device Alarms</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-gray-600">Loading alarms...</div>
          ) : error ? (
            <div className="p-6 text-center text-red-600">{error}</div>
          ) : alarms.length === 0 ? (
            <div className="p-6 text-center text-gray-600">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No alarms for this device</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {alarms.map(a => (
                <li key={a.id}>
                  <button onClick={() => setSelectedId(a.id)} className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors ${selectedId === a.id ? 'bg-blue-50' : ''}`}>
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
      <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        {!selectedId ? (
          <div className="text-gray-600 text-center py-8">Select an alarm to view details</div>
        ) : (
          (() => {
            const a = alarms.find(x => x.id === selectedId)!;
            if (!a) return null;
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
                      <button onClick={() => acknowledge(a.id)} className="px-3 py-1.5 text-sm rounded border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition-colors">Acknowledge</button>
                    )}
                    {a.status !== 'CLEARED' && (
                      <button onClick={() => clear(a.id)} className="px-3 py-1.5 text-sm rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 transition-colors">Clear</button>
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
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

// Device Settings Component
function DeviceSettings({ device, deviceId, onUpdate }: { device: Device; deviceId: string; onUpdate: (d: Device) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState({ name: device.name, device_type: device.device_type });
  const [alertRules, setAlertRules] = useState<any[]>([]);
  const [showNewRule, setShowNewRule] = useState(false);

  useEffect(() => {
    const loadRules = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
      const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules?device_id=${deviceId}`, { headers: { Authorization: `Bearer ${token}` }});
      if (res.ok) {
        const json = await res.json();
        setAlertRules(json.data || []);
      }
    };
    loadRules();
  }, [deviceId]);

  const saveDevice = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(formData)
    });
    if (res.ok) {
      const json = await res.json();
      onUpdate(json.data);
      setEditing(false);
    }
  };

  const deleteDevice = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      router.push('/dashboard/devices');
    }
  };

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled })
    });
    if (res.ok) {
      setAlertRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r));
    }
  };

  const deleteRule = async (ruleId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules/${ruleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setAlertRules(prev => prev.filter(r => r.id !== ruleId));
    }
  };

  return (
    <div className="space-y-6">
      {/* Device Information */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Device Information</h3>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
              <Edit2 className="w-4 h-4" />
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(false); setFormData({ name: device.name, device_type: device.device_type }); }} className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={saveDevice} className="px-4 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">Save Changes</button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Device Name</label>
            {editing ? (
              <input value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
            ) : (
              <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2.5 rounded-lg border border-gray-200">{device.name}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Device Type</label>
            {editing ? (
              <input value={formData.device_type} onChange={e => setFormData(prev => ({ ...prev, device_type: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
            ) : (
              <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2.5 rounded-lg border border-gray-200">{device.device_type}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Device ID</label>
            <p className="text-sm font-mono text-gray-900 bg-gray-50 px-3 py-2.5 rounded-lg border border-gray-200">{deviceId}</p>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Status</label>
            <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2.5 rounded-lg border border-gray-200 capitalize">{device.status}</p>
          </div>
        </div>
      </div>

      {/* Alert Rules */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary-600" />
            Alert Rules
          </h3>
          <button onClick={() => setShowNewRule(!showNewRule)} className="px-4 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">+ Add Rule</button>
        </div>

        {showNewRule && <NewAlertRuleForm deviceId={deviceId} onCreated={(rule) => { setAlertRules(prev => [rule, ...prev]); setShowNewRule(false); }} onCancel={() => setShowNewRule(false)} />}

        <div className="space-y-2">
          {alertRules.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-6">No alert rules configured</p>
          ) : (
            alertRules.map(rule => (
              <div key={rule.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {rule.name || `${rule.metric?.toUpperCase() || 'Alert'} ${rule.operator === 'gt' ? '>' : rule.operator === 'lt' ? '<' : rule.operator === 'gte' ? '≥' : rule.operator === 'lte' ? '≤' : '='} ${rule.threshold || ''}`}
                  </p>
                  <p className="text-xs text-gray-600">Cooldown: {rule.cooldown_minutes}min • Severity: {rule.severity}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleRule(rule.id, !rule.enabled)} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${rule.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button onClick={() => deleteRule(rule.id)} className="px-3 py-1.5 text-xs rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center gap-1">
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-lg border border-red-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-red-900 mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          Danger Zone
        </h3>
        <p className="text-sm text-gray-600 mb-4">Once you delete a device, there is no going back. All telemetry data, alarms, and configurations will be permanently removed.</p>
        {!deleting ? (
          <button onClick={() => setDeleting(true)} className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Delete Device
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setDeleting(false)} className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={deleteDevice} className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold">Confirm Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewAlertRuleForm({ deviceId, onCreated, onCancel }: { deviceId: string; onCreated: (rule: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    metric: 'temperature',
    operator: 'gt',
    threshold: 0,
    cooldown_minutes: 5,
    severity: 'warning',
    enabled: true
  });
  const [submitting, setSubmitting] = useState(false);

  const create = async () => {
    setSubmitting(true);
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/alert-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...formData, device_id: deviceId, rule_type: 'THRESHOLD' })
    });
    if (res.ok) {
      const json = await res.json();
      onCreated(json.data);
    }
    setSubmitting(false);
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">New Alert Rule</h4>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">Rule Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="High Temperature Alert"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Metric</label>
          <select value={formData.metric} onChange={e => setFormData(prev => ({ ...prev, metric: e.target.value as any }))} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="temperature">Temperature</option>
            <option value="humidity">Humidity</option>
            <option value="battery">Battery</option>
            <option value="rssi">RSSI</option>
            <option value="pressure">Pressure</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Operator</label>
          <select value={formData.operator} onChange={e => setFormData(prev => ({ ...prev, operator: e.target.value as any }))} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="gt">&gt; Greater than</option>
            <option value="gte">≥ Greater or equal</option>
            <option value="lt">&lt; Less than</option>
            <option value="lte">≤ Less or equal</option>
            <option value="eq">= Equal</option>
            <option value="neq">≠ Not equal</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Threshold</label>
          <input type="number" value={formData.threshold} onChange={e => setFormData(prev => ({ ...prev, threshold: parseFloat(e.target.value) || 0 }))} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Cooldown (minutes)</label>
          <input type="number" value={formData.cooldown_minutes} onChange={e => setFormData(prev => ({ ...prev, cooldown_minutes: parseInt(e.target.value) || 5 }))} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-white transition-colors">Cancel</button>
        <button onClick={create} disabled={submitting} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50">
          {submitting ? 'Creating...' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
}
