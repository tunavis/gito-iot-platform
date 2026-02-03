'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Copy,
  Cpu,
  Thermometer,
  Radio,
  ToggleRight,
  MapPin,
  Zap,
  Camera,
  Settings,
  MoreVertical,
  Package,
  CheckCircle2,
  XCircle,
  Grid3x3,
  List,
} from 'lucide-react';

// Types
interface DataModelField {
  name: string;
  type: string;
  unit?: string;
  description?: string;
  min?: number;
  max?: number;
  required?: boolean;
}

interface DeviceType {
  id: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  category: string;
  icon: string;
  color: string;
  data_model: DataModelField[];
  capabilities: string[];
  default_settings?: {
    heartbeat_interval?: number;
    telemetry_interval?: number;
    offline_threshold?: number;
  };
  connectivity?: {
    protocol?: string;
    lorawan_class?: string;
    mqtt_topic_template?: string;
  };
  is_active: boolean;
  device_count: number;
  created_at: string;
  updated_at: string;
}

type ViewMode = 'grid' | 'list';

// Icon mapping
const categoryIcons: Record<string, React.ReactNode> = {
  sensor: <Thermometer className="w-5 h-5" />,
  gateway: <Radio className="w-5 h-5" />,
  actuator: <ToggleRight className="w-5 h-5" />,
  tracker: <MapPin className="w-5 h-5" />,
  meter: <Zap className="w-5 h-5" />,
  camera: <Camera className="w-5 h-5" />,
  controller: <Settings className="w-5 h-5" />,
  other: <Cpu className="w-5 h-5" />,
};

const categoryLabels: Record<string, string> = {
  sensor: 'Sensor',
  gateway: 'Gateway',
  actuator: 'Actuator',
  tracker: 'Tracker',
  meter: 'Meter',
  camera: 'Camera',
  controller: 'Controller',
  other: 'Other',
};

const capabilityBadges: Record<string, { label: string; color: string }> = {
  telemetry: { label: 'Telemetry', color: 'bg-blue-100 text-blue-700' },
  commands: { label: 'Commands', color: 'bg-purple-100 text-purple-700' },
  firmware_ota: { label: 'OTA', color: 'bg-amber-100 text-amber-700' },
  remote_config: { label: 'Remote Config', color: 'bg-teal-100 text-teal-700' },
  location: { label: 'Location', color: 'bg-green-100 text-green-700' },
  alerts: { label: 'Alerts', color: 'bg-red-100 text-red-700' },
  file_transfer: { label: 'Files', color: 'bg-indigo-100 text-indigo-700' },
  edge_compute: { label: 'Edge', color: 'bg-pink-100 text-pink-700' },
};

