'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { useToast } from '@/components/ToastProvider';
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
  BatteryWarning,
  Thermometer,
  Droplets,
  Zap,
  Wifi,
  Gauge,
  Wind,
  Radio,
  Plus,
} from 'lucide-react';

interface Device {
  id: string;
  tenant_id: string;
  name: string;
  device_type: string;
  device_type_id?: string;
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

function getRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DeviceTypeIcon({ deviceType, className = 'w-5 h-5' }: { deviceType: string; className?: string }) {
  const t = deviceType.toLowerCase();
  if (t.includes('temp') || t.includes('thermal')) return <Thermometer className={className} />;
  if (t.includes('humid') || t.includes('moisture') || t.includes('water') || t.includes('flow')) return <Droplets className={className} />;
  if (t.includes('energy') || t.includes('power') || t.includes('electric') || t.includes('volt')) return <Zap className={className} />;
  if (t.includes('gateway') || t.includes('router') || t.includes('wifi') || t.includes('bridge')) return <Wifi className={className} />;
  if (t.includes('pressure') || t.includes('gauge')) return <Gauge className={className} />;
  if (t.includes('air') || t.includes('wind') || t.includes('co2') || t.includes('gas')) return <Wind className={className} />;
  if (t.includes('lora') || t.includes('sigfox') || t.includes('nbiot') || t.includes('cellular')) return <Radio className={className} />;
  return <Cpu className={className} />;
}

export default function DevicesPage() {
  const router = useRouter();
  const toast = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [tenantId, setTenantId] = useState<string>('');
  const loadDevices = useCallback(async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
          router.push('/auth/login');
          return;
        }

        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;
        setTenantId(tenant);

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
  }, [router]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Bulk delete devices
  const handleBulkDelete = async () => {
    const ok = await toast.confirm(`Are you sure you want to delete ${selectedDevices.size} device(s)? This action cannot be undone.`, { title: 'Delete Devices', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const response = await fetch(`/api/v1/tenants/${tenant}/devices/bulk/delete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_ids: Array.from(selectedDevices)
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to delete devices');
      }

      // Reload devices and clear selection
      const data = await response.json();
      toast.success('Success', data.data.message);
      setSelectedDevices(new Set());
      window.location.reload();
    } catch (err) {
      toast.error('Failed to delete devices', err instanceof Error ? err.message : undefined);
    }
  };

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
        <div className="mb-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Devices</h1>
              <p className="text-sm text-gray-500 mt-0.5">Monitor and manage your IoT fleet</p>
            </div>
            <button
              onClick={() => router.push('/dashboard/devices/new')}
              className="px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 shadow-sm text-sm"
            >
              <Plus className="w-4 h-4" /> Add Device
            </button>
          </div>

          {/* Fleet status bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-4 py-2.5 shadow-sm">
              <Cpu className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-900">{stats.total}</span>
              <span className="text-sm text-gray-400">devices</span>
            </div>
            <div className="flex items-center gap-2 bg-white border border-green-200 rounded-lg px-4 py-2.5 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-semibold text-green-700">{stats.online}</span>
              <span className="text-sm text-gray-400">online</span>
            </div>
            {stats.offline > 0 && (
              <div className="flex items-center gap-2 bg-white border border-red-200 rounded-lg px-4 py-2.5 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-sm font-semibold text-red-600">{stats.offline}</span>
                <span className="text-sm text-gray-400">offline</span>
              </div>
            )}
            {stats.idle > 0 && (
              <div className="flex items-center gap-2 bg-white border border-yellow-200 rounded-lg px-4 py-2.5 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-sm font-semibold text-yellow-600">{stats.idle}</span>
                <span className="text-sm text-gray-400">idle</span>
              </div>
            )}
            {stats.total > 0 && (
              <div className="ml-auto text-xs text-gray-400">
                {Math.round((stats.online / stats.total) * 100)}% fleet online
              </div>
            )}
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
                <button
                  onClick={() => setShowBulkAssignModal(true)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  Assign to Group
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
                >
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDevices.map((device) => (
              <Link key={device.id} href={`/dashboard/devices/${device.id}`} className="group block">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 overflow-hidden h-full">

                  {/* Coloured status stripe at top */}
                  <div className={`h-1 w-full ${
                    device.status === 'online' ? 'bg-green-400' :
                    device.status === 'offline' ? 'bg-red-400' : 'bg-yellow-400'
                  }`} />

                  <div className="p-4">
                    {/* Top row: icon + name + status dot */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Checkbox for bulk select */}
                        <input
                          type="checkbox"
                          checked={selectedDevices.has(device.id)}
                          onChange={() => toggleDeviceSelection(device.id)}
                          className="w-3.5 h-3.5 text-primary-600 border-slate-300 rounded focus:ring-primary-500 flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {/* Device type icon */}
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          device.status === 'online'
                            ? 'bg-green-50 text-green-600'
                            : device.status === 'offline'
                            ? 'bg-red-50 text-red-400'
                            : 'bg-gray-50 text-gray-400'
                        }`}>
                          <DeviceTypeIcon deviceType={device.device_type} className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 group-hover:text-primary-600 transition-colors truncate leading-tight">
                            {device.name}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{device.device_type}</p>
                        </div>
                      </div>
                      {/* Status indicator */}
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <span className={`w-2 h-2 rounded-full ${
                          device.status === 'online' ? 'bg-green-500 animate-pulse' :
                          device.status === 'offline' ? 'bg-red-500' : 'bg-yellow-400'
                        }`} />
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="space-y-2.5 mt-3">
                      {/* Last seen */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Last seen</span>
                        <span className={`text-xs font-semibold ${
                          device.status === 'online' ? 'text-green-600' :
                          device.status === 'offline' ? 'text-red-500' : 'text-gray-500'
                        }`}>
                          {getRelativeTime(device.last_seen)}
                        </span>
                      </div>

                      {/* Battery bar */}
                      {device.battery_level !== null ? (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400">Battery</span>
                            <span className={`text-xs font-semibold ${
                              device.battery_level > 50 ? 'text-green-600' :
                              device.battery_level > 20 ? 'text-yellow-600' : 'text-red-600'
                            }`}>{Math.round(device.battery_level)}%</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${
                                device.battery_level > 50 ? 'bg-green-400' :
                                device.battery_level > 20 ? 'bg-yellow-400' : 'bg-red-400'
                              }`}
                              style={{ width: `${Math.min(device.battery_level, 100)}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">Battery</span>
                          <span className="text-xs text-gray-300">—</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className={`px-4 py-2.5 border-t flex items-center justify-between ${
                    device.status === 'online'
                      ? 'bg-green-50 border-green-100'
                      : device.status === 'offline'
                      ? 'bg-red-50 border-red-100'
                      : 'bg-gray-50 border-gray-100'
                  }`}>
                    <span className={`text-xs font-semibold capitalize ${
                      device.status === 'online' ? 'text-green-700' :
                      device.status === 'offline' ? 'text-red-600' : 'text-yellow-700'
                    }`}>{device.status}</span>
                    <span className="text-xs text-gray-400 group-hover:text-primary-600 transition-colors">
                      View →
                    </span>
                  </div>
                </div>
              </Link>
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

        {/* Bulk Assign Modal */}
        {showBulkAssignModal && (
          <BulkAssignModal
            selectedCount={selectedDevices.size}
            onSubmit={async (groupId) => {
              try {
                const token = localStorage.getItem('auth_token');
                if (!token) return;
                const payload = JSON.parse(atob(token.split('.')[1]));
                const tenant = payload.tenant_id;

                const response = await fetch(`/api/v1/tenants/${tenant}/devices/bulk/assign-group`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    device_ids: Array.from(selectedDevices),
                    device_group_id: groupId || null
                  })
                });

                if (!response.ok) {
                  const data = await response.json();
                  throw new Error(data.error?.message || 'Failed to assign devices');
                }

                const data = await response.json();
                toast.success('Success', data.data.message);
                setShowBulkAssignModal(false);
                setSelectedDevices(new Set());
                window.location.reload();
              } catch (err) {
                toast.error('Failed to assign devices', err instanceof Error ? err.message : undefined);
              }
            }}
            onCancel={() => setShowBulkAssignModal(false)}
          />
        )}
      </main>
    </div>
  );
}

// Bulk Assign Modal Component
function BulkAssignModal({
  selectedCount,
  onSubmit,
  onCancel
}: {
  selectedCount: number;
  onSubmit: (groupId: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [deviceGroups, setDeviceGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenant = payload.tenant_id;

        const response = await fetch(`/api/v1/tenants/${tenant}/device-groups?page=1&per_page=100`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          setDeviceGroups(data.data || []);
        }
      } catch (err) {
        console.error('Failed to load device groups:', err);
      } finally {
        setLoading(false);
      }
    };

    loadGroups();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(selectedGroupId || null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Assign Devices to Group
        </h3>

        <p className="text-sm text-gray-600 mb-4">
          Assign {selectedCount} selected device{selectedCount !== 1 ? 's' : ''} to a device group.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Device Group
            </label>
            {loading ? (
              <div className="text-sm text-gray-500">Loading groups...</div>
            ) : (
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">No Group (Unassign)</option>
                {deviceGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || loading}
              className="flex-1 px-4 py-2.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
