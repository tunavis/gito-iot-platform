'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Cpu,
  Thermometer,
  Radio,
  ToggleRight,
  MapPin,
  Zap,
  Camera,
  Settings,
  GripVertical,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";

// Types
interface DataModelField {
  name: string;
  type: string;
  unit: string;
  description: string;
  min_value?: number;
  max_value?: number;
  required: boolean;
}

interface DefaultSettings {
  heartbeat_interval: number;
  telemetry_interval: number;
  offline_threshold: number;
}

interface Connectivity {
  protocol: string;
  lorawan_class?: string;
  mqtt_topic_template?: string;
}

interface DeviceTypeForm {
  name: string;
  description: string;
  manufacturer: string;
  model: string;
  category: string;
  icon: string;
  color: string;
  data_model: DataModelField[];
  capabilities: string[];
  default_settings: DefaultSettings;
  connectivity: Connectivity;
  is_active: boolean;
}

// Constants
const CATEGORIES = [
  { value: "sensor", label: "Sensor", icon: Thermometer },
  { value: "gateway", label: "Gateway", icon: Radio },
  { value: "actuator", label: "Actuator", icon: ToggleRight },
  { value: "tracker", label: "Tracker", icon: MapPin },
  { value: "meter", label: "Meter", icon: Zap },
  { value: "camera", label: "Camera", icon: Camera },
  { value: "controller", label: "Controller", icon: Settings },
  { value: "other", label: "Other", icon: Cpu },
];

const CAPABILITIES = [
  { value: "telemetry", label: "Telemetry", description: "Sends sensor/metric data" },
  { value: "commands", label: "Commands", description: "Accepts remote commands" },
  { value: "firmware_ota", label: "Firmware OTA", description: "Over-the-air updates" },
  { value: "remote_config", label: "Remote Config", description: "Remote configuration" },
  { value: "location", label: "Location", description: "GPS/location tracking" },
  { value: "alerts", label: "Alerts", description: "Device-side alerts" },
  { value: "file_transfer", label: "File Transfer", description: "Upload/download files" },
  { value: "edge_compute", label: "Edge Compute", description: "Edge processing" },
];

const FIELD_TYPES = [
  { value: "float", label: "Float" },
  { value: "integer", label: "Integer" },
  { value: "boolean", label: "Boolean" },
  { value: "string", label: "String" },
  { value: "timestamp", label: "Timestamp" },
  { value: "json", label: "JSON Object" },
  { value: "array", label: "Array" },
];

const PROTOCOLS = [
  { value: "mqtt", label: "MQTT" },
  { value: "lorawan", label: "LoRaWAN" },
  { value: "http", label: "HTTP/REST" },
  { value: "coap", label: "CoAP" },
  { value: "websocket", label: "WebSocket" },
  { value: "modbus", label: "Modbus" },
];

const COLORS = [
  "#10b981", // Green
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#ec4899", // Pink
  "#14b8a6", // Teal
  "#6366f1", // Indigo
];

const DEFAULT_FORM: DeviceTypeForm = {
  name: "",
  description: "",
  manufacturer: "",
  model: "",
  category: "sensor",
  icon: "thermometer",
  color: "#10b981",
  data_model: [],
  capabilities: ["telemetry"],
  default_settings: {
    heartbeat_interval: 60,
    telemetry_interval: 300,
    offline_threshold: 900,
  },
  connectivity: {
    protocol: "mqtt",
  },
  is_active: true,
};

