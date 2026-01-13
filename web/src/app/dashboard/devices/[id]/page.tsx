'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useDeviceWebSocket } from '@/hooks/useDeviceWebSocket';

interface Device {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: 'online' | 'offline' | 'idle' | 'error';
  last_seen: string | null;
  battery_level: number | null;
  signal_strength: number | null;
  attributes: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface TelemetryData {
  id: string;
  device_id: string;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  battery?: number;
  rssi?: number;
  payload: Record<string, any>;
  timestamp: string;
  created_at: string;
}

interface AlertRule {
  id: string;
  metric: string;
  operator: string;
  threshold: number;
  cooldown_minutes: number;
  active: boolean;
  last_fired_at: string | null;
}

export default function DeviceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deviceId = params.id as string;

  const [device, setDevice] = useState<Device | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<any[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

  // WebSocket hook for real-time updates
  const { isConnected } = useDeviceWebSocket({
    deviceId: deviceId || '',
    token: token || '',
    onTelemetry: (data) => {
      setTelemetry({
        ...data,
        id: Date.now().toString(),
      } as TelemetryData);

      // Add to history (keep last 100 records)
      setTelemetryHistory((prev) => [
        ...prev,
        {
          timestamp: new Date(data.timestamp).toLocaleTimeString(),
          ...data.payload,
        },
      ].slice(-100));
    },
    onAlert: (data) => {
      setRecentAlerts((prev) =>
        [
          {
            id: Date.now(),
            metric: data.metric,
            value: data.value,
            message: data.message,
            timestamp: new Date(data.timestamp).toLocaleTimeString(),
          },
          ...prev,
        ].slice(0, 10)
      );
    },
    onError: (err) => setWsError(err),
    onConnectionChange: setWsConnected,
  });

  useEffect(() => {
    const loadDeviceDetails = async () => {
      try {
        if (!token) {
          router.push('/auth/login');
          return;
        }

        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;

        // Fetch device details
        const deviceRes = await fetch(`/api/tenants/${tenant}/devices/${deviceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!deviceRes.ok) {
          throw new Error('Failed to load device');
        }

        const deviceData = await deviceRes.json();
        setDevice(deviceData.data);

        // Fetch latest telemetry
        try {
          const telemetryRes = await fetch(
            `/api/tenants/${tenant}/devices/${deviceId}/telemetry/latest`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (telemetryRes.ok) {
            const telemetryData = await telemetryRes.json();
            setTelemetry(telemetryData.data);
          }
        } catch (err) {
          console.log('Telemetry not available');
        }

        // Fetch alert rules
        try {
          const rulesRes = await fetch(
            `/api/tenants/${tenant}/alert-rules?device_id=${deviceId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (rulesRes.ok) {
            const rulesData = await rulesRes.json();
            setAlertRules(rulesData.data || []);
          }
        } catch (err) {
          console.log('Alert rules not available');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load device details');
      } finally {
        setLoading(false);
      }
    };

    loadDeviceDetails();
  }, [deviceId, router, token]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'offline':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'idle':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
          </div>
          <p className="text-gray-600">Loading device details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard" className="text-primary-600 hover:text-primary-700 font-medium mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mt-4">
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard" className="text-primary-600 hover:text-primary-700 font-medium mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <p className="text-gray-600 mt-8">Device not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <Link href="/dashboard" className="text-primary-600 hover:text-primary-700 font-medium mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gito-dark">{device.name}</h1>
              <p className="text-gray-600 mt-1">{device.device_type}</p>
            </div>
            <div className={`inline-block px-4 py-2 rounded-lg border ${getStatusColor(device.status)}`}>
              <span className="font-semibold">
                {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Left Column - Details (3 cols) */}
          <div className="lg:col-span-3">
            {/* Device Info */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-gito-dark mb-4">Device Information</h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-gray-600">Device ID</p>
                  <p className="font-mono text-sm text-gray-900 mt-1">{device.id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Device Type</p>
                  <p className="text-sm text-gray-900 mt-1">{device.device_type}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Created</p>
                  <p className="text-sm text-gray-900 mt-1">{new Date(device.created_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Last Updated</p>
                  <p className="text-sm text-gray-900 mt-1">{new Date(device.updated_at).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Last Seen</p>
                  <p className="text-sm text-gray-900 mt-1">
                    {device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}
                  </p>
                </div>
                {device.signal_strength !== null && (
                  <div>
                    <p className="text-sm text-gray-600">Signal Strength</p>
                    <p className="text-sm text-gray-900 mt-1">{device.signal_strength} dBm</p>
                  </div>
                )}
              </div>
            </div>

            {/* Real-time Status */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gito-dark">Real-Time Status</h2>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                  <span className="text-sm font-medium text-gray-600">
                    {wsConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
              {wsError && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                  <p className="text-sm text-yellow-800">{wsError}</p>
                </div>
              )}
            </div>

            {/* Latest Telemetry */}
            {telemetry && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gito-dark mb-4">Latest Telemetry</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {telemetry.temperature !== undefined && (
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                      <p className="text-sm text-gray-600">Temperature</p>
                      <p className="text-2xl font-bold text-blue-600 mt-1">{telemetry.temperature.toFixed(1)}°C</p>
                    </div>
                  )}
                  {telemetry.humidity !== undefined && (
                    <div className="bg-cyan-50 rounded-lg p-4 border border-cyan-200">
                      <p className="text-sm text-gray-600">Humidity</p>
                      <p className="text-2xl font-bold text-cyan-600 mt-1">{telemetry.humidity.toFixed(1)}%</p>
                    </div>
                  )}
                  {telemetry.pressure !== undefined && (
                    <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                      <p className="text-sm text-gray-600">Pressure</p>
                      <p className="text-2xl font-bold text-purple-600 mt-1">{telemetry.pressure.toFixed(0)} hPa</p>
                    </div>
                  )}
                  {telemetry.battery !== undefined && (
                    <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                      <p className="text-sm text-gray-600">Battery</p>
                      <p className="text-2xl font-bold text-green-600 mt-1">{telemetry.battery.toFixed(1)}V</p>
                    </div>
                  )}
                  {telemetry.rssi !== undefined && (
                    <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                      <p className="text-sm text-gray-600">RSSI</p>
                      <p className="text-2xl font-bold text-orange-600 mt-1">{telemetry.rssi} dBm</p>
                    </div>
                  )}
                  {device.battery_level !== null && (
                    <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                      <p className="text-sm text-gray-600">Battery Level</p>
                      <p className="text-2xl font-bold text-yellow-600 mt-1">{device.battery_level.toFixed(0)}%</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-4">
                  Last recorded: {new Date(telemetry.timestamp).toLocaleString()}
                </p>
              </div>
            )}

            {/* Telemetry History Chart */}
            {telemetryHistory.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gito-dark mb-4">Telemetry History</h2>
                <div className="w-full h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={telemetryHistory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="timestamp" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {telemetryHistory[0]?.temperature !== undefined && (
                        <Line type="monotone" dataKey="temperature" stroke="#3B82F6" dot={false} isAnimationActive={false} />
                      )}
                      {telemetryHistory[0]?.humidity !== undefined && (
                        <Line type="monotone" dataKey="humidity" stroke="#06B6D4" dot={false} isAnimationActive={false} />
                      )}
                      {telemetryHistory[0]?.pressure !== undefined && (
                        <Line type="monotone" dataKey="pressure" stroke="#A855F7" dot={false} isAnimationActive={false} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Alerts (1 col) */}
          <div className="lg:col-span-1 space-y-6">
            {/* Recent Alerts */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gito-dark mb-4">Recent Alerts</h2>
              {recentAlerts.length === 0 ? (
                <p className="text-gray-600 text-sm">No recent alerts</p>
              ) : (
                <div className="space-y-2">
                  {recentAlerts.map((alert) => (
                    <div key={alert.id} className="bg-red-50 border border-red-200 rounded p-3">
                      <p className="text-sm font-semibold text-red-800">{alert.metric}</p>
                      <p className="text-xs text-red-700 mt-1">{alert.message}</p>
                      <p className="text-xs text-gray-500 mt-1">{alert.timestamp}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Alert Rules */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gito-dark mb-4">Alert Rules</h2>

              {alertRules.length === 0 ? (
                <p className="text-gray-600 text-sm">No alert rules configured</p>
              ) : (
                <div className="space-y-4">
                  {alertRules.map((rule) => (
                    <div
                      key={rule.id}
                      className={`border rounded-lg p-4 ${
                        rule.active ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50 opacity-50'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-semibold text-sm text-gray-900">{rule.metric}</p>
                        <span className={`inline-block px-2 py-1 text-xs rounded font-semibold ${
                            rule.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                          {rule.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        Trigger: value {rule.operator} {rule.threshold}
                      </p>
                      <p className="text-xs text-gray-500">
                        Cooldown: {rule.cooldown_minutes} min
                      </p>
                      {rule.last_fired_at && (
                        <p className="text-xs text-gray-500 mt-1">
                          Last fired: {new Date(rule.last_fired_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