export default function DeviceTypesPage() {
  const router = useRouter();
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Fetch device types
  const fetchDeviceTypes = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/auth/login');
        return;
      }
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (categoryFilter) params.append('category', categoryFilter);
      if (activeFilter) params.append('is_active', activeFilter);

      const response = await fetch(
        `/api/v1/tenants/${tenant}/device-types?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to fetch device types');

      const result = await response.json();
      setDeviceTypes(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load device types');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter, activeFilter, router]);

  useEffect(() => {
    fetchDeviceTypes();
  }, [fetchDeviceTypes]);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenant}/device-types/${id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete device type');
      }

      fetchDeviceTypes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleClone = async (id: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenant}/device-types/${id}/clone`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) throw new Error('Failed to clone device type');

      fetchDeviceTypes();
      setDropdownOpen(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clone');
    }
  };

  // Stats
  const stats = useMemo(() => ({
    total: deviceTypes.length,
    active: deviceTypes.filter(dt => dt.is_active).length,
    inactive: deviceTypes.filter(dt => !dt.is_active).length,
    totalDevices: deviceTypes.reduce((sum, dt) => sum + (dt.device_count || 0), 0),
  }), [deviceTypes]);

  // Filter device types
  const filteredTypes = deviceTypes.filter((dt) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !dt.name.toLowerCase().includes(query) &&
        !dt.manufacturer?.toLowerCase().includes(query)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      
      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Device Types</h1>
              <p className="text-gray-600 mt-2">Manage device type templates for your IoT fleet</p>
            </div>
            <button
              onClick={() => router.push('/dashboard/device-types/new')}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add Device Type
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6">
            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Total Types</p>
                  <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
                </div>
                <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Package className="w-6 h-6 text-slate-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Active</p>
                  <p className="text-3xl font-bold text-green-600">{stats.active}</p>
                </div>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Inactive</p>
                  <p className="text-3xl font-bold text-gray-600">{stats.inactive}</p>
                </div>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-gray-500" />
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-6 border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-1">Total Devices</p>
                  <p className="text-3xl font-bold text-blue-600">{stats.totalDevices}</p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Cpu className="w-6 h-6 text-blue-600" />
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
                  placeholder="Search by name or manufacturer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <Search className="absolute left-3.5 top-3 w-5 h-5 text-slate-400" />
              </div>
            </div>

            {/* Filters and View Toggle */}
            <div className="flex gap-3 items-center">
              {/* Category Filter */}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">All Categories</option>
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value)}
                className="px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">All Status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
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

          {/* Results Count */}
          {!loading && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <p className="text-sm text-slate-600">
                Showing <span className="font-semibold text-slate-900">{filteredTypes.length}</span> of{' '}
                <span className="font-semibold text-slate-900">{stats.total}</span> device types
              </p>
            </div>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading device types...</div>
          </div>
        ) : filteredTypes.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
            <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No device types found</h3>
            <p className="text-sm text-gray-500 mb-6">
              Create your first device type template to get started
            </p>
            <button
              onClick={() => router.push('/dashboard/device-types/new')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Device Type
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTypes.map((deviceType) => (
              <div
                key={deviceType.id}
                className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Card Header */}
                <div
                  className="p-4 border-b border-gray-100"
                  style={{ backgroundColor: `${deviceType.color}10` }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${deviceType.color}20`, color: deviceType.color }}
                      >
                        {categoryIcons[deviceType.category] || <Cpu className="w-5 h-5" />}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{deviceType.name}</h3>
                        <p className="text-xs text-gray-500">
                          {deviceType.manufacturer || 'Generic'} • {categoryLabels[deviceType.category]}
                        </p>
                      </div>
                    </div>

                    {/* Actions Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setDropdownOpen(dropdownOpen === deviceType.id ? null : deviceType.id)
                        }
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {dropdownOpen === deviceType.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                          <button
                            onClick={() => {
                              router.push(`/dashboard/device-types/${deviceType.id}`);
                              setDropdownOpen(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Edit className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleClone(deviceType.id)}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Copy className="w-4 h-4" />
                            Clone
                          </button>
                          <hr className="my-1 border-gray-200" />
                          <button
                            onClick={() => {
                              handleDelete(deviceType.id, deviceType.name);
                              setDropdownOpen(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-4">
                  {/* Description */}
                  {deviceType.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {deviceType.description}
                    </p>
                  )}

                  {/* Data Model Fields */}
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                      Data Model ({deviceType.data_model?.length || 0} fields)
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(deviceType.data_model || []).slice(0, 4).map((field) => (
                        <span
                          key={field.name}
                          className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600"
                        >
                          {field.name}
                          {field.unit && <span className="text-gray-400 ml-1">({field.unit})</span>}
                        </span>
                      ))}
                      {(deviceType.data_model?.length || 0) > 4 && (
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-400">
                          +{deviceType.data_model.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Capabilities */}
                  {deviceType.capabilities?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                        Capabilities
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {deviceType.capabilities.map((cap) => {
                          const badge = capabilityBadges[cap] || {
                            label: cap,
                            color: 'bg-gray-100 text-gray-600',
                          };
                          return (
                            <span
                              key={cap}
                              className={`px-2 py-0.5 rounded text-xs ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stats Row */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5" />
                        {deviceType.device_count} devices
                      </span>
                      {deviceType.connectivity?.protocol && (
                        <span className="uppercase font-medium">{deviceType.connectivity.protocol}</span>
                      )}
                    </div>
                    <span
                      className={`flex items-center gap-1 text-xs font-medium ${
                        deviceType.is_active ? 'text-green-600' : 'text-gray-500'
                      }`}
                    >
                      {deviceType.is_active ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5" />
                          Inactive
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="border-b border-gray-200 px-6 py-3 bg-gray-50">
              <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-600 uppercase">
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Category</div>
                <div className="col-span-2">Protocol</div>
                <div className="col-span-2">Devices</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
            </div>
            <div className="divide-y divide-gray-200">
              {filteredTypes.map((deviceType) => (
                <div key={deviceType.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${deviceType.color}20`, color: deviceType.color }}
                        >
                          {categoryIcons[deviceType.category] || <Cpu className="w-4 h-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{deviceType.name}</p>
                          <p className="text-xs text-gray-500">{deviceType.manufacturer || 'Generic'}</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-gray-700">{categoryLabels[deviceType.category]}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-gray-700 uppercase">
                        {deviceType.connectivity?.protocol || '-'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-gray-700">{deviceType.device_count}</span>
                    </div>
                    <div className="col-span-1">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          deviceType.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {deviceType.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => router.push(`/dashboard/device-types/${deviceType.id}`)}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleClone(deviceType.id)}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="Clone"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(deviceType.id, deviceType.name)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
