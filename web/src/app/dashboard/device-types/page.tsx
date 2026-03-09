'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import { useToast } from '@/components/ToastProvider';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Copy,
  Cpu,
  MoreVertical,
  Package,
  CheckCircle2,
  XCircle,
  Grid3x3,
  List,
} from 'lucide-react';
import { Badge, CategoryBadge } from '@/components/ui/Badge';
import StatCard from '@/components/ui/StatCard';
import { btn, input } from '@/components/ui/buttonStyles';
import {
  categoryIcons,
  categoryLabels,
  capabilityColors,
  capabilityLabels,
} from './_constants';
import type { DeviceType } from './_types';

type ViewMode = 'grid' | 'list';

export default function DeviceTypesPage() {
  const router = useRouter();
  const toast = useToast();
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

  const handleDelete = async (id: string, name: string) => {
    const ok = await toast.confirm(`Are you sure you want to delete "${name}"?`, { title: 'Delete Device Type', variant: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;

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

      toast.success('Deleted', `Device type "${name}" has been removed`);
      fetchDeviceTypes();
    } catch (err) {
      toast.error('Delete Failed', err instanceof Error ? err.message : 'Failed to delete');
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

      toast.success('Cloned', 'Device type cloned successfully');
      fetchDeviceTypes();
      setDropdownOpen(null);
    } catch (err) {
      toast.error('Clone Failed', err instanceof Error ? err.message : 'Failed to clone');
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
    <PageShell
      title="Device Types"
      subtitle="Manage device type templates for your IoT fleet"
      action={
        <button
          onClick={() => router.push('/dashboard/device-types/new')}
          className={`${btn.primary} flex items-center gap-2`}
        >
          <Plus className="w-4 h-4" />
          Add Device Type
        </button>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Types" value={stats.total} icon={<Package className="w-5 h-5" />} />
          <StatCard label="Active" value={stats.active} icon={<CheckCircle2 className="w-5 h-5" />} accent="#16a34a" color="#16a34a" />
          <StatCard label="Inactive" value={stats.inactive} icon={<XCircle className="w-5 h-5" />} />
          <StatCard label="Total Devices" value={stats.totalDevices} icon={<Cpu className="w-5 h-5" />} accent="#2563eb" color="#2563eb" />
        </div>

        {/* Controls Bar */}
        <div className="gito-card p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search by name or manufacturer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${input.base} pl-9`}
              />
            </div>
            <div className="flex gap-3 items-center flex-wrap">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className={input.select}
                style={{ width: 'auto' }}
              >
                <option value="">All Categories</option>
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value)}
                className={input.select}
                style={{ width: 'auto' }}
              >
                <option value="">All Status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
              <div className="flex gap-1 p-1 bg-panel rounded-lg border border-[var(--color-border)]">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5 ${
                    viewMode === 'grid' ? 'bg-surface text-primary-600 shadow-sm font-medium' : 'text-th-muted hover:text-th-primary'
                  }`}
                >
                  <Grid3x3 className="w-3.5 h-3.5" />Grid
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5 ${
                    viewMode === 'list' ? 'bg-surface text-primary-600 shadow-sm font-medium' : 'text-th-muted hover:text-th-primary'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />List
                </button>
              </div>
            </div>
          </div>
          {!loading && (
            <p className="text-xs text-th-muted mt-3 pt-3 border-t border-[var(--color-border)]">
              Showing <span className="font-semibold text-th-primary">{filteredTypes.length}</span> of{' '}
              <span className="font-semibold text-th-primary">{stats.total}</span> device types
            </p>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 rounded-lg text-sm" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="gito-card p-12 text-center text-sm text-th-secondary">Loading device types...</div>
        ) : filteredTypes.length === 0 ? (
          /* Empty State */
          <div className="gito-card p-12 text-center flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)' }}>
              <Package className="w-7 h-7 text-th-muted" />
            </div>
            <h3 className="text-base font-bold text-th-primary mb-1.5">No device types found</h3>
            <p className="text-sm text-th-secondary mb-5">Create your first device type template to get started</p>
            <button onClick={() => router.push('/dashboard/device-types/new')} className={`${btn.primary} flex items-center gap-2`}>
              <Plus className="w-4 h-4" />Create Device Type
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTypes.map((deviceType) => (
              <div
                key={deviceType.id}
                className="gito-card overflow-hidden"
              >
                {/* Card Header */}
                <div
                  className="p-4 border-b border-th-subtle"
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
                        <h3 className="font-semibold text-th-primary">{deviceType.name}</h3>
                        <p className="text-xs text-th-secondary">
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
                        className="p-1.5 rounded-lg hover:bg-panel text-th-muted hover:text-th-secondary transition-colors"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {dropdownOpen === deviceType.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 bg-surface border border-th-default rounded-lg shadow-lg z-10 py-1">
                          <button
                            onClick={() => {
                              router.push(`/dashboard/device-types/${deviceType.id}`);
                              setDropdownOpen(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-th-primary hover:bg-page flex items-center gap-2"
                          >
                            <Edit className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleClone(deviceType.id)}
                            className="w-full px-3 py-2 text-left text-sm text-th-primary hover:bg-page flex items-center gap-2"
                          >
                            <Copy className="w-4 h-4" />
                            Clone
                          </button>
                          <hr className="my-1 border-th-default" />
                          <button
                            onClick={() => {
                              handleDelete(deviceType.id, deviceType.name);
                              setDropdownOpen(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm flex items-center gap-2"
                            style={{ color: '#ef4444' }}
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
                    <p className="text-sm text-th-secondary line-clamp-2">
                      {deviceType.description}
                    </p>
                  )}

                  {/* Data Model Fields */}
                  <div>
                    <h4 className="text-xs font-medium text-th-secondary uppercase mb-2">
                      Data Model ({deviceType.data_model?.length || 0} fields)
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(deviceType.data_model || []).slice(0, 4).map((field) => (
                        <span
                          key={field.name}
                          className="px-2 py-0.5 bg-panel rounded text-xs text-th-secondary"
                        >
                          {field.name}
                          {field.unit && <span className="text-th-muted ml-1">({field.unit})</span>}
                        </span>
                      ))}
                      {(deviceType.data_model?.length || 0) > 4 && (
                        <span className="px-2 py-0.5 bg-panel rounded text-xs text-th-muted">
                          +{deviceType.data_model.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Capabilities */}
                  {deviceType.capabilities?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-bold text-th-muted uppercase tracking-widest mb-2">
                        Capabilities
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {deviceType.capabilities.map((cap) => {
                          const c = capabilityColors[cap] || { bg: 'rgba(100,116,139,0.1)', color: 'var(--color-text-secondary)', border: 'rgba(100,116,139,0.2)' };
                          return (
                            <span
                              key={cap}
                              className="px-2 py-0.5 rounded text-xs font-medium"
                              style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}
                            >
                              {capabilityLabels[cap] || cap}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stats Row */}
                  <div className="flex items-center justify-between pt-3 border-t border-th-subtle">
                    <div className="flex items-center gap-4 text-xs text-th-secondary">
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5" />
                        {deviceType.device_count} devices
                      </span>
                      {deviceType.connectivity?.protocol && (
                        <span className="uppercase font-medium">{deviceType.connectivity.protocol}</span>
                      )}
                    </div>
                    <Badge
                      variant={deviceType.is_active ? 'success' : 'neutral'}
                      label={deviceType.is_active ? 'Active' : 'Inactive'}
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="gito-card overflow-hidden">
            <div className="border-b border-[var(--color-border)] px-6 py-3 bg-panel">
              <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-th-muted uppercase tracking-widest">
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Category</div>
                <div className="col-span-2">Protocol</div>
                <div className="col-span-2">Devices</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {filteredTypes.map((deviceType) => (
                <div key={deviceType.id} className="px-6 py-4 hover:bg-panel transition-colors">
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${deviceType.color}20`, color: deviceType.color }}
                        >
                          {categoryIcons[deviceType.category] || <Cpu className="w-4 h-4" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-th-primary">{deviceType.name}</p>
                          <p className="text-xs text-th-muted">{deviceType.manufacturer || 'Generic'}</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <CategoryBadge category={deviceType.category} />
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs font-mono font-medium text-th-secondary uppercase">
                        {deviceType.connectivity?.protocol || '—'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-th-primary font-mono">{deviceType.device_count}</span>
                    </div>
                    <div className="col-span-1">
                      <Badge variant={deviceType.is_active ? 'success' : 'neutral'} label={deviceType.is_active ? 'Active' : 'Inactive'} size="sm" />
                    </div>
                    <div className="col-span-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => router.push(`/dashboard/device-types/${deviceType.id}`)}
                          className={btn.icon}
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleClone(deviceType.id)}
                          className={btn.icon}
                          title="Clone"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(deviceType.id, deviceType.name)}
                          className={btn.iconDanger}
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
    </PageShell>
  );
}
