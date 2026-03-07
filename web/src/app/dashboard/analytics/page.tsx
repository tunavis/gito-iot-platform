'use client';

import { useEffect, useState, useCallback } from 'react';
import PageShell from '@/components/ui/PageShell';
import ErrorBanner from '@/components/ui/ErrorBanner';
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  Cpu,
  Battery,
  CheckCircle2,
  XCircle,
  Calendar,
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface FleetOverview {
  total_devices: number;
  status_distribution: Record<string, number>;
  device_type_distribution: Record<string, number>;
  average_battery_level: number;
  low_battery_devices: number;
}

interface AlertTrends {
  period: { days: number; start_date: string; end_date: string };
  total_alarms: number;
  severity_distribution: Record<string, number>;
  status_distribution: Record<string, number>;
  top_alerting_devices: Array<{ device_id: string; device_name: string; alarm_count: number }>;
  daily_trend: Array<{ date: string; count: number }>;
}

interface DeviceUptime {
  period_days: number;
  total_devices: number;
  online_now: number;
  active_in_period: number;
  uptime_percentage: number;
  availability_percentage: number;
}

interface TelemetrySummary {
  period_hours: number;
  message_count: number;
  active_devices: number;
  top_metrics: Array<{ key: string; avg: number; count: number }>;
}

const STATUS_COLORS: Record<string, string> = {
  online: '#10b981',
  offline: '#ef4444',
  idle: '#f59e0b',
  error: '#dc2626',
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  MAJOR: '#f97316',
  MINOR: '#f59e0b',
  WARNING: '#eab308',
};

