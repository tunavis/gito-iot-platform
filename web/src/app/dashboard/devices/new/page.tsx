'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import {
  ArrowLeft,
  Plus,
  Cpu,
  Thermometer,
  Radio,
  ToggleRight,
  MapPin,
  Zap,
  Camera,
  Settings,
  Check,
  AlertCircle,
  ChevronRight,
  Wifi,
  Tag,
  Building,
  Layers,
} from "lucide-react";

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
  };
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

// Steps
type Step = "select-type" | "device-info" | "connectivity" | "placement" | "review";

const STEPS: { id: Step; label: string }[] = [
  { id: "select-type", label: "Device Type" },
  { id: "device-info", label: "Device Info" },
  { id: "connectivity", label: "Connectivity" },
  { id: "placement", label: "Placement" },
  { id: "review", label: "Review" },
];

export default function NewDevicePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("select-type");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [deviceTypes, setDeviceTypes] = useState<DeviceType[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);

  // Form State
  const [selectedType, setSelectedType] = useState<DeviceType | null>(null);
  const [deviceInfo, setDeviceInfo] = useState({
    name: "",
    serial_number: "",
    description: "",
    tags: [] as string[],
    newTag: "",
  });
  const [connectivity, setConnectivity] = useState({
    dev_eui: "",
    app_key: "",
    ttn_app_id: "",
    mqtt_client_id: "",
  });
  const [placement, setPlacement] = useState({
    site_id: "",
    device_group_id: "",
    latitude: "",
    longitude: "",
  });

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/auth/login');
        return;
      }
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const [typesRes, sitesRes] = await Promise.all([
        fetch(`/api/v1/tenants/${tenant}/device-types?is_active=true`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/v1/tenants/${tenant}/sites`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (typesRes.ok) {
        const typesData = await typesRes.json();
        setDeviceTypes(typesData.data || []);
      }

      if (sitesRes.ok) {
        const sitesData = await sitesRes.json();
        setSites(sitesData.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch device groups when site changes
  useEffect(() => {
    if (placement.site_id) {
      fetchDeviceGroups(placement.site_id);
    } else {
      setDeviceGroups([]);
    }
  }, [placement.site_id]);

  const fetchDeviceGroups = async (siteId: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const res = await fetch(
        `/api/v1/tenants/${tenant}/sites/${siteId}/device-groups`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.ok) {
        const data = await res.json();
        setDeviceGroups(data.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch device groups:", err);
    }
  };

  const handleSubmit = async () => {
    if (!selectedType) {
      setError("Please select a device type");
      return;
    }

    if (!deviceInfo.name.trim()) {
      setError("Device name is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/auth/login');
        return;
      }
      const decoded = JSON.parse(atob(token.split('.')[1]));
      const tenant = decoded.tenant_id;

      const body: any = {
        name: deviceInfo.name,
        device_type_id: selectedType.id,
        device_type: selectedType.category, // Legacy field
        description: deviceInfo.description || undefined,
        serial_number: deviceInfo.serial_number || undefined,
        tags: deviceInfo.tags.length > 0 ? deviceInfo.tags : undefined,
        site_id: placement.site_id || undefined,
        device_group_id: placement.device_group_id || undefined,
        latitude: placement.latitude ? parseFloat(placement.latitude) : undefined,
        longitude: placement.longitude ? parseFloat(placement.longitude) : undefined,
      };

      // Add connectivity based on protocol
      if (selectedType.connectivity?.protocol === 'lorawan') {
        if (connectivity.dev_eui) body.dev_eui = connectivity.dev_eui;
        if (connectivity.app_key) body.app_key = connectivity.app_key;
        if (connectivity.ttn_app_id) body.ttn_app_id = connectivity.ttn_app_id;
      } else if (selectedType.connectivity?.protocol === 'mqtt') {
        if (connectivity.mqtt_client_id) body.mqtt_client_id = connectivity.mqtt_client_id;
      }

      const response = await fetch(`/api/v1/tenants/${tenant}/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to create device");
      }

      const result = await response.json();
      router.push(`/dashboard/devices/${result.data?.id || ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create device");
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    if (deviceInfo.newTag.trim() && !deviceInfo.tags.includes(deviceInfo.newTag.trim())) {
      setDeviceInfo({
        ...deviceInfo,
        tags: [...deviceInfo.tags, deviceInfo.newTag.trim()],
        newTag: "",
      });
    }
  };

  const removeTag = (tag: string) => {
    setDeviceInfo({
      ...deviceInfo,
      tags: deviceInfo.tags.filter((t) => t !== tag),
    });
  };

  const canProceed = () => {
    switch (step) {
      case "select-type":
        return selectedType !== null;
      case "device-info":
        return deviceInfo.name.trim() !== "";
      case "connectivity":
        return true; // Optional
      case "placement":
        return true; // Optional
      case "review":
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const currentIndex = STEPS.findIndex((s) => s.id === step);
    if (currentIndex < STEPS.length - 1) {
      setStep(STEPS[currentIndex + 1].id);
    }
  };

  const prevStep = () => {
    const currentIndex = STEPS.findIndex((s) => s.id === step);
    if (currentIndex > 0) {
      setStep(STEPS[currentIndex - 1].id);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 ml-64 p-8">
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading...</div>
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
              <h1 className="text-3xl font-bold text-gray-900">Register New Device</h1>
              <p className="text-gray-600 mt-1">Add a new device to your IoT fleet</p>
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-6">
          <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            {STEPS.map((s, index) => {
              const currentIndex = STEPS.findIndex((st) => st.id === step);
              const isCompleted = index < currentIndex;
              const isCurrent = s.id === step;

              return (
                <React.Fragment key={s.id}>
                  <button
                    onClick={() => index <= currentIndex && setStep(s.id)}
                    disabled={index > currentIndex}
                    className={`flex items-center gap-2 ${
                      index > currentIndex ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                        isCompleted
                          ? 'bg-green-500 text-gray-900'
                          : isCurrent
                          ? 'bg-primary-600 text-gray-900'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
                    </div>
                    <span
                      className={`text-sm hidden sm:block ${
                        isCurrent ? 'text-gray-900 font-medium' : 'text-gray-500'
                      }`}
                    >
                      {s.label}
                    </span>
                  </button>
                  {index < STEPS.length - 1 && (
                    <div
                      className={`flex-1 h-px mx-2 ${
                        index < currentIndex ? 'bg-green-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

        {/* Content */}
        <div className="max-w-4xl">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* Step: Select Device Type */}
        {step === 'select-type' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Select Device Type</h2>
              <p className="text-sm text-gray-600">
                Choose a device type template that matches your device. This determines the data
                model and capabilities.
              </p>
            </div>

            {deviceTypes.length === 0 ? (
              <div className="text-center py-12 bg-white border border-gray-200 rounded-lg shadow-sm">
                <Cpu className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">No device types found</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Create a device type template first
                </p>
                <button
                  onClick={() => router.push("/dashboard/device-types/new")}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-gray-900 rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                  Create Device Type
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {deviceTypes.map((dt) => (
                  <button
                    key={dt.id}
                    onClick={() => setSelectedType(dt)}
                    className={`p-4 text-left rounded-lg shadow-sm border transition-all ${
                      selectedType?.id === dt.id
                        ? "bg-indigo-500/10 border-primary-500/50"
                        : "bg-white border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: `${dt.color}20`,
                          color: dt.color,
                        }}
                      >
                        {categoryIcons[dt.category] || <Cpu className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900">{dt.name}</h3>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {dt.manufacturer || "Generic"} •{" "}
                          {dt.connectivity?.protocol?.toUpperCase() || "MQTT"}
                        </p>
                        {dt.description && (
                          <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                            {dt.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(dt.data_model || []).slice(0, 3).map((field) => (
                            <span
                              key={field.name}
                              className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600"
                            >
                              {field.name}
                            </span>
                          ))}
                          {(dt.data_model?.length || 0) > 3 && (
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-500">
                              +{dt.data_model.length - 3}
                            </span>
                          )}
                        </div>
                      </div>
                      {selectedType?.id === dt.id && (
                        <div className="w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center">
                          <Check className="w-4 h-4 text-gray-900" />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step: Device Info */}
        {step === "device-info" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-2">Device Information</h2>
              <p className="text-sm text-gray-600">
                Enter the basic information for your device.
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Device Name *
                </label>
                <input
                  type="text"
                  value={deviceInfo.name}
                  onChange={(e) => setDeviceInfo({ ...deviceInfo, name: e.target.value })}
                  placeholder="e.g., Temperature Sensor - Building A"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Serial Number
                </label>
                <input
                  type="text"
                  value={deviceInfo.serial_number}
                  onChange={(e) =>
                    setDeviceInfo({ ...deviceInfo, serial_number: e.target.value })
                  }
                  placeholder="e.g., SN-2024-001234"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={deviceInfo.description}
                  onChange={(e) =>
                    setDeviceInfo({ ...deviceInfo, description: e.target.value })
                  }
                  placeholder="Optional description or notes about this device..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {deviceInfo.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-gray-100 rounded text-sm text-gray-700 flex items-center gap-1"
                    >
                      <Tag className="w-3 h-3" />
                      {tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="ml-1 text-gray-500 hover:text-gray-900"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={deviceInfo.newTag}
                    onChange={(e) => setDeviceInfo({ ...deviceInfo, newTag: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                    placeholder="Add a tag..."
                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  />
                  <button
                    type="button"
                    onClick={addTag}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-100 rounded-lg"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step: Connectivity */}
        {step === "connectivity" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-2">Connectivity Settings</h2>
              <p className="text-sm text-gray-600">
                Configure how this device connects to the platform.
                {selectedType?.connectivity?.protocol && (
                  <span className="ml-1 text-primary-400">
                    Protocol: {selectedType.connectivity.protocol.toUpperCase()}
                  </span>
                )}
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-4">
              {selectedType?.connectivity?.protocol === "lorawan" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Device EUI (DevEUI)
                    </label>
                    <input
                      type="text"
                      value={connectivity.dev_eui}
                      onChange={(e) =>
                        setConnectivity({ ...connectivity, dev_eui: e.target.value })
                      }
                      placeholder="e.g., 70B3D57ED005XXXX"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      16-character hexadecimal identifier for your LoRaWAN device
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Application Key (AppKey)
                    </label>
                    <input
                      type="password"
                      value={connectivity.app_key}
                      onChange={(e) =>
                        setConnectivity({ ...connectivity, app_key: e.target.value })
                      }
                      placeholder="32-character hex key"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      TTN Application ID
                    </label>
                    <input
                      type="text"
                      value={connectivity.ttn_app_id}
                      onChange={(e) =>
                        setConnectivity({ ...connectivity, ttn_app_id: e.target.value })
                      }
                      placeholder="e.g., my-ttn-application"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    MQTT Client ID
                  </label>
                  <input
                    type="text"
                    value={connectivity.mqtt_client_id}
                    onChange={(e) =>
                      setConnectivity({ ...connectivity, mqtt_client_id: e.target.value })
                    }
                    placeholder="Optional custom MQTT client identifier"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    If left empty, the device ID will be used as the MQTT client ID
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step: Placement */}
        {step === "placement" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-2">Device Placement</h2>
              <p className="text-sm text-gray-600">
                Assign the device to a site and group for organization.
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building className="w-4 h-4 inline mr-1" />
                  Site
                </label>
                <select
                  value={placement.site_id}
                  onChange={(e) =>
                    setPlacement({ ...placement, site_id: e.target.value, device_group_id: "" })
                  }
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                >
                  <option value="">No site assigned</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>

              {placement.site_id && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Layers className="w-4 h-4 inline mr-1" />
                    Device Group
                  </label>
                  <select
                    value={placement.device_group_id}
                    onChange={(e) =>
                      setPlacement({ ...placement, device_group_id: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  >
                    <option value="">No group assigned</option>
                    {deviceGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  GPS Location (Optional)
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={placement.latitude}
                      onChange={(e) =>
                        setPlacement({ ...placement, latitude: e.target.value })
                      }
                      placeholder="-33.9249"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={placement.longitude}
                      onChange={(e) =>
                        setPlacement({ ...placement, longitude: e.target.value })
                      }
                      placeholder="18.4241"
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step: Review */}
        {step === "review" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-2">Review & Create</h2>
              <p className="text-sm text-gray-600">
                Review the device configuration before creating.
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              {/* Device Type */}
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Device Type</h3>
                {selectedType && (
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{
                        backgroundColor: `${selectedType.color}20`,
                        color: selectedType.color,
                      }}
                    >
                      {categoryIcons[selectedType.category] || <Cpu className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{selectedType.name}</div>
                      <div className="text-xs text-gray-600">
                        {selectedType.manufacturer} •{" "}
                        {selectedType.connectivity?.protocol?.toUpperCase()}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Device Info */}
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">
                  Device Information
                </h3>
                <dl className="space-y-2">
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Name</dt>
                    <dd className="text-gray-900">{deviceInfo.name || "-"}</dd>
                  </div>
                  {deviceInfo.serial_number && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Serial Number</dt>
                      <dd className="text-gray-900 font-mono text-sm">
                        {deviceInfo.serial_number}
                      </dd>
                    </div>
                  )}
                  {deviceInfo.tags.length > 0 && (
                    <div className="flex justify-between items-start">
                      <dt className="text-gray-600">Tags</dt>
                      <dd className="flex flex-wrap gap-1 justify-end">
                        {deviceInfo.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Connectivity */}
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Connectivity</h3>
                <dl className="space-y-2">
                  {selectedType?.connectivity?.protocol === "lorawan" ? (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-gray-600">DevEUI</dt>
                        <dd className="text-gray-900 font-mono text-sm">
                          {connectivity.dev_eui || "Not set"}
                        </dd>
                      </div>
                      {connectivity.ttn_app_id && (
                        <div className="flex justify-between">
                          <dt className="text-gray-600">TTN App</dt>
                          <dd className="text-gray-900">{connectivity.ttn_app_id}</dd>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Protocol</dt>
                      <dd className="text-gray-900">MQTT</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Placement */}
              <div className="p-4">
                <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Placement</h3>
                <dl className="space-y-2">
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Site</dt>
                    <dd className="text-gray-900">
                      {sites.find((s) => s.id === placement.site_id)?.name || "Not assigned"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Group</dt>
                    <dd className="text-gray-900">
                      {deviceGroups.find((g) => g.id === placement.device_group_id)?.name ||
                        "Not assigned"}
                    </dd>
                  </div>
                  {placement.latitude && placement.longitude && (
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Location</dt>
                      <dd className="text-gray-900 font-mono text-sm">
                        {placement.latitude}, {placement.longitude}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-6 mt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={step === 'select-type' ? () => router.back() : prevStep}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            {step === 'select-type' ? 'Cancel' : 'Back'}
          </button>

          {step === 'review' ? (
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white rounded-lg transition-colors"
            >
              {saving ? 'Creating...' : 'Create Device'}
              <Wifi className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={nextStep}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
        </div>
      </main>
    </div>
  );
}
