"use client";

import { X, Save, Link as LinkIcon } from "lucide-react";
import { useState, useEffect } from "react";
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

  useEffect(() => {
    setConfig(currentConfig || {});
    setTitle(currentTitle || "");
    setDataSources(currentDataSources || []);
  }, [currentConfig, currentTitle, currentDataSources]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(config, title, dataSources);
    onClose();
  };

  const handleSaveBindings = (bindings: any[]) => {
    setDataSources(bindings);
    setShowDeviceBinding(false);
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

  const renderConfigForm = () => {
    switch (widgetType) {
      case "kpi_card":
        return renderKPICardConfig();
      case "chart":
        return renderChartConfig();
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
              onChange={(e) => setTitle(e.target.value)}
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
