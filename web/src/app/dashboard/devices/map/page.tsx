'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import {
  MapPin,
  Filter,
  Search,
  RefreshCw,
  Layers,
  Maximize2,
  Download,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle
} from 'lucide-react';

// Dynamically import map components to avoid SSR issues
const MapView = dynamic(() => import('@/components/DeviceMapView'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="inline-block animate-spin mb-4">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
        </div>
        <p className="text-gray-600 font-medium">Loading map...</p>
      </div>
    </div>
  )
});

interface DeviceType {
  id: string;
  name: string;
  category: string;
  icon: string;
  color: string;
}

interface Device {
  id: string;
  name: string;
  device_type_id: string;
  device_type?: DeviceType;
  status: 'online' | 'offline' | 'idle';
  last_seen: string | null;
  battery_level: number | null;
  signal_strength: number | null;
  attributes: {
    latitude?: number;
    longitude?: number;
    [key: string]: any;
  };
  organization_id?: string | null;
  site_id?: string | null;
}

export default function DeviceMapPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'idle'>('all');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Load devices
  useEffect(() => {
    const loadDevices = async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return router.push('/auth/login');
      const tenant = JSON.parse(atob(token.split('.')[1])).tenant_id;

      try {
        // Fetch all devices (handle pagination)
        let allDevices: Device[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const res = await fetch(`/api/v1/tenants/${tenant}/devices?page=${page}&per_page=100`, {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (res.ok) {
            const json = await res.json();
            allDevices = [...allDevices, ...(json.data || [])];

            // Check if there are more pages
            const total = json.meta?.total || 0;
            hasMore = allDevices.length < total;
            page++;
          } else {
            console.error('Failed to load devices:', res.status, res.statusText);
            hasMore = false;
          }
        }

        console.log('[DeviceMap] Loaded devices:', allDevices.length, 'devices');
        console.log('[DeviceMap] First device sample:', allDevices[0]);
        console.log('[DeviceMap] Devices with coords:', allDevices.filter((d: Device) => d.attributes?.latitude && d.attributes?.longitude).length);
        setDevices(allDevices);
      } catch (err) {
        console.error('Failed to load devices:', err);
      } finally {
        setLoading(false);
      }
    };

    loadDevices();
  }, [router]);

  // Filter devices
  const filteredDevices = useMemo(() => {
    const filtered = devices.filter(device => {
      // Must have coordinates
      if (!device.attributes?.latitude || !device.attributes?.longitude) {
        console.log('[DeviceMap] Device missing coords:', device.name, device.attributes);
        return false;
      }

      // Status filter
      if (statusFilter !== 'all' && device.status !== statusFilter) return false;

      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          device.name.toLowerCase().includes(term) ||
          device.device_type?.name?.toLowerCase().includes(term) ||
          device.id.toLowerCase().includes(term)
        );
      }

      return true;
    });
    console.log('[DeviceMap] Filtered devices:', filtered.length, 'devices pass filter');
    return filtered;
  }, [devices, statusFilter, searchTerm]);

  // Statistics
  const stats = useMemo(() => {
    const total = filteredDevices.length;
    const online = filteredDevices.filter(d => d.status === 'online').length;
    const offline = filteredDevices.filter(d => d.status === 'offline').length;
    const idle = filteredDevices.filter(d => d.status === 'idle').length;
    const withIssues = filteredDevices.filter(d =>
      d.status === 'offline' ||
      (d.battery_level !== null && d.battery_level < 20)
    ).length;

    return { total, online, offline, idle, withIssues };
  }, [filteredDevices]);

  const exportLocations = () => {
    const csv = [
      ['Device ID', 'Name', 'Status', 'Latitude', 'Longitude', 'Battery (%)', 'Last Seen'].join(','),
      ...filteredDevices.map(d => [
        d.id,
        `"${d.name}"`,
        d.status,
        d.attributes.latitude,
        d.attributes.longitude,
        d.battery_level ?? '',
        d.last_seen ? new Date(d.last_seen).toISOString() : ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `device_locations_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <MapPin className="w-8 h-8 text-primary-600" />
                Device Map
              </h1>
              <p className="text-gray-600 mt-1">Real-time visualization of device locations and status</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`px-4 py-2.5 rounded-lg border font-medium transition-colors flex items-center gap-2 ${
                  showFilters
                    ? 'bg-primary-50 text-primary-700 border-primary-200'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                <Filter className="w-4 h-4" />
                Filters
              </button>
              <button
                onClick={exportLocations}
                className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="bg-white border-b border-gray-200 px-8 py-4">
          <div className="grid grid-cols-5 gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <p className="text-xs text-gray-600">Total Devices</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-600">Online</p>
                <p className="text-2xl font-bold text-green-600">{stats.online}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <XCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-600">Offline</p>
                <p className="text-2xl font-bold text-red-600">{stats.offline}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-gray-600">Idle</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.idle}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-600">With Issues</p>
                <p className="text-2xl font-bold text-orange-600">{stats.withIssues}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="bg-white border-b border-gray-200 px-8 py-4">
            <div className="flex items-center gap-4">
              {/* Search */}
              <div className="flex-1 max-w-md">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search devices..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-1">
                {(['all', 'online', 'offline', 'idle'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-4 py-2 text-sm font-medium rounded transition-colors capitalize ${
                      statusFilter === status
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Map Container */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="h-full w-full flex items-center justify-center">
              <div className="text-center">
                <div className="inline-block animate-spin mb-4">
                  <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
                </div>
                <p className="text-gray-600 font-medium">Loading devices...</p>
              </div>
            </div>
          ) : (
            <MapView
              devices={filteredDevices as any}
              selectedDevice={selectedDevice as any}
              onSelectDevice={setSelectedDevice as any}
            />
          )}
        </div>

        {/* Device Detail Panel */}
        {selectedDevice && (
          <div className="absolute right-8 top-24 w-96 bg-white border border-gray-200 rounded-lg shadow-lg p-6 z-[1000]">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">{selectedDevice.name}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedDevice.device_type?.name || 'Unknown Type'}
                </p>
              </div>
              <button
                onClick={() => setSelectedDevice(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Status</span>
                <span className={`px-3 py-1 rounded-lg text-sm font-semibold capitalize ${
                  selectedDevice.status === 'online'
                    ? 'bg-green-100 text-green-700'
                    : selectedDevice.status === 'offline'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {selectedDevice.status}
                </span>
              </div>

              {selectedDevice.battery_level !== null && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Battery</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {Math.round(selectedDevice.battery_level)}%
                  </span>
                </div>
              )}

              {selectedDevice.signal_strength !== null && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Signal</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {selectedDevice.signal_strength} dBm
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-sm text-gray-600">Last Seen</span>
                <span className="text-sm font-semibold text-gray-900">
                  {selectedDevice.last_seen
                    ? new Date(selectedDevice.last_seen).toLocaleString()
                    : 'Never'}
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-600">Location</span>
                <span className="text-sm font-mono text-gray-900">
                  {selectedDevice.attributes.latitude?.toFixed(4)}, {selectedDevice.attributes.longitude?.toFixed(4)}
                </span>
              </div>
            </div>

            <button
              onClick={() => router.push(`/dashboard/devices/${selectedDevice.id}`)}
              className="w-full mt-4 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              View Details
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
