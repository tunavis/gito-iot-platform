'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { formatMetricLabel } from '@/lib/formatMetricLabel';
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
  Edit2,
  Trash2,
  Bell,
  BarChart3,
  Calendar,
  Zap,
  Droplets,
  Thermometer,
  Gauge,
  Navigation,
  Cpu,
  HardDrive,
  Package,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DeviceVisualization } from '@/components/visualization';
import useDeviceMetrics from '@/components/visualization/useDeviceMetrics';

// Icon mapping for common metrics (optional visual enhancement, NOT used for filtering)
const METRIC_ICONS: Record<string, any> = {
  battery: Battery,
  rssi: Signal,
  signal_strength: Signal,
  temperature: Thermometer,
  humidity: Droplets,
  pressure: Gauge,
  voltage: Zap,
  current: Zap,
  power: Zap,
  energy: Zap,
  speed: Navigation,
  cpu_usage: Cpu,
  memory_usage: HardDrive,
  packets_received: Package,
  packets_transmitted: Package
};

// Color mapping for common metrics (optional visual enhancement)
const METRIC_COLORS: Record<string, string> = {
  temperature: '#ef4444',
  humidity: '#3b82f6',
  battery: '#10b981',
  rssi: '#8b5cf6',
  signal_strength: '#8b5cf6',
  pressure: '#f59e0b',
  voltage: '#6366f1',
  current: '#ec4899',
  power: '#f59e0b',
  energy: '#10b981',
  speed: '#ef4444',
  cpu_usage: '#f59e0b',
  memory_usage: '#8b5cf6',
  altitude: '#3b82f6',
  flow_rate: '#3b82f6'
};

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

