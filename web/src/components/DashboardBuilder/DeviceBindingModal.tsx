"use client";

import { X, Check, Loader2, Wifi, BookOpen, AlertTriangle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { formatMetricLabel } from "@/lib/formatMetricLabel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SchemaField {
  type: string;        // float | integer | boolean | string | timestamp | json | array
  unit?: string;
  min?: number;
  max?: number;
  description?: string;
  required?: boolean;
}

interface Device {
  id: string;
  name: string;
  device_type: string;   // name string from devices list API
  device_type_id: string | null;
}

interface Binding {
  device_id: string;
  device_name?: string;
  metric: string;
  alias?: string;
  unit?: string;
  min?: number;
  max?: number;
}

interface DeviceBindingModalProps {
  isOpen: boolean;
  widgetType: string;
  currentBindings: Binding[];
  onClose: () => void;
  onSave: (bindings: Binding[]) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_KEYS = new Set([
  "timestamp", "device_id", "tenant_id", "id", "rssi", "payload",
]);

// Widget types that only make sense with numeric telemetry
const NUMERIC_WIDGET_TYPES = new Set(["gauge", "kpi_card", "stat_group"]);

// Field types considered numeric
const NUMERIC_FIELD_TYPES = new Set(["float", "integer", "number"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAuthContext(): { token: string; tenantId: string } | null {
  const token = localStorage.getItem("auth_token");
  if (!token) return null;
  try {
    const { tenant_id } = JSON.parse(atob(token.split(".")[1]));
    return { token, tenantId: tenant_id };
  } catch {
    return null;
  }
}

function formatFieldType(type: string): string {
  const map: Record<string, string> = {
    float: "Float",
    integer: "Integer",
    boolean: "Boolean",
    string: "String",
    timestamp: "Timestamp",
    json: "JSON",
    array: "Array",
  };
  return map[type] ?? type;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DeviceBindingModal({
  isOpen,
  widgetType,
  currentBindings,
  onClose,
  onSave,
}: DeviceBindingModalProps) {
  const multiDevice = widgetType === "chart";
  const isNumericWidget = NUMERIC_WIDGET_TYPES.has(widgetType);

  // ── State ──────────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);

  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [selectedMetric, setSelectedMetric] = useState("");
  const [alias, setAlias] = useState("");
  const [bindings, setBindings] = useState<Binding[]>(currentBindings);

  // Schema from the device type endpoint (telemetry_schema dict)
  const [schema, setSchema] = useState<Record<string, SchemaField> | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);

  // Keys seen in recent telemetry (for "live" badges)
  const [liveKeys, setLiveKeys] = useState<Set<string>>(new Set());
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);


  // ── Fetch devices on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setBindings(currentBindings);
    fetchDevices();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDevices = async () => {
    const auth = getAuthContext();
    if (!auth) return;
    try {
      setLoadingDevices(true);
      const res = await fetch(
        `/api/v1/tenants/${auth.tenantId}/devices?per_page=200`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (res.ok) {
        const result = await res.json();
        setDevices(result.data ?? []);
      }
    } finally {
      setLoadingDevices(false);
    }
  };

  // ── When device changes: fetch schema + telemetry in parallel ─────────────
  useEffect(() => {
    if (!selectedDeviceId) {
      setSchema(null);
      setLiveKeys(new Set());
      setSelectedMetric("");
      return;
    }
    const device = devices.find((d) => d.id === selectedDeviceId);
    // Parallel: schema from device type + live keys from telemetry
    if (device?.device_type_id) fetchDeviceTypeSchema(device.device_type_id);
    else setSchema({});
    fetchLiveTelemetryKeys(selectedDeviceId);
  }, [selectedDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDeviceTypeSchema = useCallback(async (deviceTypeId: string) => {
    const auth = getAuthContext();
    if (!auth) return;
    setLoadingSchema(true);
    try {
      const res = await fetch(
        `/api/v1/tenants/${auth.tenantId}/device-types/${deviceTypeId}`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (res.ok) {
        const result = await res.json();
        // telemetry_schema is the computed dict: { fieldName: { type, unit, min, max } }
        setSchema(result.data?.telemetry_schema ?? {});
      } else {
        setSchema({});
      }
    } catch {
      setSchema({});
    } finally {
      setLoadingSchema(false);
    }
  }, []);

  const fetchLiveTelemetryKeys = useCallback(async (deviceId: string) => {
    const auth = getAuthContext();
    if (!auth) return;
    setLoadingTelemetry(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 3600 * 1000);
      const params = new URLSearchParams({
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        per_page: "1",
      });
      const res = await fetch(
        `/api/v1/tenants/${auth.tenantId}/devices/${deviceId}/telemetry?${params}`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (res.ok) {
        const result = await res.json();
        const point = result.data?.[0] ?? {};
        const keys = Object.keys(point).filter(
          (k) => !SYSTEM_KEYS.has(k) && point[k] != null
        );
        setLiveKeys(new Set(keys));
      }
    } catch {
      setLiveKeys(new Set());
    } finally {
      setLoadingTelemetry(false);
    }
  }, []);

  // ── Derived metric lists ───────────────────────────────────────────────────
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  // Schema fields: primary source
  const schemaFields = Object.entries(schema ?? {});

  // Extra live metrics discovered from telemetry but NOT declared in schema
  const extraLiveKeys = [...liveKeys].filter(
    (k) => schema !== null && !(k in schema)
  );

  // The field currently selected
  const selectedFieldSchema: SchemaField | undefined = schema?.[selectedMetric];

  // Compatibility warning: non-numeric metric on numeric-only widget
  const compatibilityWarning: string | null = (() => {
    if (!isNumericWidget || !selectedMetric || !selectedFieldSchema) return null;
    const { type } = selectedFieldSchema;
    if (!NUMERIC_FIELD_TYPES.has(type)) {
      return `"${selectedMetric}" is type ${formatFieldType(type)} — ${widgetType.replace("_", " ")} widgets require a numeric field.`;
    }
    return null;
  })();

  const isMetricCompatible = (fieldType: string): boolean => {
    if (!isNumericWidget) return true;
    return NUMERIC_FIELD_TYPES.has(fieldType);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddBinding = () => {
    if (!selectedDeviceId || !selectedMetric) return;

    const newBinding: Binding = {
      device_id: selectedDeviceId,
      device_name: selectedDevice?.name ?? "",
      metric: selectedMetric,
      alias: alias || selectedMetric,
      unit: selectedFieldSchema?.unit,
      min: selectedFieldSchema?.min,
      max: selectedFieldSchema?.max,
    };

    setBindings(multiDevice ? [...bindings, newBinding] : [newBinding]);
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

  if (!isOpen) return null;

  const loadingMetric = loadingSchema || loadingTelemetry;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-th-default">
          <div>
            <h2 className="text-lg font-semibold text-th-primary">
              Bind {multiDevice ? "Devices" : "Device"} to Widget
            </h2>
            <p className="text-xs text-th-secondary mt-0.5">
              {multiDevice
                ? "Select multiple devices and metrics to compare on the chart"
                : "Select a device and the metric this widget will display"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-th-muted hover:text-th-secondary hover:bg-panel rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loadingDevices ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              {/* ── Add binding form ──────────────────────────────────────── */}
              <div className="bg-page border border-th-default rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold text-th-primary">
                  {multiDevice ? "Add binding" : "Select source"}
                </h3>

                {/* Device selector */}
                <div>
                  <label className="block text-xs font-medium text-th-secondary mb-1">
                    Device
                  </label>
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => {
                      setSelectedDeviceId(e.target.value);
                      setSelectedMetric("");
                      setAlias("");
                    }}
                    className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg bg-surface text-sm text-th-primary focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select a device…</option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                        {device.device_type ? ` — ${device.device_type}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Metric selector — schema-first */}
                {selectedDeviceId && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-th-secondary">
                        Metric
                      </label>
                      {loadingMetric && (
                        <span className="flex items-center gap-1 text-xs text-th-muted">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Loading…
                        </span>
                      )}
                    </div>

                    {/* Schema fields exist */}
                    {schemaFields.length > 0 ? (
                      <select
                        value={selectedMetric}
                        onChange={(e) => {
                          setSelectedMetric(e.target.value);
                          setAlias("");
                        }}
                        className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg bg-surface text-sm text-th-primary focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Select a metric…</option>

                        {/* Schema-declared fields */}
                        <optgroup label="Declared fields">
                          {schemaFields.map(([key, field]) => {
                            const live = liveKeys.has(key);
                            const compatible = isMetricCompatible(field.type);
                            return (
                              <option key={key} value={key} disabled={!compatible}>
                                {field.description || formatMetricLabel(key)}
                                {field.unit ? ` (${field.unit})` : ""}
                                {live ? " ✓" : ""}
                                {!compatible ? " — not numeric" : ""}
                              </option>
                            );
                          })}
                        </optgroup>

                        {/* Extra live keys not in schema */}
                        {extraLiveKeys.length > 0 && (
                          <optgroup label="Discovered from telemetry">
                            {extraLiveKeys.map((key) => (
                              <option key={key} value={key}>
                                {formatMetricLabel(key)} (live)
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    ) : loadingSchema ? (
                      <div className="w-full px-3 py-2 border border-th-default rounded-lg bg-page text-sm text-th-muted">
                        Loading schema…
                      </div>
                    ) : (
                      /* No schema — fall back to live telemetry keys */
                      liveKeys.size > 0 ? (
                        <select
                          value={selectedMetric}
                          onChange={(e) => setSelectedMetric(e.target.value)}
                          className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg bg-surface text-sm text-th-primary focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Select a metric…</option>
                          {[...liveKeys].map((key) => (
                            <option key={key} value={key}>{key}</option>
                          ))}
                        </select>
                      ) : !loadingTelemetry ? (
                        /* Last resort: free-text entry */
                        <input
                          type="text"
                          value={selectedMetric}
                          onChange={(e) => setSelectedMetric(e.target.value)}
                          placeholder="Enter metric key manually (e.g. temperature)"
                          className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <div className="w-full px-3 py-2 border border-th-default rounded-lg bg-page text-sm text-th-muted">
                          Loading…
                        </div>
                      )
                    )}

                    {/* Live indicator summary */}
                    {!loadingTelemetry && (
                      <p className="text-xs text-th-muted mt-1 flex items-center gap-1">
                        {liveKeys.size > 0 ? (
                          <>
                            <Wifi className="w-3 h-3 text-green-500" />
                            <span className="text-green-600 font-medium">{liveKeys.size} live</span>
                            {schemaFields.length > 0 && (
                              <span>· {schemaFields.length} declared in schema · ✓ = seen in last 24 h</span>
                            )}
                          </>
                        ) : schemaFields.length > 0 ? (
                          <>
                            <BookOpen className="w-3 h-3 text-blue-500" />
                            <span>Schema-declared fields shown · no telemetry received yet</span>
                          </>
                        ) : null}
                      </p>
                    )}
                  </div>
                )}

                {/* Compatibility warning */}
                {compatibilityWarning && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-800">{compatibilityWarning}</p>
                  </div>
                )}

                {/* Schema detail panel */}
                {selectedMetric && selectedFieldSchema && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <h4 className="text-xs font-semibold text-blue-900 mb-2">
                      Field: <span className="font-mono">{selectedMetric}</span>
                    </h4>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div className="flex gap-1">
                        <span className="text-blue-600 font-medium">Type:</span>
                        <span className="text-blue-900">{formatFieldType(selectedFieldSchema.type)}</span>
                      </div>
                      {selectedFieldSchema.unit && (
                        <div className="flex gap-1">
                          <span className="text-blue-600 font-medium">Unit:</span>
                          <span className="text-blue-900">{selectedFieldSchema.unit}</span>
                        </div>
                      )}
                      {selectedFieldSchema.min !== undefined && (
                        <div className="flex gap-1">
                          <span className="text-blue-600 font-medium">Min:</span>
                          <span className="text-blue-900">{selectedFieldSchema.min}</span>
                        </div>
                      )}
                      {selectedFieldSchema.max !== undefined && (
                        <div className="flex gap-1">
                          <span className="text-blue-600 font-medium">Max:</span>
                          <span className="text-blue-900">{selectedFieldSchema.max}</span>
                        </div>
                      )}
                      {selectedFieldSchema.description && (
                        <div className="col-span-2 flex gap-1">
                          <span className="text-blue-600 font-medium">Note:</span>
                          <span className="text-blue-900">{selectedFieldSchema.description}</span>
                        </div>
                      )}
                      <div className="flex gap-1">
                        <span className="text-blue-600 font-medium">Live:</span>
                        <span className={liveKeys.has(selectedMetric) ? "text-green-700 font-medium" : "text-th-secondary"}>
                          {liveKeys.has(selectedMetric) ? "Yes — seen in last 24 h" : "Not seen recently"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Display alias */}
                {selectedMetric && (
                  <div>
                    <label className="block text-xs font-medium text-th-secondary mb-1">
                      Display name <span className="text-th-muted">(optional — defaults to metric key)</span>
                    </label>
                    <input
                      type="text"
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                      placeholder={selectedFieldSchema?.description || selectedMetric}
                      className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}

                {/* Add button */}
                <button
                  onClick={handleAddBinding}
                  disabled={!selectedDeviceId || !selectedMetric}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-input-border)] disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <Check className="w-4 h-4" />
                  {multiDevice ? "Add to chart" : "Bind device"}
                </button>
              </div>

              {/* ── Current bindings ──────────────────────────────────────── */}
              {bindings.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-th-primary mb-2">
                    Bindings ({bindings.length})
                  </h3>
                  <div className="space-y-2">
                    {bindings.map((binding, index) => {
                      const device = devices.find((d) => d.id === binding.device_id);
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 bg-surface border border-th-default rounded-lg"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-th-primary truncate">
                              {device?.name ?? binding.device_id}
                            </p>
                            <p className="text-xs text-th-secondary truncate">
                              <span className="font-mono">{binding.metric}</span>
                              {binding.alias && binding.alias !== binding.metric && (
                                <span className="ml-1 text-th-muted">&middot; &ldquo;{binding.alias}&rdquo;</span>
                              )}
                              {binding.unit && (
                                <span className="ml-1 text-th-muted">· {binding.unit}</span>
                              )}
                            </p>
                          </div>
                          <button
                            onClick={() => handleRemoveBinding(index)}
                            className="ml-3 p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {bindings.length === 0 && !selectedDeviceId && (
                <p className="text-center text-sm text-th-muted py-4">
                  No bindings yet — select a device and metric above.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-th-default bg-page rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-th-primary hover:bg-panel rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={bindings.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-input-border)] disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <Check className="w-4 h-4" />
            Save {bindings.length > 0 ? `(${bindings.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}