'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { useToast } from '@/components/ToastProvider';
import {
  ArrowLeft,
  Save,
  Cpu,
  Thermometer,
  Radio,
  ToggleRight,
  MapPin,
  Zap,
  Camera,
  Settings,
  AlertCircle,
  Loader2,
  Tag,
  Building,
  Layers,
  Plus,
} from 'lucide-react';

interface DeviceType {
  id: string;
  name: string;
  category: string;
  icon: string;
  color: string;
  manufacturer?: string;
  model?: string;
}

interface Site {
  id: string;
  name: string;
  organization_id: string;
}

interface DeviceGroup {
  id: string;
  name: string;
  site_id: string;
}

interface Device {
  id: string;
  name: string;
  device_type_id: string;
  device_type?: DeviceType;
  status: string;
  attributes: Record<string, any>;
  firmware_version?: string | null;
  hardware_version?: string | null;
  lorawan_dev_eui?: string | null;
  chirpstack_app_id?: string | null;
  device_profile_id?: string | null;
  organization_id?: string | null;
  site_id?: string | null;
  device_group_id?: string | null;
}

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

export default function EditDevicePage() {
  const router = useRouter();
  const params = useParams();
  const deviceId = params?.id as string;
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [device, setDevice] = useState<Device | null>(null);
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);

  // Form state
  const [form, setForm] = useState({
    name: '',
    device_type_id: '',
    firmware_version: '',
    hardware_version: '',
    description: '',
    serial_number: '',
    tags: [] as string[],
    newTag: '',
    lorawan_dev_eui: '',
    chirpstack_app_id: '',
    device_profile_id: '',
    site_id: '',
    device_group_id: '',
    latitude: '',
    longitude: '',
  });

  const getTenantInfo = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/auth/login');
      return null;
    }
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { token, tenant: payload.tenant_id };
  }, [router]);

  // Load device data
  const loadDevice = useCallback(async () => {
    const info = getTenantInfo();
    if (!info) return;

    try {
      const [deviceRes, typesRes, sitesRes] = await Promise.all([
        fetch(`/api/v1/tenants/${info.tenant}/devices/${deviceId}`, {
          headers: { Authorization: `Bearer ${info.token}` },
        }),
        fetch(`/api/v1/tenants/${info.tenant}/device-types?is_active=true&per_page=100`, {
          headers: { Authorization: `Bearer ${info.token}` },
        }),
        fetch(`/api/v1/tenants/${info.tenant}/sites`, {
          headers: { Authorization: `Bearer ${info.token}` },
        }),
      ]);

      if (!deviceRes.ok) throw new Error('Device not found');

      const deviceData = (await deviceRes.json()).data;
      setDevice(deviceData);

      if (typesRes.ok) {
        setDeviceTypes((await typesRes.json()).data || []);
      }
      if (sitesRes.ok) {
        setSites((await sitesRes.json()).data || []);
      }

      // Populate form
      setForm({
        name: deviceData.name || '',
        device_type_id: deviceData.device_type_id || '',
        firmware_version: deviceData.firmware_version || '',
        hardware_version: deviceData.hardware_version || '',
        description: deviceData.attributes?.description || '',
        serial_number: deviceData.attributes?.serial_number || '',
        tags: deviceData.attributes?.tags || [],
        newTag: '',
        lorawan_dev_eui: deviceData.lorawan_dev_eui || '',
        chirpstack_app_id: deviceData.chirpstack_app_id || '',
        device_profile_id: deviceData.device_profile_id || '',
        site_id: deviceData.site_id || '',
        device_group_id: deviceData.device_group_id || '',
        latitude: deviceData.attributes?.latitude?.toString() || '',
        longitude: deviceData.attributes?.longitude?.toString() || '',
      });

      // Load device groups if site is set
      if (deviceData.site_id) {
        const groupsRes = await fetch(
          `/api/v1/tenants/${info.tenant}/sites/${deviceData.site_id}/device-groups`,
          { headers: { Authorization: `Bearer ${info.token}` } }
        );
        if (groupsRes.ok) {
          setDeviceGroups((await groupsRes.json()).data || []);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load device');
    } finally {
      setLoading(false);
    }
  }, [deviceId, getTenantInfo]);

  useEffect(() => {
    if (deviceId) loadDevice();
  }, [deviceId, loadDevice]);

  // Fetch device groups when site changes
  useEffect(() => {
    if (!form.site_id) {
      setDeviceGroups([]);
      return;
    }
    const info = getTenantInfo();
    if (!info) return;

    fetch(`/api/v1/tenants/${info.tenant}/sites/${form.site_id}/device-groups`, {
      headers: { Authorization: `Bearer ${info.token}` },
    })
      .then(res => res.ok ? res.json() : { data: [] })
      .then(data => setDeviceGroups(data.data || []))
      .catch(() => setDeviceGroups([]));
  }, [form.site_id, getTenantInfo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) {
      setError('Device name is required');
      return;
    }

    const info = getTenantInfo();
    if (!info) return;

    try {
      setSaving(true);
      setError(null);

      const body: Record<string, any> = {
        name: form.name,
        device_type_id: form.device_type_id || undefined,
        attributes: {
          description: form.description || undefined,
          serial_number: form.serial_number || undefined,
          tags: form.tags.length > 0 ? form.tags : undefined,
          latitude: form.latitude ? parseFloat(form.latitude) : undefined,
          longitude: form.longitude ? parseFloat(form.longitude) : undefined,
        },
        firmware_version: form.firmware_version || undefined,
        hardware_version: form.hardware_version || undefined,
        site_id: form.site_id || undefined,
        device_group_id: form.device_group_id || undefined,
      };

      // LoRaWAN fields
      if (form.lorawan_dev_eui) body.lorawan_dev_eui = form.lorawan_dev_eui;
      if (form.chirpstack_app_id) body.chirpstack_app_id = form.chirpstack_app_id;
      if (form.device_profile_id) body.device_profile_id = form.device_profile_id;

      const response = await fetch(
        `/api/v1/tenants/${info.tenant}/devices/${deviceId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${info.token}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to update device');
      }

      toast.success('Device Updated', `${form.name} has been updated successfully`);
      router.push(`/dashboard/devices/${deviceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update device');
      toast.error('Update Failed', err instanceof Error ? err.message : 'Failed to update device');
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    if (form.newTag.trim() && !form.tags.includes(form.newTag.trim())) {
      setForm(prev => ({
        ...prev,
        tags: [...prev.tags, prev.newTag.trim()],
        newTag: '',
      }));
    }
  };

  const removeTag = (tag: string) => {
    setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const selectedType = deviceTypes.find(dt => dt.id === form.device_type_id);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 ml-64 p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin mb-4">
              <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full"></div>
            </div>
            <p className="text-gray-600 font-medium">Loading device...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Edit Device</h1>
              <p className="text-gray-600 mt-1">
                Update settings for <span className="font-medium">{device?.name}</span>
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
          {/* Basic Info */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Device Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
                  <input
                    type="text"
                    value={form.serial_number}
                    onChange={e => setForm(prev => ({ ...prev, serial_number: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Device Type</label>
                  <select
                    value={form.device_type_id}
                    onChange={e => setForm(prev => ({ ...prev, device_type_id: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  >
                    {deviceTypes.map(dt => (
                      <option key={dt.id} value={dt.id}>{dt.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {form.tags.map(tag => (
                    <span key={tag} className="px-2 py-1 bg-gray-100 rounded text-sm text-gray-700 flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="ml-1 text-gray-500 hover:text-gray-900">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.newTag}
                    onChange={e => setForm(prev => ({ ...prev, newTag: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    placeholder="Add a tag..."
                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  />
                  <button type="button" onClick={addTag} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Firmware & Hardware */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Firmware & Hardware</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Firmware Version</label>
                <input
                  type="text"
                  value={form.firmware_version}
                  onChange={e => setForm(prev => ({ ...prev, firmware_version: e.target.value }))}
                  placeholder="e.g., 1.2.3"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hardware Version</label>
                <input
                  type="text"
                  value={form.hardware_version}
                  onChange={e => setForm(prev => ({ ...prev, hardware_version: e.target.value }))}
                  placeholder="e.g., rev2.1"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
            </div>
          </div>

          {/* Connectivity */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Connectivity</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Device EUI (DevEUI)</label>
                <input
                  type="text"
                  value={form.lorawan_dev_eui}
                  onChange={e => setForm(prev => ({ ...prev, lorawan_dev_eui: e.target.value }))}
                  placeholder="70B3D57ED005XXXX"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
                <p className="text-xs text-gray-500 mt-1">16-character hexadecimal identifier for LoRaWAN devices</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ChirpStack App ID</label>
                  <input
                    type="text"
                    value={form.chirpstack_app_id}
                    onChange={e => setForm(prev => ({ ...prev, chirpstack_app_id: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Device Profile ID</label>
                  <input
                    type="text"
                    value={form.device_profile_id}
                    onChange={e => setForm(prev => ({ ...prev, device_profile_id: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Placement */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Placement</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building className="w-4 h-4 inline mr-1" /> Site
                </label>
                <select
                  value={form.site_id}
                  onChange={e => setForm(prev => ({ ...prev, site_id: e.target.value, device_group_id: '' }))}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                >
                  <option value="">No site assigned</option>
                  {sites.map(site => (
                    <option key={site.id} value={site.id}>{site.name}</option>
                  ))}
                </select>
              </div>

              {form.site_id && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Layers className="w-4 h-4 inline mr-1" /> Device Group
                  </label>
                  <select
                    value={form.device_group_id}
                    onChange={e => setForm(prev => ({ ...prev, device_group_id: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  >
                    <option value="">No group assigned</option>
                    {deviceGroups.map(group => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <MapPin className="w-4 h-4 inline mr-1" /> GPS Location
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={form.latitude}
                      onChange={e => setForm(prev => ({ ...prev, latitude: e.target.value }))}
                      placeholder="-33.9249"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={form.longitude}
                      onChange={e => setForm(prev => ({ ...prev, longitude: e.target.value }))}
                      placeholder="18.4241"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 pb-8">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white rounded-lg transition-colors font-medium"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