interface DeviceType {
  id: string;
  name: string;
  category: string;
  telemetry_schema: Record<string, {
    type: string;
    unit?: string;
    min?: number;
    max?: number;
    description?: string;
  }>;
  connectivity?: {
    protocol?: string;
    mqtt_topic_template?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Dynamic telemetry point - no hardcoded fields
interface TelemetryPoint {
  timestamp: string;
  [key: string]: any;
}

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';

export default function DeviceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const deviceId = params?.id as string;

  const [device, setDevice] = useState<Device | null>(null);
  const [deviceType, setDeviceType] = useState<DeviceType | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [telemetryData, setTelemetryData] = useState<TelemetryPoint[]>([]);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const VALID_TABS = ['live', 'overview', 'telemetry', 'alarms', 'settings'] as const;
  type TabId = typeof VALID_TABS[number];
  const _tabParam = searchParams?.get('tab') ?? 'live';
  const [activeTab, setActiveTab] = useState<TabId>(VALID_TABS.includes(_tabParam as TabId) ? (_tabParam as TabId) : 'live');
  const [tenantId, setTenantId] = useState<string>('');
  const [alarms, setAlarms] = useState<any[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  // Single real-time data source — shared by header strip AND Live Device tab.
  // This means both always show the same value with no stale-data divergence.
  const deviceMetrics = useDeviceMetrics(deviceId, tenantId, !!tenantId && !!deviceId);
  const latestValues = deviceMetrics.latestValues;

  // Auto-discover metrics from telemetry data
  const discoveredMetrics = useMemo(() => {
    if (telemetryData.length === 0) return [];

    // Get all keys from telemetry data (excluding system fields and aggregation artifacts)
    const systemFields = ['timestamp', 'device_id', 'tenant_id', 'id', 'ts', 'metric_key', 'metric_value', 'metric_value_str', 'metric_value_json', 'time_bucket', 'sample_count'];
    const metricSet = new Set<string>();

    telemetryData.forEach(point => {
      Object.keys(point).forEach(key => {
        if (!systemFields.includes(key)) {
          metricSet.add(key);
        }
      });
    });

    return Array.from(metricSet);
  }, [telemetryData]);

  // Filter numeric metrics for KPI cards
  const numericMetrics = useMemo(() => {
    return discoveredMetrics.filter(metric => {
      const sample = telemetryData.find(d => d[metric] != null);
      return sample && typeof sample[metric] === 'number';
    });
  }, [discoveredMetrics, telemetryData]);

  const getTimeRangeHours = (range: TimeRange): number => {
    const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 };
    return map[range];
  };

  // Load device and device type
  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return router.push('/auth/login');
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
      setTenantId(tenant);

      try {
        // Load device details
        const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const deviceData = (await res.json()).data;
          setDevice(deviceData);

          // Load device type if available
          if (deviceData.device_type_id) {
            const typeRes = await fetch(`/api/v1/tenants/${tenant}/device-types/${deviceData.device_type_id}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (typeRes.ok) {
              const typeData = await typeRes.json();
              setDeviceType(typeData.data || typeData);
            }
          }
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
        // Use avg aggregation for >1h to get meaningful coverage across the full range
        const aggregation = hours > 1 ? 'avg' : 'raw';

        const res = await fetch(
          `/api/v1/tenants/${tenant}/devices/${deviceId}/telemetry?start_time=${startTime}&per_page=500&aggregation=${aggregation}`,
          { headers: { Authorization: `Bearer ${token}` }}
        );

        if (res.ok) {
          const json = await res.json();
          // API returns DESC (newest first) — reverse to ASC for left→right chart display
          const data = (json.data || []).slice().reverse();
          setTelemetryData(data);
        }
      } catch (err) {
        console.error('Failed to load telemetry:', err);
      } finally {
        setTelemetryLoading(false);
      }
    };

    loadTelemetry();
  }, [deviceId, device, timeRange, refreshKey]);

  // Get metric metadata from device type schema
  const getMetricMetadata = (metricKey: string): {
    type?: string;
    unit?: string;
    min?: number;
    max?: number;
    description?: string;
  } => {
    if (!deviceType?.telemetry_schema) return {};
    return deviceType.telemetry_schema[metricKey] || {};
  };

  // Calculate trend for any metric
  const calculateTrend = (metricKey: string) => {
    if (telemetryData.length < 2) return null;
    const recentData = telemetryData.slice(-10).filter(d => d[metricKey] != null && typeof d[metricKey] === 'number');
    if (recentData.length < 2) return null;

    const values = recentData.map(d => d[metricKey] as number);
    const avg1 = values.slice(0, Math.floor(values.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(values.length / 2);
    const avg2 = values.slice(Math.floor(values.length / 2)).reduce((a, b) => a + b, 0) / Math.ceil(values.length / 2);

    const change = ((avg2 - avg1) / avg1) * 100;
    return { value: change, direction: change > 0 ? 'up' : 'down' };
  };

  // Get current value for metric (latest/most recent)
  const getCurrentValue = (metricKey: string) => {
    // Get the LAST point with this metric (most recent), not the first
    const pointsWithMetric = telemetryData.filter(d => d[metricKey] != null);
    if (pointsWithMetric.length === 0) return null;
    const latestPoint = pointsWithMetric[pointsWithMetric.length - 1];
    return latestPoint[metricKey];
  };

  // Calculate health score
  const healthScore = useMemo(() => {
    if (!device) return 0;
    let score = 100;

    if (device.status === 'offline') score -= 50;
    else if (device.status === 'idle') score -= 20;

    if (device.battery_level !== null && device.battery_level < 20) score -= 20;
    else if (device.battery_level !== null && device.battery_level < 50) score -= 10;

    if (device.signal_strength !== null && device.signal_strength < -100) score -= 15;
    else if (device.signal_strength !== null && device.signal_strength < -80) score -= 5;

    if (alarms.length > 0) score -= Math.min(alarms.length * 5, 20);

    return Math.max(0, score);
  }, [device, alarms]);

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 60) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const exportTelemetry = () => {
    if (telemetryData.length === 0 || discoveredMetrics.length === 0) return;

    const csv = [
      ['Timestamp', ...discoveredMetrics].join(','),
      ...telemetryData.map(d => [
        d.timestamp,
        ...discoveredMetrics.map(m => d[m] ?? '')
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
      <div className="flex min-h-screen bg-page">
        <Sidebar />
        <main className="flex-1 ml-64 p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin mb-4">
              <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
            </div>
            <p className="text-th-secondary font-medium">Loading device...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="flex min-h-screen bg-page">
        <Sidebar />
        <main className="flex-1 ml-64 p-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
            <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <p className="text-red-900 font-semibold mb-2">Device not found</p>
            <p className="text-red-600 text-sm mb-4">The device you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.</p>
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
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/dashboard/devices')}
            className="text-sm text-th-muted hover:text-th-primary font-medium mb-4 transition-colors flex items-center gap-1.5"
          >
            ← Devices
          </button>

          {/* Hero card */}
          <div className="bg-surface rounded-xl border border-th-default shadow-sm overflow-hidden">
            {/* Status stripe */}
            <div className={`h-1 w-full ${
              device.status === 'online' ? 'bg-green-400' :
              device.status === 'offline' ? 'bg-red-400' : 'bg-yellow-400'
            }`} />

            <div className="p-5">
              {/* Top row */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-xl font-bold text-th-primary truncate">{device.name}</h1>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border flex-shrink-0 ${
                      device.status === 'online'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : device.status === 'offline'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        device.status === 'online' ? 'bg-green-500 animate-pulse' :
                        device.status === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
                      }`} />
                      {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
                    </span>
                    {wsConnected && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-700 flex-shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        Live
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-th-muted flex-wrap">
                    <span className="font-mono bg-page border border-th-subtle px-2 py-0.5 rounded">{deviceId.substring(0, 16)}…</span>
                    <span>·</span>
                    <span>{device.device_type}</span>
                    {device.location && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {device.location.latitude.toFixed(4)}, {device.location.longitude.toFixed(4)}
                        </span>
                      </>
                    )}
                    {device.last_seen && (
                      <>
                        <span>·</span>
                        <span className={device.status === 'online' ? 'text-green-600 font-medium' : ''}>
                          {(() => {
                            const diff = Date.now() - new Date(device.last_seen).getTime();
                            const s = Math.floor(diff / 1000);
                            if (s < 5) return 'Just now';
                            if (s < 60) return `${s}s ago`;
                            const m = Math.floor(s / 60);
                            if (m < 60) return `${m}m ago`;
                            const h = Math.floor(m / 60);
                            if (h < 24) return `${h}h ago`;
                            return `${Math.floor(h / 24)}d ago`;
                          })()}
                        </span>
                      </>
                    )}
                    <button
                      onClick={() => setShowDetails(v => !v)}
                      className="ml-1 flex items-center gap-0.5 text-th-muted hover:text-th-secondary transition-colors"
                    >
                      {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      Details
                    </button>
                  </div>
                  {showDetails && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <p className="text-xs text-th-muted mb-0.5">Device ID</p>
                        <p className="text-xs font-mono text-th-primary bg-page border border-th-subtle px-2 py-1 rounded truncate">{deviceId}</p>
                      </div>
                      {device.dev_eui && (
                        <div>
                          <p className="text-xs text-th-muted mb-0.5">Device EUI</p>
                          <p className="text-xs font-mono text-th-primary bg-page border border-th-subtle px-2 py-1 rounded">{device.dev_eui}</p>
                        </div>
                      )}
                      {device.firmware_version && (
                        <div>
                          <p className="text-xs text-th-muted mb-0.5">Firmware</p>
                          <p className="text-xs text-th-primary bg-page border border-th-subtle px-2 py-1 rounded">{device.firmware_version}</p>
                        </div>
                      )}
                      {device.hardware_version && (
                        <div>
                          <p className="text-xs text-th-muted mb-0.5">Hardware</p>
                          <p className="text-xs text-th-primary bg-page border border-th-subtle px-2 py-1 rounded">{device.hardware_version}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-th-muted mb-0.5">Created</p>
                        <p className="text-xs text-th-primary bg-page border border-th-subtle px-2 py-1 rounded">{new Date(device.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className={`flex-shrink-0 px-3 py-2 rounded-lg border text-xs font-semibold ${getHealthColor(healthScore)}`}>
                  Health {healthScore}%
                </div>
              </div>

              {/* Live metrics strip — schema-declared numeric metrics with real-time /latest values */}
              {(() => {
                // Prefer schema-declared metrics; fall back to what we've seen in live data
                const schemaKeys = deviceType?.telemetry_schema
                  ? Object.entries(deviceType.telemetry_schema)
                      .filter(([, s]) => !s.type || ['float', 'integer', 'number'].includes(s.type))
                      .map(([k]) => k)
                  : numericMetrics;
                // Only show metrics that have a current value
                const stripMetrics = schemaKeys.filter(k => latestValues[k] != null).slice(0, 6);
                if (stripMetrics.length === 0) return null;
                return (
                  <div className="flex items-stretch gap-0 border border-th-subtle rounded-lg overflow-hidden">
                    {stripMetrics.map((metric, i) => {
                      const value = latestValues[metric];
                      const trend = calculateTrend(metric);
                      const meta = getMetricMetadata(metric);
                      const isUp = trend && trend.direction === 'up';
                      return (
                        <div key={metric} className={`flex-1 px-4 py-3 text-center ${i > 0 ? 'border-l border-th-subtle' : ''} bg-page`}>
                          <p className="text-xs text-th-muted mb-1 truncate">
                            {formatMetricLabel(metric, deviceType?.telemetry_schema)}
                          </p>
                          <p className="text-lg font-bold text-th-primary leading-none">
                            {typeof value === 'number' ? value.toFixed(1) : '—'}
                            {meta.unit && <span className="text-xs font-normal text-th-muted ml-0.5">{meta.unit}</span>}
                          </p>
                          {trend && (
                            <p className={`text-xs font-medium mt-0.5 ${isUp ? 'text-orange-500' : 'text-green-500'}`}>
                              {isUp ? '↑' : '↓'} {Math.abs(trend.value).toFixed(1)}%
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-th-default mb-6">
          <nav className="flex gap-6">
            {([
              { key: 'live', label: 'Monitor' },
              { key: 'overview', label: 'Overview' },
              { key: 'telemetry', label: 'History' },
              { key: 'alarms', label: 'Alarms' },
              { key: 'settings', label: 'Configure' },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 px-2 border-b-2 font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-th-secondary hover:text-th-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Live Device Tab — Visualization Layer */}
        {activeTab === 'live' && tenantId && (
          <div className="rounded-xl border p-6 gito-card">
            <DeviceVisualization
              deviceId={deviceId}
              tenantId={tenantId}
              telemetrySchema={deviceType?.telemetry_schema ?? {}}
              deviceCategory={deviceType?.category}
              deviceStatus={device?.status}
              metrics={deviceMetrics}
            />
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Device Information */}
            <div className="bg-surface rounded-xl border border-th-default shadow-sm p-6">
              <h3 className="text-lg font-semibold text-th-primary mb-4">Device Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-th-secondary mb-1">Device ID</p>
                  <p className="font-mono text-sm text-th-primary bg-page px-3 py-2 rounded border border-th-default">{deviceId}</p>
                </div>
                <div>
                  <p className="text-sm text-th-secondary mb-1">Device Type</p>
                  <p className="text-sm text-th-primary bg-page px-3 py-2 rounded border border-th-default">{device.device_type}</p>
                </div>
                <div>
                  <p className="text-sm text-th-secondary mb-1">Status</p>
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
                    <p className="text-sm text-th-secondary mb-1">Device EUI</p>
                    <p className="font-mono text-sm text-th-primary bg-page px-3 py-2 rounded border border-th-default">{device.dev_eui}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-th-secondary mb-1">Created</p>
                  <p className="text-sm text-th-primary bg-page px-3 py-2 rounded border border-th-default">
                    {new Date(device.created_at).toLocaleDateString()}
                  </p>
                </div>
                {device.firmware_version && (
                  <div>
                    <p className="text-sm text-th-secondary mb-1">Firmware Version</p>
                    <p className="text-sm text-th-primary bg-page px-3 py-2 rounded border border-th-default">{device.firmware_version}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-surface rounded-xl border border-th-default shadow-sm p-6">
              <h3 className="text-lg font-semibold text-th-primary mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary-600" />
                Recent Activity
              </h3>
              <div className="space-y-3">
                {telemetryData.length === 0 ? (
                  <div className="text-center py-8 text-th-secondary">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 text-th-muted" />
                    <p className="font-medium">No telemetry data available</p>
                    <p className="text-sm mt-1">This device hasn&apos;t sent any data yet.</p>
                  </div>
                ) : (
                  telemetryData.slice(-5).reverse().map((point, idx) => {
                    // Aggregated data uses time_bucket; raw data uses timestamp
                    const ts = point.time_bucket || point.timestamp;
                    const tsDate = ts ? new Date(ts) : null;
                    return (
                      <div key={idx} className="flex items-center justify-between py-2 border-b border-th-subtle last:border-0">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                            <Activity className="w-4 h-4 text-primary-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-th-primary">Telemetry received</p>
                            <p className="text-xs text-th-secondary">
                              {tsDate && !isNaN(tsDate.getTime()) ? tsDate.toLocaleString() : 'Unknown time'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right text-xs text-th-secondary">
                          {numericMetrics.slice(0, 2).map(m => point[m] != null && (
                            <p key={m}>{formatMetricLabel(m, deviceType?.telemetry_schema)}: {typeof point[m] === 'number' ? (point[m] as number).toFixed(1) : point[m]}</p>
                          ))}
                        </div>
                      </div>
                    );
                  })
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
                <Calendar className="w-5 h-5 text-th-muted" />
                <div className="flex items-center gap-2 bg-surface border border-th-default rounded-lg p-1">
                  {(['1h', '6h', '24h', '7d', '30d'] as TimeRange[]).map(range => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
                        timeRange === range
                          ? 'bg-primary-600 text-white'
                          : 'text-th-secondary hover:bg-panel'
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRefreshKey(k => k + 1)}
                  className="px-4 py-2 text-sm border border-[var(--color-input-border)] rounded-lg hover:bg-panel transition-colors flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${telemetryLoading ? 'animate-spin' : ''}`} />
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
              <div className="bg-surface rounded-xl border border-th-default shadow-sm p-12 text-center">
                <div className="inline-block animate-spin mb-4">
                  <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
                </div>
                <p className="text-th-secondary">Loading telemetry data...</p>
              </div>
            ) : telemetryData.length === 0 ? (
              <div className="bg-surface rounded-xl border border-th-default shadow-sm p-12 text-center">
                <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-th-primary font-semibold mb-2">No telemetry data available</p>
                <p className="text-th-secondary text-sm">
                  This device hasn&apos;t sent any telemetry data in the selected time range.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {/* Dynamically generate charts for all numeric metrics */}
                {numericMetrics.map(metricKey => {
                  const metadata = getMetricMetadata(metricKey);
                  const color = METRIC_COLORS[metricKey] || '#6366f1';

                  return (
                    <TelemetryChartCard
                      key={metricKey}
                      title={formatMetricLabel(metricKey, deviceType?.telemetry_schema)}
                      data={telemetryData}
                      metricKey={metricKey}
                      unit={metadata.unit || ''}
                      color={color}
                      timeRangeHours={getTimeRangeHours(timeRange)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Alarms Tab */}
        {activeTab === 'alarms' && <DeviceAlarms deviceId={deviceId} />}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <DeviceSettings device={device} deviceId={deviceId} onUpdate={setDevice} discoveredMetrics={discoveredMetrics} />
        )}
      </main>
    </div>
  );
}

// Dynamic Telemetry Chart Card
function TelemetryChartCard({
  title,
  data,
  metricKey,
  unit,
  color,
  timeRangeHours,
}: {
  title: string;
  data: TelemetryPoint[];
  metricKey: string;
  unit: string;
  color: string;
  timeRangeHours: number;
}) {
  // Support both raw (timestamp) and aggregated (time_bucket) response formats
  const chartData = data
    .map(d => {
      const rawTime = d.timestamp || d.time_bucket;
      if (!rawTime) return null;
      const date = new Date(rawTime);
      let label: string;
      if (timeRangeHours <= 6) {
        label = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (timeRangeHours <= 48) {
        label = date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      } else {
        label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      return { time: label, value: d[metricKey], _ts: date.getTime() };
    })
    .filter((d): d is { time: string; value: number; _ts: number } =>
      d !== null && d.value != null && typeof d.value === 'number'
    );

  if (chartData.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-th-default shadow-sm p-6 flex flex-col items-center justify-center min-h-[320px]">
        <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: `${color}15` }}>
          <BarChart3 className="w-6 h-6" style={{ color }} />
        </div>
        <p className="text-sm font-medium text-th-primary">{title}</p>
        <p className="text-xs text-th-muted mt-1">No data in selected range</p>
      </div>
    );
  }

  const latestValue = chartData[chartData.length - 1]?.value;
  const minValue = Math.min(...chartData.map(d => d.value));
  const maxValue = Math.max(...chartData.map(d => d.value));
  const avgValue = chartData.reduce((acc, d) => acc + d.value, 0) / chartData.length;

  return (
    <div className="bg-surface rounded-xl border border-th-default shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-th-primary">{title}</h3>
        <span className="text-2xl font-bold" style={{ color }}>
          {typeof latestValue === 'number' ? latestValue.toFixed(1) : '—'} <span className="text-sm font-normal text-th-secondary">{unit}</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`gradient-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="time"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={45}
            tickFormatter={(v) => `${v}${unit ? ` ${unit}` : ''}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              fontSize: '13px',
            }}
            formatter={(value: number) => [`${value.toFixed(2)} ${unit}`, title]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fillOpacity={1}
            fill={`url(#gradient-${metricKey})`}
            dot={chartData.length <= 20 ? { r: 3, fill: color } : false}
            activeDot={{ r: 5, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-th-subtle">
        <div className="text-center">
          <p className="text-xs text-th-muted mb-0.5">Min</p>
          <p className="text-sm font-semibold text-th-primary">{minValue.toFixed(1)} <span className="font-normal text-th-muted">{unit}</span></p>
        </div>
        <div className="text-center">
          <p className="text-xs text-th-muted mb-0.5">Avg</p>
          <p className="text-sm font-semibold text-th-primary">{avgValue.toFixed(1)} <span className="font-normal text-th-muted">{unit}</span></p>
        </div>
        <div className="text-center">
          <p className="text-xs text-th-muted mb-0.5">Max</p>
          <p className="text-sm font-semibold text-th-primary">{maxValue.toFixed(1)} <span className="font-normal text-th-muted">{unit}</span></p>
        </div>
      </div>
    </div>
  );
}

// Device Alarms Component (unchanged from original)
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
      <div className="lg:col-span-3 bg-surface border border-th-default rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as any)} className="px-3 py-2.5 border border-[var(--color-input-border)] rounded-lg bg-surface text-sm">
            <option value="all">All severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="MAJOR">Major</option>
            <option value="MINOR">Minor</option>
            <option value="WARNING">Warning</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2.5 border border-[var(--color-input-border)] rounded-lg bg-surface text-sm">
            <option value="all">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="CLEARED">Cleared</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="bg-surface border border-th-default rounded-xl overflow-hidden shadow-sm">
        <div className="border-b border-th-default px-4 py-3 flex items-center justify-between bg-page">
          <span className="text-sm font-semibold text-th-primary">Device Alarms</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-th-secondary">Loading alarms...</div>
          ) : error ? (
            <div className="p-6 text-center text-red-600">{error}</div>
          ) : alarms.length === 0 ? (
            <div className="p-6 text-center text-th-secondary">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No alarms for this device</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {alarms.map(a => (
                <li key={a.id}>
                  <button onClick={() => setSelectedId(a.id)} className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-panel transition-colors ${selectedId === a.id ? 'bg-blue-50' : ''}`}>
                    <div className={severityChip(a.severity)}>{a.severity}</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-th-primary">{a.alarm_type}</p>
                      <p className="text-xs text-th-secondary">{new Date(a.fired_at).toLocaleString()}</p>
                      <p className="text-xs text-th-primary mt-1 line-clamp-2">{a.message || '—'}</p>
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
      <div className="lg:col-span-2 bg-surface border border-th-default rounded-xl p-6 shadow-sm">
        {!selectedId ? (
          <div className="text-th-secondary text-center py-8">Select an alarm to view details</div>
        ) : (
          (() => {
            const a = alarms.find(x => x.id === selectedId)!;
            if (!a) return null;
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={severityChip(a.severity)}>{a.severity}</div>
                    <h3 className="text-lg font-semibold text-th-primary">{a.alarm_type}</h3>
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
                    <p className="text-xs text-th-secondary">Status</p>
                    <p className="text-sm text-th-primary">{a.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-th-secondary">Fired at</p>
                    <p className="text-sm text-th-primary">{new Date(a.fired_at).toLocaleString()}</p>
                  </div>
                  {a.acknowledged_at && (
                    <div>
                      <p className="text-xs text-th-secondary">Acknowledged at</p>
                      <p className="text-sm text-th-primary">{new Date(a.acknowledged_at).toLocaleString()}</p>
                    </div>
                  )}
                  {a.cleared_at && (
                    <div>
                      <p className="text-xs text-th-secondary">Cleared at</p>
                      <p className="text-sm text-th-primary">{new Date(a.cleared_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>

                <div className="border-t border-th-default pt-4">
                  <p className="text-xs text-th-secondary mb-1">Message</p>
                  <p className="text-sm text-th-primary whitespace-pre-wrap">{a.message || '—'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-th-secondary">Source</p>
                    <p className="text-sm text-th-primary">{a.source || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-th-secondary">Metric</p>
                    <p className="text-sm text-th-primary">{a.metric_name || '—'} {a.metric_value != null ? `(${a.metric_value})` : ''}</p>
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

// Device Settings Component - now dynamic
function DeviceSettings({ device, deviceId, onUpdate, discoveredMetrics }: { device: Device; deviceId: string; onUpdate: (d: Device) => void; discoveredMetrics: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState({ name: device.name, device_type: device.device_type });
  const [alertRules, setAlertRules] = useState<any[]>([]);
  const [showNewRule, setShowNewRule] = useState(false);

  // API Credentials state
  const [tokens, setTokens] = useState<any[]>([]);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [revealedToken, setRevealedToken] = useState<{ token: string; name: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

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
    const loadTokens = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
      const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}/credentials`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        setTokens(json.data || []);
      }
    };
    loadRules();
    loadTokens();
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

  const generateToken = async () => {
    setGeneratingToken(true);
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newTokenName || 'Default' }),
    });
    if (res.ok) {
      const json = await res.json();
      const created = json.data;
      setTokens(prev => [created, ...prev]);
      setRevealedToken({ token: created.token, name: created.name });
      setNewTokenName('');
      setCopiedToken(false);
    }
    setGeneratingToken(false);
  };

  const revokeToken = async (credId: string) => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;
    const res = await fetch(`/api/v1/tenants/${tenant}/devices/${deviceId}/credentials/${credId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setTokens(prev => prev.filter(t => t.id !== credId));
    }
  };

  const copyToken = (plainToken: string) => {
    navigator.clipboard.writeText(plainToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Device Information */}
      <div className="bg-surface rounded-xl border border-th-default shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-th-primary">Device Information</h3>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="px-4 py-2.5 text-sm border border-[var(--color-input-border)] rounded-lg hover:bg-panel transition-colors flex items-center gap-2">
              <Edit2 className="w-4 h-4" />
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(false); setFormData({ name: device.name, device_type: device.device_type }); }} className="px-4 py-2.5 text-sm border border-[var(--color-input-border)] rounded-lg hover:bg-panel transition-colors">Cancel</button>
              <button onClick={saveDevice} className="px-4 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">Save Changes</button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-th-secondary mb-1">Device Name</label>
            {editing ? (
              <input value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} className="w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
            ) : (
              <p className="text-sm text-th-primary bg-page px-3 py-2.5 rounded-lg border border-th-default">{device.name}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-th-secondary mb-1">Device Type</label>
            {editing ? (
              <input value={formData.device_type} onChange={e => setFormData(prev => ({ ...prev, device_type: e.target.value }))} className="w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
            ) : (
              <p className="text-sm text-th-primary bg-page px-3 py-2.5 rounded-lg border border-th-default">{device.device_type}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-th-secondary mb-1">Device ID</label>
            <p className="text-sm font-mono text-th-primary bg-page px-3 py-2.5 rounded-lg border border-th-default">{deviceId}</p>
          </div>
          <div>
            <label className="block text-sm text-th-secondary mb-1">Status</label>
            <p className="text-sm text-th-primary bg-page px-3 py-2.5 rounded-lg border border-th-default capitalize">{device.status}</p>
          </div>
        </div>
      </div>

      {/* Alert Rules */}
      <div className="bg-surface rounded-xl border border-th-default shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-th-primary flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary-600" />
            Alert Rules
          </h3>
          <button onClick={() => setShowNewRule(!showNewRule)} className="px-4 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">+ Add Rule</button>
        </div>

        {showNewRule && <NewAlertRuleForm deviceId={deviceId} discoveredMetrics={discoveredMetrics} onCreated={(rule) => { setAlertRules(prev => [rule, ...prev]); setShowNewRule(false); }} onCancel={() => setShowNewRule(false)} />}

        <div className="space-y-2">
          {alertRules.length === 0 ? (
            <p className="text-sm text-th-secondary text-center py-6">No alert rules configured</p>
          ) : (
            alertRules.map(rule => (
              <div key={rule.id} className="flex items-center justify-between p-3 border border-th-default rounded-lg hover:bg-panel transition-colors">
                <div className="flex-1">
                  <p className="text-sm font-medium text-th-primary">
                    {rule.name || `${rule.metric?.toUpperCase() || 'Alert'} ${rule.operator === 'gt' ? '>' : rule.operator === 'lt' ? '<' : rule.operator === 'gte' ? '≥' : rule.operator === 'lte' ? '≤' : '='} ${rule.threshold || ''}`}
                  </p>
                  <p className="text-xs text-th-secondary">Cooldown: {rule.cooldown_minutes}min • Severity: {rule.severity}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleRule(rule.id, !rule.enabled)} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${rule.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-panel text-th-secondary hover:bg-panel'}`}>
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

      {/* API Credentials */}
      <div className="bg-surface rounded-xl border border-th-default shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-th-primary">API Credentials</h3>
            <p className="text-sm text-th-secondary mt-0.5">Device tokens let hardware push telemetry without a user account.</p>
          </div>
        </div>

        {/* One-time token reveal */}
        {revealedToken && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm font-semibold text-amber-800 mb-2">⚠ Save this token — it will not be shown again</p>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 text-xs font-mono bg-surface border border-amber-300 rounded px-3 py-2 text-th-primary break-all">{revealedToken.token}</code>
              <button onClick={() => copyToken(revealedToken.token)} className="px-3 py-2 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors whitespace-nowrap">
                {copiedToken ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-amber-700 font-medium mb-1">Usage:</p>
            <pre className="text-xs bg-gray-900 text-green-300 rounded p-2 overflow-x-auto">{`curl -X POST /api/v1/ingest \\
  -H "X-Device-Token: ${revealedToken.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"temperature": 25.5}'`}</pre>
            <button onClick={() => setRevealedToken(null)} className="mt-2 text-xs text-amber-700 hover:underline">Dismiss</button>
          </div>
        )}

        {/* Generate new token */}
        <div className="flex gap-2 mb-4">
          <input
            value={newTokenName}
            onChange={e => setNewTokenName(e.target.value)}
            placeholder="Token name (e.g. Factory Floor Sensor)"
            className="flex-1 px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={generateToken}
            disabled={generatingToken}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {generatingToken ? 'Generating…' : '+ Generate Token'}
          </button>
        </div>

        {/* Token list */}
        {tokens.length === 0 ? (
          <p className="text-sm text-th-secondary text-center py-4">No tokens yet — generate one above</p>
        ) : (
          <div className="space-y-2">
            {tokens.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-3 border border-th-default rounded-lg hover:bg-panel transition-colors">
                <div>
                  <p className="text-sm font-medium text-th-primary">{t.name}</p>
                  <p className="text-xs text-th-secondary">
                    Created {new Date(t.created_at).toLocaleDateString()}
                    {t.expires_at ? ` · Expires ${new Date(t.expires_at).toLocaleDateString()}` : ' · Never expires'}
                    {' · '}
                    <span className={t.status === 'active' ? 'text-green-600' : 'text-th-muted'}>{t.status}</span>
                  </p>
                </div>
                <button
                  onClick={() => revokeToken(t.id)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="bg-surface rounded-xl border border-red-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-red-900 mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          Danger Zone
        </h3>
        <p className="text-sm text-th-secondary mb-4">Once you delete a device, there is no going back. All telemetry data, alarms, and configurations will be permanently removed.</p>
        {!deleting ? (
          <button onClick={() => setDeleting(true)} className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Delete Device
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setDeleting(false)} className="px-4 py-2.5 text-sm border border-[var(--color-input-border)] rounded-lg hover:bg-panel transition-colors">Cancel</button>
            <button onClick={deleteDevice} className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold">Confirm Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Dynamic New Alert Rule Form
function NewAlertRuleForm({ deviceId, discoveredMetrics, onCreated, onCancel }: { deviceId: string; discoveredMetrics: string[]; onCreated: (rule: any) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    metric: discoveredMetrics[0] || '',
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
    <div className="bg-page border border-th-default rounded-lg p-4 mb-4">
      <h4 className="text-sm font-semibold text-th-primary mb-3">New Alert Rule</h4>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="col-span-2">
          <label className="block text-xs text-th-secondary mb-1">Rule Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="High Temperature Alert"
            className="w-full px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-xs text-th-secondary mb-1">Metric</label>
          <select value={formData.metric} onChange={e => setFormData(prev => ({ ...prev, metric: e.target.value as any }))} className="w-full px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500">
            {discoveredMetrics.length === 0 ? (
              <option value="">No metrics available</option>
            ) : (
              discoveredMetrics.map(m => (
                <option key={m} value={m}>{formatMetricLabel(m)}</option>
              ))
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs text-th-secondary mb-1">Operator</label>
          <select value={formData.operator} onChange={e => setFormData(prev => ({ ...prev, operator: e.target.value as any }))} className="w-full px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option value="gt">&gt; Greater than</option>
            <option value="gte">≥ Greater or equal</option>
            <option value="lt">&lt; Less than</option>
            <option value="lte">≤ Less or equal</option>
            <option value="eq">= Equal</option>
            <option value="neq">≠ Not equal</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-th-secondary mb-1">Threshold</label>
          <input type="number" value={formData.threshold} onChange={e => setFormData(prev => ({ ...prev, threshold: parseFloat(e.target.value) || 0 }))} className="w-full px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div>
          <label className="block text-xs text-th-secondary mb-1">Cooldown (minutes)</label>
          <input type="number" value={formData.cooldown_minutes} onChange={e => setFormData(prev => ({ ...prev, cooldown_minutes: parseInt(e.target.value) || 5 }))} className="w-full px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm border border-[var(--color-input-border)] rounded-lg hover:bg-surface transition-colors">Cancel</button>
        <button onClick={create} disabled={submitting || discoveredMetrics.length === 0} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50">
          {submitting ? 'Creating...' : 'Create Rule'}
        </button>
      </div>
    </div>
  );
}
