'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
        const response = await fetch(`/api/tenants/${tenant}/devices`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to load devices');
        }

        setDevices(data.data || []);
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gito-dark">Dashboard</h1>
              <p className="text-gray-600 mt-1">IoT Device Monitoring</p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('auth_token');
                router.push('/auth/login');
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <p className="text-gray-600 text-sm font-medium">Total Devices</p>
            <p className="text-3xl font-bold text-gito-dark mt-2">{devices.length}</p>
          </div>
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <p className="text-gray-600 text-sm font-medium">Online</p>
            <p className="text-3xl font-bold text-green-600 mt-2">
              {devices.filter((d) => d.status === 'online').length}
            </p>
          </div>
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <p className="text-gray-600 text-sm font-medium">Offline</p>
            <p className="text-3xl font-bold text-red-600 mt-2">
              {devices.filter((d) => d.status === 'offline').length}
            </p>
          </div>
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <p className="text-gray-600 text-sm font-medium">Idle</p>
            <p className="text-3xl font-bold text-yellow-600 mt-2">
              {devices.filter((d) => d.status === 'idle').length}
            </p>
          </div>
        </div>

        {/* Devices Table */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gito-dark">Devices</h2>
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
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Last Seen
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                      Battery
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {devices.map((device) => (
                    <tr key={device.id} className="hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-6 py-4 text-sm font-medium text-gito-dark">
                        <Link href={`/dashboard/devices/${device.id}`} className="hover:text-primary-600">
                          {device.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{device.device_type}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                            device.status
                          )}`}
                        >
                          {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {device.last_seen
                          ? new Date(device.last_seen).toLocaleString()
                          : 'Never'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {device.battery_level !== null ? `${device.battery_level}%` : '-'}
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
