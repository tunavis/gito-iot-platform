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

export default function DashboardPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [messagesData, setMessagesData] = useState<Array<{time: string; value: number}>>([]);
  const [batteryData, setBatteryData] = useState<Array<{time: string; value: number}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        // Validate auth
        const token = localStorage.getItem('auth_token');
        if (!token) {
          router.push('/auth/login');
          return;
        }

        // Get tenant_id from token
        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;

        // Fetch devices
        const response = await fetch(`/api/v1/tenants/${tenant}/devices`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to load devices');
        }

        setDevices(data.data || []);

        // Fetch telemetry data
        const [messagesRes, batteryRes] = await Promise.all([
          fetch(`/api/v1/tenants/${tenant}/telemetry/hourly?metric=messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(`/api/v1/tenants/${tenant}/telemetry/hourly?metric=battery`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);

        if (messagesRes.ok) {
          const messagesJson = await messagesRes.json();
          setMessagesData(messagesJson.data || []);
        }
        if (batteryRes.ok) {
          const batteryJson = await batteryRes.json();
          setBatteryData(batteryJson.data || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, [router]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'text-green-600 bg-green-50';
      case 'offline':
        return 'text-red-600 bg-red-50';
      case 'idle':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-1 ml-64 p-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
              <p className="text-slate-600 mt-1">Real-time IoT device monitoring</p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('auth_token');
                document.cookie = 'auth_token=; path=/; max-age=0';
                window.location.href = '/auth/login';
              }}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
            >
              Logout
            </button>
          </div>
        </div>
        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Total Devices</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">{devices.length}</p>
              </div>
              <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-2xl">📱</div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Online</p>
                <p className="text-3xl font-bold text-green-600 mt-2">
                  {devices.filter((d) => d.status === 'online').length}
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-red-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Offline</p>
                <p className="text-3xl font-bold text-red-600 mt-2">
                  {devices.filter((d) => d.status === 'offline').length}
                </p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center text-2xl">⚠️</div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-6 border border-yellow-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium">Idle</p>
                <p className="text-3xl font-bold text-yellow-600 mt-2">
                  {devices.filter((d) => d.status === 'idle').length}
                </p>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center text-2xl">💤</div>
            </div>
          </div>
        </div>

        {/* Telemetry Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <TelemetryChart
            title="Messages Received (Last 24h)"
            data={messagesData}
            color="#0ea5e9"
            unit="messages"
            type="area"
          />
          <TelemetryChart
            title="Average Battery Level"
            data={batteryData}
            color="#10b981"
            unit="%"
            type="line"
          />
        </div>

        {/* Devices Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">Devices</h2>
            <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium">
              + Add Device
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center">
              <div className="inline-block animate-spin">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
              </div>
              <p className="text-gray-600 mt-2">Loading devices...</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-red-600">{error}</p>
            </div>
          ) : devices.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">No devices found. Create one to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Device
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Last Seen
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Battery
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {devices.map((device) => (
                    <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/devices/${device.id}`} className="flex items-center gap-3 group">
                          <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-accent-600 rounded-lg flex items-center justify-center text-white font-bold">
                            {device.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900 group-hover:text-primary-600 transition-colors">
                              {device.name}
                            </p>
                            <p className="text-xs text-slate-500">{device.id.substring(0, 8)}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                          {device.device_type}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${
                            getStatusColor(device.status)
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            device.status === 'online' ? 'bg-green-600 animate-pulse' : 
                            device.status === 'offline' ? 'bg-red-600' : 'bg-yellow-600'
                          }`}></span>
                          {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {device.last_seen
                          ? new Date(device.last_seen).toLocaleString()
                          : <span className="text-slate-400">Never</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {device.battery_level !== null ? (
                          <span className={`font-medium ${
                            device.battery_level > 50 ? 'text-green-600' :
                            device.battery_level > 20 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {device.battery_level}%
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/dashboard/devices/${device.id}`}
                          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
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
