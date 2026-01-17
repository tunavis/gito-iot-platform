'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import TelemetryChart from '@/components/TelemetryChart';

interface Device {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: 'online' | 'offline' | 'idle' | 'error';
  last_seen: string | null;
  battery_level: number | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface DashboardStats {
  devices: {
    total: number;
    online: number;
    offline: number;
    idle: number;
  };
  messages: {
    total_24h: number;
    rate_per_minute: number;
  };
  alerts: {
    active: number;
    critical: number;
  };
  health: {
    uptime: number;
    avgLatency: number;
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [messagesData, setMessagesData] = useState<Array<{time: string; value: number}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
          router.push('/auth/login');
          return;
        }

        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;

        // Fetch devices
        const response = await fetch(`/api/v1/tenants/${tenant}/devices`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to load devices');
        }

        const deviceList = data.data || [];
        setDevices(deviceList);

        // Calculate stats
        const deviceStats = {
          total: deviceList.length,
          online: deviceList.filter((d: Device) => d.status === 'online').length,
          offline: deviceList.filter((d: Device) => d.status === 'offline').length,
          idle: deviceList.filter((d: Device) => d.status === 'idle').length,
        };

        setStats({
          devices: deviceStats,
          messages: {
            total_24h: 15420,
            rate_per_minute: 124
          },
          alerts: {
            active: 3,
            critical: 1
          },
          health: {
            uptime: 99.8,
            avgLatency: 45
          }
        });

        // Generate sample time-series data
        const hours = Array.from({length: 24}, (_, i) => i);
        setMessagesData(hours.map(h => ({
          time: `${h}:00`,
          value: Math.floor(Math.random() * 1000) + 500
        })));

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
        <Sidebar />
        <main className="flex-1 ml-64 p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin mb-4">
              <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
            </div>
            <p className="text-slate-600 font-medium">Loading dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  const healthColor = stats?.health.uptime && stats.health.uptime >= 99.5 ? 'emerald' : stats?.health.uptime && stats.health.uptime >= 95 ? 'yellow' : 'red';

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <Sidebar />
      
      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 bg-clip-text text-transparent">
                IoT Platform Overview
              </h1>
              <p className="text-slate-600 mt-2 text-lg">Real-time monitoring and management</p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('auth_token');
                document.cookie = 'auth_token=; path=/; max-age=0';
                window.location.href = '/auth/login';
              }}
              className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-xl hover:bg-white hover:shadow-lg transition-all"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Executive KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Devices Card */}
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-slate-200 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-full blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg">
                  <span className="text-2xl">📱</span>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Devices</p>
                  <p className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent mt-1">
                    {stats?.devices.total || 0}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">
                  {stats?.devices.online || 0} Active
                </span>
                <Link href="/dashboard/devices" className="text-xs text-slate-500 hover:text-blue-600 transition-colors ml-auto">
                  View all →
                </Link>
              </div>
            </div>
          </div>

          {/* Online Devices Card */}
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-green-200 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/10 to-green-500/10 rounded-full blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl flex items-center justify-center shadow-lg">
                  <span className="w-4 h-4 bg-white rounded-full animate-pulse"></span>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Online Now</p>
                  <p className="text-4xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent mt-1">
                    {stats?.devices.online || 0}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-green-500 rounded-full transition-all"
                    style={{width: `${stats?.devices.total ? (stats.devices.online / stats.devices.total * 100) : 0}%`}}
                  ></div>
                </div>
                <span className="text-xs font-medium text-emerald-600">
                  {stats?.devices.total ? Math.round(stats.devices.online / stats.devices.total * 100) : 0}%
                </span>
              </div>
            </div>
          </div>

          {/* Messages Card */}
          <div className="group relative bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-purple-200 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-full blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                  <span className="text-2xl">📡</span>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Messages (24h)</p>
                  <p className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mt-1">
                    {(stats?.messages.total_24h || 0) > 1000 ? `${Math.floor((stats?.messages.total_24h || 0) / 1000)}k` : stats?.messages.total_24h || 0}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <span className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded-full font-medium">
                  {stats?.messages.rate_per_minute || 0}/min
                </span>
                <span className="text-xs text-slate-500 ml-auto">Live</span>
              </div>
            </div>
          </div>

          {/* System Health Card */}
          <div className={`group relative bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-${healthColor}-200 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden`}>
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-${healthColor}-500/10 to-${healthColor}-500/10 rounded-full blur-3xl`}></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-14 h-14 bg-gradient-to-br from-${healthColor}-500 to-${healthColor}-600 rounded-xl flex items-center justify-center shadow-lg`}>
                  <span className="text-2xl">💚</span>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">System Health</p>
                  <p className={`text-4xl font-bold bg-gradient-to-r from-${healthColor}-600 to-${healthColor}-700 bg-clip-text text-transparent mt-1`}>
                    {stats?.health.uptime || 0}%
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <span className={`text-xs px-2 py-1 bg-${healthColor}-50 text-${healthColor}-700 rounded-full font-medium`}>
                  {stats?.health.avgLatency || 0}ms avg
                </span>
                <span className="text-xs text-slate-500 ml-auto">Uptime</span>
              </div>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Main Chart */}
          <div className="lg:col-span-2">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200 shadow-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Message Throughput</h3>
                  <p className="text-sm text-slate-500 mt-1">Last 24 hours</p>
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg">24h</button>
                  <button className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg">7d</button>
                  <button className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg">30d</button>
                </div>
              </div>
              <TelemetryChart
                title=""
                data={messagesData}
                color="#3b82f6"
                unit="msg"
                type="area"
              />
            </div>
          </div>

          {/* Alerts Panel */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200 shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900">Active Alerts</h3>
              <Link href="/dashboard/alerts" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View all →
              </Link>
            </div>
            <div className="space-y-3">
              {[
                { level: 'critical', device: 'Sensor-A1', message: 'Battery critically low', time: '2m ago' },
                { level: 'warning', device: 'Gateway-B2', message: 'High latency detected', time: '15m ago' },
                { level: 'info', device: 'Device-C3', message: 'Firmware update available', time: '1h ago' }
              ].map((alert, i) => (
                <div key={i} className={`p-4 rounded-xl border-l-4 ${
                  alert.level === 'critical' ? 'bg-red-50 border-red-500' :
                  alert.level === 'warning' ? 'bg-yellow-50 border-yellow-500' :
                  'bg-blue-50 border-blue-500'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">{alert.device}</p>
                      <p className="text-xs text-slate-600 mt-1">{alert.message}</p>
                    </div>
                    <span className="text-xs text-slate-500">{alert.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Devices */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-transparent">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Recent Devices</h2>
              <p className="text-sm text-slate-500 mt-1">Latest activity from your devices</p>
            </div>
            <Link 
              href="/dashboard/devices"
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl hover:from-blue-700 hover:to-cyan-700 transition-all shadow-md hover:shadow-lg font-medium"
            >
              View All Devices
            </Link>
          </div>

          {error ? (
            <div className="p-8 text-center">
              <p className="text-red-600">{error}</p>
            </div>
          ) : devices.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">📱</span>
              </div>
              <p className="text-slate-600 mb-4">No devices found</p>
              <Link href="/dashboard/devices/new" className="text-blue-600 hover:text-blue-700 font-medium">
                Add your first device →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Device</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Battery</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Last Seen</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {devices.slice(0, 5).map((device) => (
                    <tr key={device.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/devices/${device.id}`} className="flex items-center gap-3 group">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center text-white font-bold shadow-md">
                            {device.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                              {device.name}
                            </p>
                            <p className="text-xs text-slate-500">{device.id.substring(0, 8)}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                          {device.device_type}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${
                          device.status === 'online' ? 'text-green-700 bg-green-50 border border-green-200' :
                          device.status === 'offline' ? 'text-red-700 bg-red-50 border border-red-200' :
                          'text-yellow-700 bg-yellow-50 border border-yellow-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            device.status === 'online' ? 'bg-green-500 animate-pulse' : 
                            device.status === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
                          }`}></span>
                          {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {device.battery_level !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 max-w-[80px] bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all ${
                                  device.battery_level > 50 ? 'bg-green-500' :
                                  device.battery_level > 20 ? 'bg-yellow-500' : 'bg-red-500'
                                }`}
                                style={{width: `${device.battery_level}%`}}
                              ></div>
                            </div>
                            <span className={`text-xs font-medium ${
                              device.battery_level > 50 ? 'text-green-600' :
                              device.battery_level > 20 ? 'text-yellow-600' : 'text-red-600'
                            }`}>
                              {Math.round(device.battery_level)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {device.last_seen 
                          ? new Date(device.last_seen).toLocaleString()
                          : <span className="text-slate-400">Never</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/dashboard/devices/${device.id}`}
                          className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
