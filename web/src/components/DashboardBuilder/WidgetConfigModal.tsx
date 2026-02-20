"use client";

import { X, Save, Link as LinkIcon } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import DeviceBindingModal from "./DeviceBindingModal";

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

  const formatMetricName = (metric: string) =>
    metric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const generateTitle = (bindings: any[]): string => {
    const deviceNames = [...new Set(bindings.map((b: any) => b.device_name).filter(Boolean))];
    const metricNames = [...new Set(bindings.map((b: any) => b.metric))];

    if (bindings.length === 1) {
      const metric = formatMetricName(metricNames[0]);
      return deviceNames[0] ? `${metric} - ${deviceNames[0]}` : metric;
    }
    if (deviceNames.length === 1) {
      return `${deviceNames[0]} - ${metricNames.map(formatMetricName).join(', ')}`;
    }
    if (metricNames.length === 1) {
      return `${formatMetricName(metricNames[0])} - ${deviceNames.join(' vs ')}`;
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

    // Auto-populate config from schema metadata (unit, min/max)
    if (bindings.length === 1) {
      const b = bindings[0];
      const updates: Record<string, any> = {};

      if (b.unit) updates.unit = b.unit;
      if (widgetType === 'gauge') {
        if (b.min !== undefined) updates.min = b.min;
        if (b.max !== undefined) updates.max = b.max;
      }

      if (Object.keys(updates).length > 0) {
        setConfig((prev: any) => ({ ...prev, ...updates }));
      }
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Color
        </label>
        <div className="flex gap-2">
          <input
            type="color"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className="h-10 w-20 rounded-lg border border-gray-300 cursor-pointer"
          />
          <input
            type="text"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
        />
        <label
          htmlFor="show_trend"
          className="text-sm font-medium text-gray-700"
        >
          Show Trend Indicator
        </label>
      </div>

      {config.show_trend && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Trend Period
          </label>
          <select
            value={config.trend_period || "24h"}
            onChange={(e) =>
              setConfig({ ...config, trend_period: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          <label className="block text-sm font-medium text-gray-700 mb-2">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Optional"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Chart Type
        </label>
        <select
          value={config.chart_type || "line"}
          onChange={(e) => setConfig({ ...config, chart_type: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Time Range
        </label>
        <select
          value={config.time_range || "24h"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Primary Color
        </label>
        <div className="flex gap-2">
          <input
            type="color"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className="h-10 w-20 rounded-lg border border-gray-300 cursor-pointer"
          />
          <input
            type="text"
            value={config.color || "#3b82f6"}
            onChange={(e) => setConfig({ ...config, color: e.target.value })}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="#3b82f6"
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
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
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Minimum Value
          </label>
          <input
            type="number"
            value={config.min ?? 0}
            onChange={(e) =>
              setConfig({ ...config, min: parseFloat(e.target.value) })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Maximum Value
          </label>
          <input
            type="number"
            value={config.max ?? 100}
            onChange={(e) =>
              setConfig({ ...config, max: parseFloat(e.target.value) })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Unit
          </label>
          <input
            type="text"
            value={config.unit ?? "%"}
            onChange={(e) => setConfig({ ...config, unit: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="%"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Color Zones
        </label>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Safe</label>
            <input
              type="color"
              value={config.color_safe || "#10b981"}
              onChange={(e) =>
                setConfig({ ...config, color_safe: e.target.value })
              }
              className="w-full h-10 rounded-lg border border-gray-300 cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Warning</label>
            <input
              type="color"
              value={config.color_warning || "#f59e0b"}
              onChange={(e) =>
                setConfig({ ...config, color_warning: e.target.value })
              }
              className="w-full h-10 rounded-lg border border-gray-300 cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Critical</label>
            <input
              type="color"
              value={config.color_critical || "#ef4444"}
              onChange={(e) =>
                setConfig({ ...config, color_critical: e.target.value })
              }
              className="w-full h-10 rounded-lg border border-gray-300 cursor-pointer"
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
          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
        />
        <label
          htmlFor="show_value"
          className="text-sm font-medium text-gray-700"
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
          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
        />
        <label htmlFor="donut" className="text-sm font-medium text-gray-700">Donut style (hollow center)</label>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="show_legend"
          checked={config.show_legend ?? true}
          onChange={(e) => setConfig({ ...config, show_legend: e.target.checked })}
          className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
        />
        <label htmlFor="show_legend" className="text-sm font-medium text-gray-700">Show legend</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Unit</label>
          <input
            type="text"
            value={config.unit ?? ""}
            onChange={(e) => setConfig({ ...config, unit: e.target.value })}
            placeholder="e.g. °C"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Decimal Places</label>
          <input
            type="number" min="0" max="6"
            value={config.decimal_places ?? 2}
            onChange={(e) => setConfig({ ...config, decimal_places: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
        <select
          value={config.time_range || "24h"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="1h">Last Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Accent Color</label>
        <div className="flex gap-2">
          <input type="color" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="h-10 w-20 rounded-lg border border-gray-300 cursor-pointer" />
          <input type="text" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
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
            <div key={i} className="text-sm text-gray-700 bg-gray-50 px-3 py-1.5 rounded border border-gray-200">
              <span className="font-medium text-gray-500">{i === 0 ? "X axis" : "Y axis"}:</span> {ds.alias || ds.metric}
            </div>
          ))}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
        <select
          value={config.time_range || "24h"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="1h">Last Hour</option>
          <option value="6h">Last 6 Hours</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Dot Color</label>
        <div className="flex gap-2">
          <input type="color" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="h-10 w-20 rounded-lg border border-gray-300 cursor-pointer" />
          <input type="text" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
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
        <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
        <select
          value={config.time_range || "7d"}
          onChange={(e) => setConfig({ ...config, time_range: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Heat Color</label>
        <div className="flex gap-2">
          <input type="color" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="h-10 w-20 rounded-lg border border-gray-300 cursor-pointer" />
          <input type="text" value={config.color || "#3b82f6"} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
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
          <div className="text-center py-8 text-gray-500">
            <p>No configuration available for this widget type</p>
          </div>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Widget Configuration
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Customize your widget settings
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
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Widget Title - Common for all widget types */}
          <div className="mb-6 pb-6 border-b border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Widget Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter widget title"
            />
          </div>

          {/* Device Binding Section */}
          <div className="mb-6 pb-6 border-b border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
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
                    className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded text-sm"
                  >
                    <span className="text-gray-900">
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
              <p className="text-sm text-gray-500">
                No devices bound. Click &quot;Bind Device&quot; to add data sources.
              </p>
            )}
          </div>

          {renderConfigForm()}
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
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>

      {/* Device Binding Modal */}
      <DeviceBindingModal
        isOpen={showDeviceBinding}
        widgetType={widgetType}
        currentBindings={dataSources}
        onClose={() => setShowDeviceBinding(false)}
        onSave={handleSaveBindings}
      />
    </div>
  );
}
