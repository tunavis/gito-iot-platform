"use client";

import { X, Check, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

interface TelemetryField {
  type: string;
  unit?: string;
  min?: number;
  max?: number;
  description?: string;
}

interface DeviceType {
  id: string;
  name: string;
  category: string;
  icon: string;
  color: string;
  data_model?: Record<string, TelemetryField>;
}

interface Device {
  id: string;
  name: string;
  device_type_id: string;
  device_type?: DeviceType;
}

interface DeviceBindingModalProps {
  isOpen: boolean;
  widgetType: string;
  currentBindings: Array<{
    device_id: string;
    device_name?: string;
    metric: string;
    alias?: string;
  }>;
  onClose: () => void;
  onSave: (bindings: Array<{
    device_id: string;
    device_name?: string;
    metric: string;
    alias?: string;
  }>) => void;
}

export default function DeviceBindingModal({
  isOpen,
  widgetType,
  currentBindings,
  onClose,
  onSave,
}: DeviceBindingModalProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  const [alias, setAlias] = useState<string>("");
  const [bindings, setBindings] = useState(currentBindings);
  const [recentMetrics, setRecentMetrics] = useState<string[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  const multiDevice = widgetType === "chart"; // Charts support multiple devices

  useEffect(() => {
    if (isOpen) {
      fetchDevices();
      setBindings(currentBindings);
    }
  }, [isOpen, currentBindings]);

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/devices?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch devices");
      }

      const result = await response.json();
      const deviceList = result.data || [];

      // API now returns nested device_type via joinedload - no need to fetch separately
      setDevices(deviceList);
    } catch (error) {
      console.error("Error fetching devices:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const availableMetrics = selectedDevice?.device_type?.data_model || {};

  // Fetch recent telemetry to discover actual metrics
  useEffect(() => {
    if (selectedDeviceId) {
      fetchRecentMetrics(selectedDeviceId);
    } else {
      setRecentMetrics([]);
    }
  }, [selectedDeviceId]);

  const fetchRecentMetrics = async (deviceId: string) => {
    try {
      setLoadingMetrics(true);
      const token = localStorage.getItem("auth_token");
      if (!token) return;

      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      // Get last 24 hours of data (increased window to find seeded data)
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

      const params = new URLSearchParams({
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        per_page: "1",
      });

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const result = await response.json();
        const telemetryData = result.data || [];

        if (telemetryData.length > 0) {
          // Extract all keys except system fields, and exclude null/undefined values
          const dataPoint = telemetryData[0];
          const directMetrics = Object.keys(dataPoint).filter(
            (key) =>
              !["timestamp", "device_id", "tenant_id", "id", "rssi", "payload"].includes(key) &&
              dataPoint[key] !== null &&
              dataPoint[key] !== undefined
          );

          // Also extract metrics from payload JSONB if it exists
          const payloadMetrics = dataPoint.payload
            ? Object.keys(dataPoint.payload)
            : [];

          // Combine both sources
          const allMetrics = [...new Set([...directMetrics, ...payloadMetrics])];
          setRecentMetrics(allMetrics);
        } else {
          setRecentMetrics([]);
        }
      } else {
        console.error("Telemetry fetch failed:", response.status);
        setRecentMetrics([]);
      }
    } catch (error) {
      console.error("Error fetching metrics:", error);
      setRecentMetrics([]);
    } finally {
      setLoadingMetrics(false);
    }
  };

  const handleAddBinding = () => {
    if (!selectedDeviceId || !selectedMetric) return;

    const metricDetails = getMetricDetails(selectedMetric);
    const newBinding = {
      device_id: selectedDeviceId,
      device_name: selectedDevice?.name || '',
      metric: selectedMetric,
      alias: alias || selectedMetric,
      unit: metricDetails.unit,
      min: metricDetails.min,
      max: metricDetails.max,
    };

    if (multiDevice) {
      setBindings([...bindings, newBinding]);
    } else {
      setBindings([newBinding]);
    }

    // Reset form
    setSelectedDeviceId("");
    setSelectedMetric("");
    setAlias("");
  };

  const handleRemoveBinding = (index: number) => {
    setBindings(bindings.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave(bindings);
    onClose();
  };

  const getMetricDetails = (metricKey: string): TelemetryField => {
    return availableMetrics[metricKey] || { type: "number" };
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Bind Devices to Widget
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {multiDevice
                ? "Select multiple devices and metrics to compare"
                : "Select a device and metric to display"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              {/* Add Binding Form */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">
                  Add Device Binding
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {/* Device Selector */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Device
                    </label>
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => {
                        setSelectedDeviceId(e.target.value);
                        setSelectedMetric(""); // Reset metric when device changes
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select a device...</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name}
                          {device.device_type?.name && ` (${device.device_type.name})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Metric Selector - Auto-discovered from telemetry */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Metric
                    </label>
                    {loadingMetrics ? (
                      <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm">
                        Loading metrics...
                      </div>
                    ) : recentMetrics.length > 0 ? (
                      <select
                        value={selectedMetric}
                        onChange={(e) => setSelectedMetric(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Select a metric...</option>
                        {recentMetrics.map((metricKey) => {
                          const schemaInfo = availableMetrics[metricKey];
                          return (
                            <option key={metricKey} value={metricKey}>
                              {metricKey}
                              {schemaInfo?.unit && ` (${schemaInfo.unit})`}
                              {schemaInfo?.description && ` - ${schemaInfo.description}`}
                            </option>
                          );
                        })}
                      </select>
                    ) : selectedDeviceId ? (
                      <div className="w-full px-3 py-2 border border-orange-300 rounded-lg bg-orange-50 text-orange-700 text-sm">
                        No recent telemetry data found for this device
                      </div>
                    ) : (
                      <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm">
                        Select a device first
                      </div>
                    )}
                    {recentMetrics.length > 0 && (
                      <p className="text-xs text-green-600 mt-1">
                        ✓ {recentMetrics.length} metrics found from device telemetry
                      </p>
                    )}
                  </div>
                </div>

                {/* Alias (Optional) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Display Alias (Optional)
                  </label>
                  <input
                    type="text"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder={selectedMetric || "e.g., Main Line Temperature"}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Metric Details */}
                {selectedMetric && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                    <h4 className="text-xs font-semibold text-blue-900 mb-2">
                      Metric Details
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-blue-700 font-medium">Type:</span>{" "}
                        <span className="text-blue-900">{getMetricDetails(selectedMetric).type}</span>
                      </div>
                      {getMetricDetails(selectedMetric).unit && (
                        <div>
                          <span className="text-blue-700 font-medium">Unit:</span>{" "}
                          <span className="text-blue-900">{getMetricDetails(selectedMetric).unit}</span>
                        </div>
                      )}
                      {getMetricDetails(selectedMetric).min !== undefined && (
                        <div>
                          <span className="text-blue-700 font-medium">Min:</span>{" "}
                          <span className="text-blue-900">{getMetricDetails(selectedMetric).min}</span>
                        </div>
                      )}
                      {getMetricDetails(selectedMetric).max !== undefined && (
                        <div>
                          <span className="text-blue-700 font-medium">Max:</span>{" "}
                          <span className="text-blue-900">{getMetricDetails(selectedMetric).max}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleAddBinding}
                  disabled={!selectedDeviceId || !selectedMetric}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Add Binding
                </button>
              </div>

              {/* Current Bindings */}
              {bindings.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Current Bindings ({bindings.length})
                  </h3>
                  <div className="space-y-2">
                    {bindings.map((binding, index) => {
                      const device = devices.find((d) => d.id === binding.device_id);
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
                        >
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {device?.name || binding.device_id}
                            </div>
                            <div className="text-xs text-gray-500">
                              {binding.alias || binding.metric} • {binding.metric}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveBinding(index)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {bindings.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No devices bound yet. Add a binding above to get started.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Check className="w-4 h-4" />
            Save Bindings
          </button>
        </div>
      </div>
    </div>
  );
}
