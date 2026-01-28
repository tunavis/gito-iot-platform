'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Search, 
  Grid3x3, 
  List, 
  ChevronUp, 
  ChevronDown,
  Battery,
  BatteryLow,
  BatteryWarning
} from 'lucide-react';

interface Device {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  status: 'online' | 'offline' | 'idle' | 'error';
  last_seen: string | null;
  battery_level: number | null;
  dev_eui?: string;
  ttn_app_id?: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

type ViewMode = 'grid' | 'list';
type StatusFilter = 'all' | 'online' | 'offline' | 'idle';
type SortField = 'name' | 'device_type' | 'status' | 'battery_level' | 'last_seen';
type SortDirection = 'asc' | 'desc';

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    const loadDevices = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
          router.push('/auth/login');
          return;
        }

        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;

        const response = await fetch(`/api/v1/tenants/${tenant}/devices`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to load devices');
        }

        setDevices(data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load devices');
      } finally {
        setLoading(false);
      }
    };

    loadDevices();
  }, [router]);

  // Sort devices
  const sortDevices = (devices: Device[]) => {
    return [...devices].sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      // Handle null values
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      // Convert to comparable values
      if (sortField === 'last_seen') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      } else if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  };

  // Filter and search devices
  const filteredDevices = useMemo(() => {
    let filtered = devices.filter(device => {
      const matchesSearch = searchQuery === '' || 
        device.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        device.device_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        device.id.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || device.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });

    return sortDevices(filtered);
  }, [devices, searchQuery, statusFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleDeviceSelection = (deviceId: string) => {
    const newSelected = new Set(selectedDevices);
    if (newSelected.has(deviceId)) {
      newSelected.delete(deviceId);
    } else {
      newSelected.add(deviceId);
    }
    setSelectedDevices(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedDevices.size === filteredDevices.length) {
      setSelectedDevices(new Set());
    } else {
      setSelectedDevices(new Set(filteredDevices.map(d => d.id)));
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-600 bg-green-50 border-green-200';
      case 'offline': return 'text-red-600 bg-red-50 border-red-200';
      case 'idle': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusDotColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'offline': return 'bg-red-500';
      case 'idle': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const getBatteryIcon = (level: number | null) => {
    if (level === null) return <Battery className="w-4 h-4" />;
    if (level < 20) return <BatteryLow className="w-4 h-4 text-red-600" />;
    if (level < 50) return <BatteryWarning className="w-4 h-4 text-yellow-600" />;
    return <Battery className="w-4 h-4 text-green-600" />;
  };

  const stats = useMemo(() => ({
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    idle: devices.filter(d => d.status === 'idle').length,
  }), [devices]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="w-4 h-4" />
    ) : (
      <ChevronDown className="w-4 h-4" />
    );
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Device Management</h1>
              <p className="text-gray-600 mt-2">Monitor and manage all your IoT devices</p>
            </div>
            <button 
              onClick={() => router.push('/dashboard/devices/new')}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 shadow-sm"
            >
              <span className="text-lg">+</span> Add Device
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6">
            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Total Devices</p>
                  <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
                </div>
                <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Cpu className="w-6 h-6 text-slate-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Online</p>
                  <p className="text-3xl font-bold text-green-600">{stats.online}</p>
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
                  <p className="text-3xl font-bold text-red-600">{stats.offline}</p>
                </div>
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-yellow-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Idle</p>
                  <p className="text-3xl font-bold text-yellow-600">{stats.idle}</p>
                </div>
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 mb-6">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            {/* Search */}
            <div className="flex-1 w-full md:max-w-md">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search devices by name, type, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <Search className="absolute left-3.5 top-3 w-5 h-5 text-slate-400" />
              </div>
            </div>

            {/* Filters and View Toggle */}
            <div className="flex gap-3 items-center">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="all">All Status</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="idle">Idle</option>
              </select>

              {/* View Mode Toggle */}
              <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
                    viewMode === 'grid' 
                      ? 'bg-white text-primary-600 shadow-sm' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Grid3x3 className="w-4 h-4" />
                  <span>Grid</span>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
                    viewMode === 'list' 
                      ? 'bg-white text-primary-600 shadow-sm' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-4 h-4" />
                  <span>List</span>
                </button>
              </div>
            </div>
          </div>

          {/* Device Count */}
          {!loading && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-sm text-slate-600">
                Showing <span className="font-semibold text-slate-900">{filteredDevices.length}</span> of{' '}
                <span className="font-semibold text-slate-900">{stats.total}</span> devices
              </p>
            </div>
          )}

          {/* Bulk Actions */}
          {selectedDevices.size > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
              <span className="text-sm text-slate-600 font-medium">
                {selectedDevices.size} device{selectedDevices.size !== 1 ? 's' : ''} selected
              </span>
              <div className="flex gap-2">
                <button className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium">
                  Configure
                </button>
                <button className="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium">
                  Delete
                </button>
                <button 
                  onClick={() => setSelectedDevices(new Set())}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 font-medium"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="inline-block animate-spin mb-4">
                <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
              </div>
              <p className="text-slate-600">Loading devices...</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <p className="text-red-600 mb-4">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            {searchQuery || statusFilter !== 'all' ? (
              <>
                <p className="text-slate-600 mb-4">No devices match your filters</p>
                <button 
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                  }}
                  className="px-4 py-2 text-primary-600 hover:text-primary-700 font-medium"
                >
                  Clear Filters
                </button>
              </>
            ) : (
              <>
                <p className="text-slate-600 mb-4">No devices found. Add your first device to get started.</p>
                <button 
                  onClick={() => router.push('/dashboard/devices/new')}
                  className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                  + Add Device
                </button>
              </>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredDevices.map((device) => (
              <div
                key={device.id}
                className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-200 group"
              >
                {/* Card Header */}
                <div className="p-5 border-b border-slate-100">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedDevices.has(device.id)}
                        onChange={() => toggleDeviceSelection(device.id)}
                        className="w-4 h-4 text-primary-600 border-slate-300 rounded focus:ring-primary-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="w-11 h-11 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                        {device.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link 
                          href={`/dashboard/devices/${device.id}`}
                          className="block"
                        >
                          <h3 className="font-semibold text-slate-900 group-hover:text-primary-600 transition-colors truncate text-base">
                            {device.name}
                          </h3>
                          <p className="text-xs text-slate-500 truncate">{device.id.substring(0, 8)}</p>
                        </Link>
                      </div>
                    </div>
                  </div>
                  
                  {/* Status Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border ${getStatusColor(device.status)}`}>
                      <span className={`w-2 h-2 rounded-full ${getStatusDotColor(device.status)} ${device.status === 'online' ? 'animate-pulse' : ''}`}></span>
                      {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
                    </span>
                    <span className="text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded font-medium">
                      {device.device_type}
                    </span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 flex items-center gap-2">
                      {getBatteryIcon(device.battery_level)}
                      Battery
                    </span>
                    <span className={`font-semibold ${
                      device.battery_level !== null 
                        ? device.battery_level > 50 ? 'text-green-600' 
                          : device.battery_level > 20 ? 'text-yellow-600' 
                          : 'text-red-600'
                        : 'text-slate-400'
                    }`}>
                      {device.battery_level !== null ? `${Math.round(device.battery_level)}%` : 'N/A'}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Last Seen</span>
                    <span className="text-slate-900 text-xs font-medium">
                      {device.last_seen 
                        ? new Date(device.last_seen).toLocaleDateString()
                        : 'Never'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Created</span>
                    <span className="text-slate-900 text-xs font-medium">
                      {new Date(device.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Card Footer */}
                <div className="p-4 border-t border-slate-100 bg-slate-50">
                  <Link
                    href={`/dashboard/devices/${device.id}`}
                    className="block w-full text-center px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                  >
                    View Details →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left w-12">
                      <input
                        type="checkbox"
                        checked={filteredDevices.length > 0 && selectedDevices.size === filteredDevices.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-primary-600 border-slate-300 rounded focus:ring-primary-500"
                      />
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-2">
                        Device
                        <SortIcon field="name" />
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('device_type')}
                    >
                      <div className="flex items-center gap-2">
                        Type
                        <SortIcon field="device_type" />
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-2">
                        Status
                        <SortIcon field="status" />
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('battery_level')}
                    >
                      <div className="flex items-center gap-2">
                        Battery
                        <SortIcon field="battery_level" />
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
                      onClick={() => handleSort('last_seen')}
                    >
                      <div className="flex items-center gap-2">
                        Last Seen
                        <SortIcon field="last_seen" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDevices.map((device) => (
                    <tr key={device.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedDevices.has(device.id)}
                          onChange={() => toggleDeviceSelection(device.id)}
                          className="w-4 h-4 text-primary-600 border-slate-300 rounded focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/devices/${device.id}`} className="flex items-center gap-3 group">
                          <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0">
                            {device.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 group-hover:text-primary-600 transition-colors truncate">
                              {device.name}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{device.id.substring(0, 16)}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                          {device.device_type}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full border ${getStatusColor(device.status)}`}>
                          <span className={`w-2 h-2 rounded-full ${getStatusDotColor(device.status)} ${device.status === 'online' ? 'animate-pulse' : ''}`}></span>
                          {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {getBatteryIcon(device.battery_level)}
                          <span className={`text-sm font-medium ${
                            device.battery_level !== null 
                              ? device.battery_level > 50 ? 'text-green-600' 
                                : device.battery_level > 20 ? 'text-yellow-600' 
                                : 'text-red-600'
                              : 'text-slate-400'
                          }`}>
                            {device.battery_level !== null ? `${Math.round(device.battery_level)}%` : 'N/A'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-900 font-medium">
                        {device.last_seen 
                          ? new Date(device.last_seen).toLocaleString('en-US', { 
                              month: 'short', 
                              day: 'numeric', 
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : <span className="text-slate-400">Never</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {new Date(device.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/dashboard/devices/${device.id}`}
                          className="text-primary-600 hover:text-primary-700 text-sm font-medium inline-flex items-center gap-1"
                        >
                          View
                          <span>→</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
