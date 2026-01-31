"use client";

import { X, Save } from "lucide-react";
import { useState, useEffect } from "react";

interface WidgetConfigModalProps {
  isOpen: boolean;
  widgetType: string;
  currentConfig: any;
  onClose: () => void;
  onSave: (config: any) => void;
}

export default function WidgetConfigModal({
  isOpen,
  widgetType,
  currentConfig,
  onClose,
  onSave,
}: WidgetConfigModalProps) {
  const [config, setConfig] = useState(currentConfig || {});

  useEffect(() => {
    setConfig(currentConfig || {});
  }, [currentConfig]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const renderKPICardConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Metric Name
        </label>
        <input
          type="text"
          value={config.metric || ""}
          onChange={(e) => setConfig({ ...config, metric: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="e.g., temperature, flow_rate"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Unit
        </label>
        <input
          type="text"
          value={config.unit || ""}
          onChange={(e) => setConfig({ ...config, unit: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="e.g., °C, m³/hr, %"
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

  const renderConfigForm = () => {
    switch (widgetType) {
      case "kpi_card":
        return renderKPICardConfig();
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
    </div>
  );
}
