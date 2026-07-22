"use client";

import { Save, Link as LinkIcon } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import DeviceBindingModal from "./DeviceBindingModal";
import Modal from "@/components/ui/Modal";
import { btn, input } from "@/components/ui/buttonStyles";
import { formatMetricLabel } from "@/lib/formatMetricLabel";

interface WidgetConfigModalProps {
  isOpen: boolean;
  widgetType: string;
  currentConfig: any;
  currentTitle?: string;
  currentDataSources?: any[];
  onClose: () => void;
  onSave: (config: any, title?: string, dataSources?: any[]) => void;
}

export default function WidgetConfigModal({
  isOpen,
  widgetType,
  currentConfig,
  currentTitle,
  currentDataSources,
  onClose,
  onSave,
}: WidgetConfigModalProps) {
  const [config, setConfig] = useState(currentConfig || {});
  const [title, setTitle] = useState(currentTitle || "");
  const [dataSources, setDataSources] = useState(currentDataSources || []);
  const [showDeviceBinding, setShowDeviceBinding] = useState(false);
  const titleManuallyEdited = useRef(false);

  useEffect(() => {
    setConfig(currentConfig || {});
    setTitle(currentTitle || "");
    setDataSources(currentDataSources || []);
    titleManuallyEdited.current = false;
  }, [currentConfig, currentTitle, currentDataSources]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(config, title, dataSources);
    onClose();
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    titleManuallyEdited.current = true;
  };

  const generateTitle = (bindings: any[]): string => {
    const deviceNames = [...new Set(bindings.map((b: any) => b.device_name).filter(Boolean))];
    const metricNames = [...new Set(bindings.map((b: any) => b.metric))];

    if (bindings.length === 1) {
      const metric = formatMetricLabel(metricNames[0]);
      return deviceNames[0] ? `${metric} - ${deviceNames[0]}` : metric;
    }
    if (deviceNames.length === 1) {
      return `${deviceNames[0]} - ${metricNames.map(m => formatMetricLabel(m)).join(', ')}`;
    }
    if (metricNames.length === 1) {
      return `${formatMetricLabel(metricNames[0])} - ${deviceNames.join(' vs ')}`;
    }
    return `${deviceNames.join(', ')} - Comparison`;
  };

  const handleSaveBindings = (bindings: any[]) => {
    setDataSources(bindings);
    setShowDeviceBinding(false);

    // Auto-generate title unless the user has manually typed one
    if (bindings.length > 0 && !titleManuallyEdited.current) {
      setTitle(generateTitle(bindings));
    }

    // Auto-populate config from schema metadata (unit, min/max, columns)
    if (bindings.length === 1) {
      const b = bindings[0];
      const updates: Record<string, any> = {};
      // A schema field with no declared range reports min/max as null, not
      // undefined — `!= null` catches both, so a real 0 or a genuine bound
      // still comes through instead of leaking a stale library default.
      const hasMin = typeof b.min === 'number';
      const hasMax = typeof b.max === 'number';

      if (b.unit) updates.unit = b.unit;

      if (widgetType === 'gauge') {
        // Only carry over a bound if the metric actually has one — leaving the
        // library default (0/100) in place is safer than writing an explicit
        // null, which breaks the widget's range math outright.
        if (hasMin) updates.min = b.min;
        if (hasMax) updates.max = b.max;
      }

      if (widgetType === 'kpi_card' && !hasMax) {
        // No declared upper bound (e.g. a cumulative counter) — the library's
        // generic 75/85 "percentage-shaped" thresholds would trivially trigger
        // on any six-figure reading and permanently color it as critical.
        updates.threshold_warning = undefined;
        updates.threshold_critical = undefined;
      }

      if (widgetType === 'table') {
        updates.columns = ['timestamp', b.metric];
      }

      if (Object.keys(updates).length > 0) {
        setConfig((prev: any) => {
          const next = { ...prev, ...updates };
          if (updates.threshold_warning === undefined) delete next.threshold_warning;
          if (updates.threshold_critical === undefined) delete next.threshold_critical;
          return next;
        });
      }
    } else if (bindings.length > 1 && widgetType === 'table') {
      setConfig((prev: any) => ({
        ...prev,
        columns: ['timestamp', ...bindings.map((b) => b.metric)],
      }));
    }
  };

  const renderKPICardConfig = () => (
    <div className="space-y-4">
      {/* Metric info display (read-only) */}
      {dataSources && dataSources.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="text-sm text-blue-900">
            <span className="font-medium">Data Source:</span>{" "}
            {dataSources[0].alias || dataSources[0].metric}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">
          Decimal Places
        </label>
        <input
          type="number"
          min="0"
          max="6"
          value={config.decimal_places ?? 2}
          onChange={(e) =>
            setConfig({ ...config, decimal_places: parseInt(e.target.value) })
          }
          className={input.base}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">
          Color
        </label>
        <div className="flex gap-2">
          <input
            type="color"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className="h-10 w-20 rounded-lg border border-[var(--color-input-border)] cursor-pointer"
          />
          <input
            type="text"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className={input.base + " flex-1"}
            placeholder="#3b82f6"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="show_trend"
          checked={config.show_trend ?? true}
          onChange={(e) =>
            setConfig({ ...config, show_trend: e.target.checked })
          }
          className="w-4 h-4 text-primary-600 bg-panel border-[var(--color-input-border)] rounded focus:ring-primary-500 focus:ring-2"
        />
        <label
          htmlFor="show_trend"
          className="text-sm font-medium text-th-primary"
        >
          Show Trend Indicator
        </label>
      </div>

      {config.show_trend && (
        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Trend Period
          </label>
          <select
            value={config.trend_period || "24h"}
            onChange={(e) =>
              setConfig({ ...config, trend_period: e.target.value })
            }
            className={input.base}
          >
            <option value="1h">Last Hour</option>
            <option value="6h">Last 6 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Warning Threshold
          </label>
          <input
            type="number"
            value={config.threshold_warning || ""}
            onChange={(e) =>
              setConfig({
                ...config,
                threshold_warning: e.target.value
                  ? parseFloat(e.target.value)
                  : undefined,
              })
            }
            className={input.base}
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Critical Threshold
          </label>
          <input
            type="number"
            value={config.threshold_critical || ""}
            onChange={(e) =>
              setConfig({
                ...config,
                threshold_critical: e.target.value
                  ? parseFloat(e.target.value)
                  : undefined,
              })
            }
            className={input.base}
            placeholder="Optional"
          />
        </div>
      </div>
    </div>
  );

  const renderChartConfig = () => (
    <div className="space-y-4">
      {/* Data sources display (read-only) */}
      {dataSources && dataSources.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="text-sm font-medium text-blue-900 mb-2">
            Data Sources ({dataSources.length}):
          </div>
          <div className="space-y-1">
            {dataSources.map((ds, index) => (
              <div key={index} className="text-sm text-blue-800">
                • {ds.alias || ds.metric}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">
          Chart Type
        </label>
        <select
          value={config.chart_type || "line"}
          onChange={(e) => setConfig({ ...config, chart_type: e.target.value })}
          className={input.base}
        >
          <option value="line">Line Chart</option>
          <option value="area">Area Chart</option>
          <option value="bar">Bar Chart</option>
          <option value="stacked_bar">Stacked Bar Chart</option>
          <option value="composed">Composed (Bar + Line)</option>
          <option value="radar">Radar Chart</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">
          Time Range
        </label>
        <select
          value={config.time_range || "24h"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className={input.base}
        >
          <option value="1h">Last Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="12h">Last 12 Hours</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">
          Primary Color
        </label>
        <div className="flex gap-2">
          <input
            type="color"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className="h-10 w-20 rounded-lg border border-[var(--color-input-border)] cursor-pointer"
          />
          <input
            type="text"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className={input.base + " flex-1"}
            placeholder="#3b82f6"
          />
        </div>
        <p className="text-xs text-th-secondary mt-1">
          Multiple series will use color variations
        </p>
      </div>
    </div>
  );

  const renderGaugeConfig = () => (
    <div className="space-y-4">
      {/* Metric info display (read-only) */}
      {dataSources && dataSources.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="text-sm text-blue-900">
            <span className="font-medium">Data Source:</span>{" "}
            {dataSources[0].alias || dataSources[0].metric}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Minimum Value
          </label>
          <input
            type="number"
            value={config.min ?? 0}
            onChange={(e) =>
              setConfig({ ...config, min: parseFloat(e.target.value) })
            }
            className={input.base}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Maximum Value
          </label>
          <input
            type="number"
            value={config.max ?? 100}
            onChange={(e) =>
              setConfig({ ...config, max: parseFloat(e.target.value) })
            }
            className={input.base}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Unit
          </label>
          <input
            type="text"
            value={config.unit ?? "%"}
            onChange={(e) => setConfig({ ...config, unit: e.target.value })}
            className={input.base}
            placeholder="%"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Decimal Places
          </label>
          <input
            type="number"
            min="0"
            max="6"
            value={config.decimal_places ?? 1}
            onChange={(e) =>
              setConfig({ ...config, decimal_places: parseInt(e.target.value) })
            }
            className={input.base}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Warning Threshold (%)
          </label>
          <input
            type="number"
            value={config.threshold_warning ?? 70}
            onChange={(e) =>
              setConfig({
                ...config,
                threshold_warning: parseFloat(e.target.value),
              })
            }
            className={input.base}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">
            Critical Threshold (%)
          </label>
          <input
            type="number"
            value={config.threshold_critical ?? 90}
            onChange={(e) =>
              setConfig({
                ...config,
                threshold_critical: parseFloat(e.target.value),
              })
            }
            className={input.base}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">
          Color Zones
        </label>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-th-secondary mb-1">Safe</label>
            <input
              type="color"
              value={config.color_safe || "#10b981"}
              onChange={(e) =>
                setConfig({ ...config, color_safe: e.target.value })
              }
              className="w-full h-10 rounded-lg border border-[var(--color-input-border)] cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-th-secondary mb-1">Warning</label>
            <input
              type="color"
              value={config.color_warning || "#f59e0b"}
              onChange={(e) =>
                setConfig({ ...config, color_warning: e.target.value })
              }
              className="w-full h-10 rounded-lg border border-[var(--color-input-border)] cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-th-secondary mb-1">Critical</label>
            <input
              type="color"
              value={config.color_critical || "#ef4444"}
              onChange={(e) =>
                setConfig({ ...config, color_critical: e.target.value })
              }
              className="w-full h-10 rounded-lg border border-[var(--color-input-border)] cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="show_value"
          checked={config.show_value ?? true}
          onChange={(e) =>
            setConfig({ ...config, show_value: e.target.checked })
          }
          className="w-4 h-4 text-primary-600 bg-panel border-[var(--color-input-border)] rounded focus:ring-primary-500 focus:ring-2"
        />
        <label
          htmlFor="show_value"
          className="text-sm font-medium text-th-primary"
        >
          Show Value in Center
        </label>
      </div>
    </div>
  );

  const renderPieChartConfig = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="donut"
          checked={config.donut ?? true}
          onChange={(e) => setConfig({ ...config, donut: e.target.checked })}
          className="w-4 h-4 text-primary-600 bg-panel border-[var(--color-input-border)] rounded focus:ring-primary-500"
        />
        <label htmlFor="donut" className="text-sm font-medium text-th-primary">Donut style (hollow center)</label>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="show_legend"
          checked={config.show_legend ?? true}
          onChange={(e) => setConfig({ ...config, show_legend: e.target.checked })}
          className="w-4 h-4 text-primary-600 bg-panel border-[var(--color-input-border)] rounded focus:ring-primary-500"
        />
        <label htmlFor="show_legend" className="text-sm font-medium text-th-primary">Show legend</label>
      </div>
      {dataSources && dataSources.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-sm font-medium text-blue-900 mb-1">Data Sources ({dataSources.length}):</div>
          {dataSources.map((ds: any, i: number) => (
            <div key={i} className="text-sm text-blue-800">• {ds.alias || ds.metric} → 1 slice</div>
          ))}
        </div>
      )}
    </div>
  );

  const renderStatGroupConfig = () => (
    <div className="space-y-4">
      {dataSources && dataSources.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
          <span className="font-medium">Metric:</span> {dataSources[0].alias || dataSources[0].metric}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">Unit</label>
          <input
            type="text"
            value={config.unit ?? ""}
            onChange={(e) => setConfig({ ...config, unit: e.target.value })}
            placeholder="e.g. °C"
            className={input.base}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-th-primary mb-2">Decimal Places</label>
          <input
            type="number" min="0" max="6"
            value={config.decimal_places ?? 2}
            onChange={(e) => setConfig({ ...config, decimal_places: parseInt(e.target.value) })}
            className={input.base}
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">Time Range</label>
        <select
          value={config.time_range || "24h"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className={input.base}
        >
          <option value="1h">Last Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">Accent Color</label>
        <div className="flex gap-2">
          <input type="color" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="h-10 w-20 rounded-lg border border-[var(--color-input-border)] cursor-pointer" />
          <input type="text" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className={input.base + " flex-1"} />
        </div>
      </div>
    </div>
  );

  const renderAlarmSummaryConfig = () => (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        This widget automatically shows active alarms for all devices in your tenant. No device binding required.
      </div>
    </div>
  );

  const renderScatterPlotConfig = () => (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        Bind <strong>two metrics</strong>: the first becomes the X axis, the second becomes the Y axis.
      </div>
      {dataSources && dataSources.length > 0 && (
        <div className="space-y-1">
          {dataSources.slice(0, 2).map((ds: any, i: number) => (
            <div key={i} className="text-sm text-th-primary bg-page px-3 py-1.5 rounded border border-th-default">
              <span className="font-medium text-th-secondary">{i === 0 ? "X axis" : "Y axis"}:</span> {ds.alias || ds.metric}
            </div>
          ))}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">Time Range</label>
        <select
          value={config.time_range || "24h"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className={input.base}
        >
          <option value="1h">Last Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">Dot Color</label>
        <div className="flex gap-2">
          <input type="color" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="h-10 w-20 rounded-lg border border-[var(--color-input-border)] cursor-pointer" />
          <input type="text" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className={input.base + " flex-1"} />
        </div>
      </div>
    </div>
  );

  const renderHeatmapConfig = () => (
    <div className="space-y-4">
      {dataSources && dataSources.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
          <span className="font-medium">Device:</span> {dataSources[0].alias || dataSources[0].metric || "Any metric"}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">Time Range</label>
        <select
          value={config.time_range || "7d"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className={input.base}
        >
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-th-primary mb-2">Heat Color</label>
        <div className="flex gap-2">
          <input type="color" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="h-10 w-20 rounded-lg border border-[var(--color-input-border)] cursor-pointer" />
          <input type="text" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className={input.base + " flex-1"} />
        </div>
      </div>
    </div>
  );

  const renderConfigForm = () => {
    switch (widgetType) {
      case "kpi_card":
        return renderKPICardConfig();
      case "chart":
        return renderChartConfig();
      case "gauge":
        return renderGaugeConfig();
      case "pie_chart":
        return renderPieChartConfig();
      case "stat_group":
        return renderStatGroupConfig();
      case "alarm_summary":
        return renderAlarmSummaryConfig();
      case "scatter_plot":
        return renderScatterPlotConfig();
      case "heatmap":
        return renderHeatmapConfig();
      default:
        return (
          <div className="text-center py-8 text-th-secondary">
            <p>No configuration available for this widget type</p>
          </div>
        );
    }
  };

  return (
    <>
    <Modal
      open
      onClose={onClose}
      size="xl"
      scrollBody
      title="Widget Configuration"
      subtitle="Customize your widget settings"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className={btn.ghost}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 ${btn.primary}`}
          >
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      }
    >
        <div>
          {/* Widget Title - Common for all widget types */}
          <div className="mb-6 pb-6 border-b border-th-default">
            <label className="block text-sm font-medium text-th-primary mb-2">
              Widget Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className={input.base}
              placeholder="Enter widget title"
            />
          </div>

          {/* Device Binding Section */}
          <div className="mb-6 pb-6 border-b border-th-default">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-th-primary">
                Data Sources
              </label>
              <button
                onClick={() => setShowDeviceBinding(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <LinkIcon className="w-4 h-4" />
                Bind Device
              </button>
            </div>
            {dataSources && dataSources.length > 0 ? (
              <div className="space-y-2">
                {dataSources.map((source, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 bg-page border border-th-default rounded text-sm"
                  >
                    <span className="text-th-primary">
                      {source.alias || source.metric} ({source.metric})
                    </span>
                    <button
                      onClick={() =>
                        setDataSources(dataSources.filter((_, i) => i !== index))
                      }
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-th-secondary">
                No devices bound. Click &quot;Bind Device&quot; to add data sources.
              </p>
            )}
          </div>

          {renderConfigForm()}
        </div>
    </Modal>

      {/* Device Binding Modal */}
      <DeviceBindingModal
        isOpen={showDeviceBinding}
        widgetType={widgetType}
        currentBindings={dataSources}
        onClose={() => setShowDeviceBinding(false)}
        onSave={handleSaveBindings}
      />
    </>
  );
}