export default function DeviceTypeFormPage() {
  const router = useRouter();
  const params = useParams();
  const isEditMode = params.id && params.id !== "new";

  const [form, setForm] = useState<DeviceTypeForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    basic: true,
    dataModel: true,
    capabilities: true,
    settings: false,
    connectivity: false,
  });

  // Load existing device type if editing
  useEffect(() => {
    if (isEditMode) {
      loadDeviceType();
    }
  }, [isEditMode]);

  const loadDeviceType = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('auth_token');
      if (!token) {
        router.push('/auth/login');
        return;
      }
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenant}/device-types/${params.id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) throw new Error("Failed to load device type");

      const result = await response.json();
      const dt = result.data;

      setForm({
        name: dt.name || "",
        description: dt.description || "",
        manufacturer: dt.manufacturer || "",
        model: dt.model || "",
        category: dt.category || "sensor",
        icon: dt.icon || "thermometer",
        color: dt.color || "#10b981",
        data_model: (dt.data_model || []).map((f: any) => ({
          name: f.name || "",
          type: f.type || "float",
          unit: f.unit || "",
          description: f.description || "",
          min_value: f.min,
          max_value: f.max,
          required: f.required || false,
        })),
        capabilities: dt.capabilities || [],
        default_settings: dt.default_settings || DEFAULT_FORM.default_settings,
        connectivity: dt.connectivity || DEFAULT_FORM.connectivity,
        is_active: dt.is_active ?? true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.name.trim()) {
      setError("Name is required");
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
      const payload = JSON.parse(atob(token.split('.')[1]));
      const tenant = payload.tenant_id;

      const url = isEditMode
        ? `/api/v1/tenants/${tenant}/device-types/${params.id}`
        : `/api/v1/tenants/${tenant}/device-types`;

      const response = await fetch(url, {
        method: isEditMode ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to save device type");
      }

      router.push("/dashboard/device-types");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Data Model Field Handlers
  const addDataModelField = () => {
    setForm({
      ...form,
      data_model: [
        ...form.data_model,
        { name: "", type: "float", unit: "", description: "", required: false },
      ],
    });
  };

  const updateDataModelField = (index: number, updates: Partial<DataModelField>) => {
    const newFields = [...form.data_model];
    newFields[index] = { ...newFields[index], ...updates };
    setForm({ ...form, data_model: newFields });
  };

  const removeDataModelField = (index: number) => {
    setForm({
      ...form,
      data_model: form.data_model.filter((_, i) => i !== index),
    });
  };

  // Toggle capability
  const toggleCapability = (cap: string) => {
    setForm({
      ...form,
      capabilities: form.capabilities.includes(cap)
        ? form.capabilities.filter((c) => c !== cap)
        : [...form.capabilities, cap],
    });
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections({ ...expandedSections, [section]: !expandedSections[section] });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 ml-64 p-8">
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading device type...</div>
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
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  {isEditMode ? 'Edit Device Type' : 'Create Device Type'}
                </h1>
                <p className="text-gray-600 mt-1">
                  Define a template for devices with data model and capabilities
                </p>
              </div>
            </div>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-primary-400 transition-colors font-medium flex items-center gap-2 shadow-sm"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Device Type'}
            </button>
          </div>
        </div>

        {/* Form Container */}
        <div className="max-w-4xl">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('basic')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
            >
              <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>
              {expandedSections.basic ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {expandedSections.basic && (
              <div className="px-6 pb-6 border-t border-gray-200 pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g., Environmental Sensor"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Describe what this device type is used for..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Manufacturer
                    </label>
                    <input
                      type="text"
                      value={form.manufacturer}
                      onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                      placeholder="e.g., Acme Devices"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Model
                    </label>
                    <input
                      type="text"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      placeholder="e.g., ES-100"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                {/* Color Picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Color
                  </label>
                  <div className="flex gap-2">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setForm({ ...form, color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          form.color === color
                            ? 'border-gray-900 scale-110 ring-2 ring-offset-2 ring-gray-400'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Active Toggle */}
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                  <span className="text-sm text-gray-700">Active</span>
                </div>
              </div>
            )}
          </div>

          {/* Data Model */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('dataModel')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">Data Model</h2>
                <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                  {form.data_model.length} fields
                </span>
              </div>
              {expandedSections.dataModel ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {expandedSections.dataModel && (
              <div className="px-6 pb-6 border-t border-gray-200 pt-4 space-y-4">
                <p className="text-sm text-gray-600">
                  Define the telemetry fields this device type sends. This creates a schema for
                  validating and displaying device data.
                </p>

                {form.data_model.map((field, index) => (
                  <div
                    key={index}
                    className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-gray-500">
                        <GripVertical className="w-4 h-4" />
                        <span className="text-sm font-medium">Field #{index + 1}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDataModelField(index)}
                        className="p-1.5 hover:bg-red-100 rounded text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Name *</label>
                        <input
                          type="text"
                          value={field.name}
                          onChange={(e) =>
                            updateDataModelField(index, { name: e.target.value })
                          }
                          placeholder="temperature"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Type</label>
                        <select
                          value={field.type}
                          onChange={(e) =>
                            updateDataModelField(index, { type: e.target.value })
                          }
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Unit</label>
                        <input
                          type="text"
                          value={field.unit}
                          onChange={(e) =>
                            updateDataModelField(index, { unit: e.target.value })
                          }
                          placeholder="°C"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) =>
                              updateDataModelField(index, { required: e.target.checked })
                            }
                            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-xs text-gray-600">Required</span>
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-1">
                        <label className="block text-xs text-gray-500 mb-1">Min Value</label>
                        <input
                          type="number"
                          value={field.min_value ?? ''}
                          onChange={(e) =>
                            updateDataModelField(index, {
                              min_value: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          placeholder="-40"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs text-gray-500 mb-1">Max Value</label>
                        <input
                          type="number"
                          value={field.max_value ?? ''}
                          onChange={(e) =>
                            updateDataModelField(index, {
                              max_value: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          placeholder="85"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs text-gray-500 mb-1">Description</label>
                        <input
                          type="text"
                          value={field.description}
                          onChange={(e) =>
                            updateDataModelField(index, { description: e.target.value })
                          }
                          placeholder="Ambient temperature"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addDataModelField}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:text-primary-600 hover:border-primary-400 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Field
                </button>
              </div>
            )}
          </div>

          {/* Capabilities */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('capabilities')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900">Capabilities</h2>
                <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                  {form.capabilities.length} selected
                </span>
              </div>
              {expandedSections.capabilities ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {expandedSections.capabilities && (
              <div className="px-6 pb-6 border-t border-gray-200 pt-4">
                <p className="text-sm text-gray-600 mb-4">
                  Select the capabilities this device type supports. This determines which
                  features are available for devices of this type.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  {CAPABILITIES.map((cap) => (
                    <label
                      key={cap.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        form.capabilities.includes(cap.value)
                          ? 'bg-primary-50 border-primary-300'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={form.capabilities.includes(cap.value)}
                        onChange={() => toggleCapability(cap.value)}
                        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{cap.label}</div>
                        <div className="text-xs text-gray-500">{cap.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Default Settings */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('settings')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
            >
              <h2 className="text-lg font-semibold text-gray-900">Default Settings</h2>
              {expandedSections.settings ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {expandedSections.settings && (
              <div className="px-6 pb-6 border-t border-gray-200 pt-4 space-y-4">
                <p className="text-sm text-gray-600">
                  Default operational settings for devices of this type. These can be overridden
                  per device.
                </p>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Heartbeat Interval (sec)
                    </label>
                    <input
                      type="number"
                      value={form.default_settings.heartbeat_interval}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          default_settings: {
                            ...form.default_settings,
                            heartbeat_interval: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Telemetry Interval (sec)
                    </label>
                    <input
                      type="number"
                      value={form.default_settings.telemetry_interval}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          default_settings: {
                            ...form.default_settings,
                            telemetry_interval: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Offline Threshold (sec)
                    </label>
                    <input
                      type="number"
                      value={form.default_settings.offline_threshold}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          default_settings: {
                            ...form.default_settings,
                            offline_threshold: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Connectivity */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('connectivity')}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
            >
              <h2 className="text-lg font-semibold text-gray-900">Connectivity</h2>
              {expandedSections.connectivity ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {expandedSections.connectivity && (
              <div className="px-6 pb-6 border-t border-gray-200 pt-4 space-y-4">
                <p className="text-sm text-gray-600">
                  Default connectivity settings for devices of this type.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Protocol
                    </label>
                    <select
                      value={form.connectivity.protocol}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          connectivity: {
                            ...form.connectivity,
                            protocol: e.target.value,
                          },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {PROTOCOLS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {form.connectivity.protocol === 'lorawan' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        LoRaWAN Class
                      </label>
                      <select
                        value={form.connectivity.lorawan_class || 'A'}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            connectivity: {
                              ...form.connectivity,
                              lorawan_class: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="A">Class A</option>
                        <option value="B">Class B</option>
                        <option value="C">Class C</option>
                      </select>
                    </div>
                  )}

                  {form.connectivity.protocol === 'mqtt' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        MQTT Topic Template
                      </label>
                      <input
                        type="text"
                        value={form.connectivity.mqtt_topic_template || ''}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            connectivity: {
                              ...form.connectivity,
                              mqtt_topic_template: e.target.value,
                            },
                          })
                        }
                        placeholder="devices/{device_id}/telemetry"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Submit Button (mobile/bottom) */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-primary-400 transition-colors font-medium flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Device Type'}
            </button>
          </div>
        </form>
        </div>
      </main>
    </div>
  );
}