function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-surface rounded-lg border border-th-default shadow-sm p-6 animate-pulse ${className}`}>
      <div className="h-4 bg-panel rounded w-1/3 mb-4" />
      <div className="h-8 bg-panel rounded w-1/2" />
    </div>
  );
}


export default function AnalyticsPage() {
  const [fleet, setFleet] = useState<FleetOverview | null>(null);
  const [alerts, setAlerts] = useState<AlertTrends | null>(null);
  const [uptime, setUptime] = useState<DeviceUptime | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(30); // days
  const [refreshKey, setRefreshKey] = useState(0);

  const loadAnalytics = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    setLoading(true);
    setError(null);

    // Convert days to hours for telemetry, capped at 168h (7d — API max)
    const telemetryHours = Math.min(timeRange * 24, 168);
    // Uptime endpoint accepts max 30 days
    const uptimeDays = Math.min(timeRange, 30);

    try {
      const [fleetRes, alertsRes, uptimeRes, telemetryRes] = await Promise.all([
        fetch(`/api/v1/tenants/${tenant}/analytics/fleet-overview`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/tenants/${tenant}/analytics/alert-trends?days=${timeRange}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/tenants/${tenant}/analytics/device-uptime?days=${uptimeDays}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/tenants/${tenant}/analytics/telemetry-summary?hours=${telemetryHours}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (fleetRes.ok) setFleet((await fleetRes.json()).data);
      if (alertsRes.ok) setAlerts((await alertsRes.json()).data);
      if (uptimeRes.ok) setUptime((await uptimeRes.json()).data);
      if (telemetryRes.ok) setTelemetry((await telemetryRes.json()).data);

      if (!fleetRes.ok && !alertsRes.ok) {
        setError('Failed to load analytics data. Check your connection.');
      }
    } catch {
      setError('Failed to load analytics. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [timeRange, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const deviceTypeData = fleet
    ? Object.entries(fleet.device_type_distribution)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name: name || 'Unknown', value }))
    : [];

  const statusData = fleet
    ? Object.entries(fleet.status_distribution)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
    : [];

  const severityData = alerts
    ? Object.entries(alerts.severity_distribution).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <PageShell
      title="Analytics"
      subtitle="Fleet health and operational insights"
      action={
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="p-2 border border-[var(--color-input-border)] rounded-lg hover:bg-panel transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-th-secondary ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex items-center gap-2 bg-surface border border-th-default rounded-lg px-3 py-2">
            <Calendar className="w-4 h-4 text-th-muted" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(Number(e.target.value))}
              className="text-sm font-medium text-th-primary bg-transparent focus:outline-none"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>
      }
    >

        {error && <ErrorBanner message={error} />}

        {/* Fleet Overview KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {loading && !fleet ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : fleet ? (
            <>
              <div className="bg-surface rounded-xl border border-th-default shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-th-secondary font-medium">Total Devices</p>
                  <div className="w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center">
                    <Cpu className="w-5 h-5 text-primary-600" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-th-primary">{fleet.total_devices}</p>
                <p className="text-xs text-th-muted mt-1">{deviceTypeData.length} device types</p>
              </div>

              <div className="bg-surface rounded-xl border border-th-default shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-th-secondary font-medium">Online Now</p>
                  <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-green-600">{fleet.status_distribution.online || 0}</p>
                <p className="text-xs text-th-muted mt-1">
                  {fleet.total_devices > 0
                    ? `${Math.round(((fleet.status_distribution.online || 0) / fleet.total_devices) * 100)}% of fleet`
                    : '—'}
                </p>
              </div>

              <div className="bg-surface rounded-xl border border-th-default shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-th-secondary font-medium">Offline</p>
                  <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-600" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-red-600">{fleet.status_distribution.offline || 0}</p>
                <p className="text-xs text-th-muted mt-1">
                  {fleet.status_distribution.idle ? `${fleet.status_distribution.idle} idle` : 'None idle'}
                </p>
              </div>

              <div className="bg-surface rounded-xl border border-th-default shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-th-secondary font-medium">Avg Battery</p>
                  <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
                    <Battery className="w-5 h-5 text-amber-600" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-th-primary">{fleet.average_battery_level.toFixed(0)}%</p>
                <p className="text-xs text-red-500 mt-1">{fleet.low_battery_devices} below 20%</p>
              </div>
            </>
          ) : null}
        </div>

        {/* Uptime + Telemetry Activity Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Uptime */}
          <div className="bg-surface rounded-lg border border-th-default shadow-sm p-6">
            <h3 className="text-sm font-semibold text-th-primary mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary-600" />
              Device Availability ({Math.min(timeRange, 30)}d)
            </h3>
            {loading && !uptime ? (
              <div className="space-y-4 animate-pulse">
                <div className="h-4 bg-panel rounded w-full" />
                <div className="h-4 bg-panel rounded w-full" />
              </div>
            ) : uptime ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-th-secondary">Online now</span>
                    <span className="font-semibold text-th-primary">{uptime.uptime_percentage}%</span>
                  </div>
                  <div className="w-full bg-panel rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full transition-all"
                      style={{ width: `${uptime.uptime_percentage}%`, backgroundColor: uptime.uptime_percentage >= 80 ? '#10b981' : uptime.uptime_percentage >= 50 ? '#f59e0b' : '#ef4444' }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-th-secondary">Active in period</span>
                    <span className="font-semibold text-th-primary">{uptime.availability_percentage}%</span>
                  </div>
                  <div className="w-full bg-panel rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full bg-primary-500 transition-all"
                      style={{ width: `${uptime.availability_percentage}%` }}
                    />
                  </div>
                </div>
                <div className="pt-2 grid grid-cols-3 gap-2 text-center text-xs text-th-secondary border-t border-th-subtle">
                  <div><span className="block text-base font-bold text-th-primary">{uptime.total_devices}</span>Total</div>
                  <div><span className="block text-base font-bold text-green-600">{uptime.online_now}</span>Online</div>
                  <div><span className="block text-base font-bold text-primary-600">{uptime.active_in_period}</span>Active</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-th-muted">No uptime data</p>
            )}
          </div>

          {/* Telemetry Activity */}
          <div className="bg-surface rounded-lg border border-th-default shadow-sm p-6">
            <h3 className="text-sm font-semibold text-th-primary mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary-600" />
              Telemetry Activity ({Math.min(timeRange * 24, 168)}h)
            </h3>
            {loading && !telemetry ? (
              <div className="space-y-3 animate-pulse">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 bg-panel rounded" />
                ))}
              </div>
            ) : telemetry ? (
              <div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-3xl font-bold text-th-primary">{telemetry.message_count.toLocaleString()}</span>
                  <span className="text-sm text-th-secondary">messages</span>
                  <span className="ml-auto text-sm text-th-secondary">{telemetry.active_devices} active devices</span>
                </div>
                {telemetry.top_metrics.length > 0 ? (
                  <div className="space-y-2">
                    {telemetry.top_metrics.slice(0, 5).map(m => (
                      <div key={m.key} className="flex items-center gap-3">
                        <span className="text-xs text-th-secondary w-28 truncate capitalize">{m.key.replace(/_/g, ' ')}</span>
                        <div className="flex-1 bg-panel rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-primary-500"
                            style={{ width: `${Math.min((m.count / (telemetry.top_metrics[0]?.count || 1)) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-th-primary w-16 text-right">avg {m.avg.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-th-muted">No telemetry data in this period</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-th-muted">No telemetry data</p>
            )}
          </div>
        </div>

        {/* Charts Row: Alert Trend + Status Pie */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Daily Alert Trend */}
          <div className="bg-surface rounded-lg border border-th-default shadow-sm p-6">
            <h3 className="text-sm font-semibold text-th-primary mb-1 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary-600" />
              Alert Trend
            </h3>
            <p className="text-xs text-th-muted mb-4">Daily alarm count — last {timeRange} days</p>
            {loading && !alerts ? (
              <div className="h-56 bg-panel rounded animate-pulse" />
            ) : alerts && alerts.daily_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={alerts.daily_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    labelFormatter={(val) => new Date(val).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    formatter={(v: number) => [v, 'Alarms']}
                  />
                  <Line type="monotone" dataKey="count" stroke="#0066CC" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-56 flex flex-col items-center justify-center text-th-muted">
                <BarChart3 className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No alarms in this period</p>
              </div>
            )}
            {alerts && (
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-th-subtle text-xs text-th-secondary">
                <span className="font-semibold text-th-primary text-base">{alerts.total_alarms}</span> total alarms
                {Object.entries(alerts.severity_distribution).map(([sev, count]) => (
                  <span key={sev} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[sev] || '#94a3b8' }} />
                    {count} {sev.toLowerCase()}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Device Status Distribution */}
          <div className="bg-surface rounded-lg border border-th-default shadow-sm p-6">
            <h3 className="text-sm font-semibold text-th-primary mb-1">Device Status</h3>
            <p className="text-xs text-th-muted mb-4">Current fleet status breakdown</p>
            {loading && !fleet ? (
              <div className="h-56 bg-panel rounded animate-pulse" />
            ) : statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name.toLowerCase()] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-56 flex flex-col items-center justify-center text-th-muted">
                <Cpu className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No device data</p>
              </div>
            )}
          </div>
        </div>

        {/* Severity Breakdown + Device Type Distribution */}
        {(severityData.length > 0 || deviceTypeData.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {severityData.length > 0 && (
              <div className="bg-surface rounded-lg border border-th-default shadow-sm p-6">
                <h3 className="text-sm font-semibold text-th-primary mb-1 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Alarm Severity Breakdown
                </h3>
                <p className="text-xs text-th-muted mb-4">Last {timeRange} days</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={severityData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} width={70} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {severityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={SEVERITY_COLORS[entry.name] || '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {deviceTypeData.length > 0 && (
              <div className="bg-surface rounded-lg border border-th-default shadow-sm p-6">
                <h3 className="text-sm font-semibold text-th-primary mb-1">Device Type Distribution</h3>
                <p className="text-xs text-th-muted mb-4">Fleet composition</p>
                <div className="space-y-3">
                  {deviceTypeData.map(({ name, value }) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-xs text-th-secondary w-36 truncate">{name}</span>
                      <div className="flex-1 bg-panel rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-primary-500"
                          style={{ width: `${(value / (fleet?.total_devices || 1)) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-th-primary w-6 text-right">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Top Alerting Devices */}
        {alerts && alerts.top_alerting_devices.length > 0 && (
          <div className="bg-surface rounded-xl border border-th-default shadow-sm overflow-hidden">
            <div className="border-b border-th-subtle px-6 py-4">
              <h3 className="text-sm font-semibold text-th-primary flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Top Alerting Devices
                <span className="ml-1 text-xs text-th-muted font-normal">— last {timeRange} days</span>
              </h3>
            </div>
            <div className="divide-y divide-[var(--color-border-subtle)]">
              {alerts.top_alerting_devices.map((device, idx) => (
                <div key={device.device_id} className="px-6 py-3 flex items-center justify-between hover:bg-panel transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-300 w-5">#{idx + 1}</span>
                    <span className="text-sm font-medium text-th-primary">{device.device_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1.5 rounded-full bg-amber-400"
                      style={{ width: `${Math.max((device.alarm_count / (alerts.top_alerting_devices[0]?.alarm_count || 1)) * 80, 8)}px` }}
                    />
                    <span className="text-sm font-semibold text-amber-600">{device.alarm_count}</span>
                    <span className="text-xs text-th-muted">alarms</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
    </PageShell>
  );
}