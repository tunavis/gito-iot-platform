'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  TrendingUp,
  Activity,
  AlertTriangle,
  Cpu,
  Battery,
  CheckCircle2,
  XCircle,
  Calendar,
  BarChart3
} from 'lucide-react';
import { LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

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
  top_alerting_devices: Array<{ device_id: string; alarm_count: number }>;
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
  avg_temperature: number | null;
  avg_humidity: number | null;
  avg_battery: number | null;
  avg_signal_strength: number | null;
  active_devices: number;
}

export default function AnalyticsPage() {
  const [fleet, setFleet] = useState<FleetOverview | null>(null);
  const [alerts, setAlerts] = useState<AlertTrends | null>(null);
  const [uptime, setUptime] = useState<DeviceUptime | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(30); // days

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

    setLoading(true);

    try {
      const [fleetRes, alertsRes, uptimeRes, telemetryRes] = await Promise.all([
        fetch(`/api/v1/tenants/${tenant}/analytics/fleet-overview`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`/api/v1/tenants/${tenant}/analytics/alert-trends?days=${timeRange}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`/api/v1/tenants/${tenant}/analytics/device-uptime?days=7`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`/api/v1/tenants/${tenant}/analytics/telemetry-summary?hours=24`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (fleetRes.ok) {
        const json = await fleetRes.json();
        setFleet(json.data);
      }

      if (alertsRes.ok) {
        const json = await alertsRes.json();
        setAlerts(json.data);
      }

      if (uptimeRes.ok) {
        const json = await uptimeRes.json();
        setUptime(json.data);
      }

      if (telemetryRes.ok) {
        const json = await telemetryRes.json();
        setTelemetry(json.data);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    online: '#10b981',
    offline: '#ef4444',
    idle: '#f59e0b',
    error: '#dc2626'
  };

  const SEVERITY_COLORS: Record<string, string> = {
    CRITICAL: '#dc2626',
    MAJOR: '#f97316',
    MINOR: '#eab308',
    WARNING: '#3b82f6'
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Analytics Dashboard</h1>
              <p className="text-gray-600 mt-2">Fleet health metrics and operational insights</p>
            </div>
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-gray-400" />
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(Number(e.target.value))}
                className="px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
          </div>

          {/* Fleet Overview Cards */}
          {fleet && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6">
              <div className="bg-white rounded-lg p-6 border border-primary-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Total Devices</p>
                    <p className="text-3xl font-bold text-slate-900">{fleet.total_devices}</p>
                  </div>
                  <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
                    <Cpu className="w-6 h-6 text-primary-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Online</p>
                    <p className="text-3xl font-bold text-green-600">{fleet.status_distribution.online || 0}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 border border-red-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Offline</p>
                    <p className="text-3xl font-bold text-red-600">{fleet.status_distribution.offline || 0}</p>
                  </div>
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                    <XCircle className="w-6 h-6 text-red-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg p-6 border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-sm font-medium mb-1">Avg Battery</p>
                    <p className="text-3xl font-bold text-blue-600">{fleet.average_battery_level.toFixed(0)}%</p>
                    <p className="text-xs text-gray-500 mt-1">{fleet.low_battery_devices} low battery</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Battery className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Uptime & Telemetry Row */}
        {uptime && telemetry && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary-600" />
                Device Uptime (7 days)
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Uptime</span>
                    <span className="font-semibold text-gray-900">{uptime.uptime_percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-green-500 h-3 rounded-full transition-all"
                      style={{ width: `${uptime.uptime_percentage}%` }}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Availability</span>
                    <span className="font-semibold text-gray-900">{uptime.availability_percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-blue-500 h-3 rounded-full transition-all"
                      style={{ width: `${uptime.availability_percentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary-600" />
                Telemetry (24 hours)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Messages</p>
                  <p className="text-2xl font-bold text-gray-900">{telemetry.message_count.toLocaleString()}</p>
                </div>
                {telemetry.avg_temperature && (
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Avg Temp</p>
                    <p className="text-2xl font-bold text-gray-900">{telemetry.avg_temperature}°C</p>
                  </div>
                )}
                {telemetry.avg_humidity && (
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Avg Humidity</p>
                    <p className="text-2xl font-bold text-gray-900">{telemetry.avg_humidity}%</p>
                  </div>
                )}
                {telemetry.avg_signal_strength && (
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Avg RSSI</p>
                    <p className="text-2xl font-bold text-gray-900">{telemetry.avg_signal_strength} dBm</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Alert Trends & Device Status */}
        {alerts && fleet && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Daily Alert Trend */}
            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary-600" />
                Alert Trend
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={alerts.daily_trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#0066CC" strokeWidth={2} name="Alerts" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Device Status Distribution */}
            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Device Status Distribution</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={Object.entries(fleet.status_distribution).map(([name, value]) => ({
                      name: name.charAt(0).toUpperCase() + name.slice(1),
                      value
                    }))}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {Object.keys(fleet.status_distribution).map((key, index) => (
                      <Cell key={`cell-${index}`} fill={STATUS_COLORS[key] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top Alerting Devices */}
        {alerts && alerts.top_alerting_devices.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="border-b border-gray-200 px-6 py-3 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                Top Alerting Devices
              </h3>
            </div>
            <div className="divide-y divide-gray-200">
              {alerts.top_alerting_devices.map((device, idx) => (
                <div key={device.device_id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-500">#{idx + 1}</span>
                    <span className="text-sm text-gray-700 font-mono">{device.device_id.substring(0, 8)}...</span>
                  </div>
                  <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
                    {device.alarm_count} alerts
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
