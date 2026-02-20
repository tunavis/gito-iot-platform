"use client";

import {
  X,
  TrendingUp,
  BarChart3,
  Gauge,
  Map,
  Table,
  PieChart,
  LayoutGrid,
  Bell,
  ScatterChart,
  Grid3X3,
  Info,
} from "lucide-react";
import { useState } from "react";

interface WidgetType {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  defaultConfig: any;
  defaultWidth?: number;
  defaultHeight?: number;
}

const WIDGET_TYPES: WidgetType[] = [
  // ── Metrics & KPIs ──────────────────────────────────────────────────────────
  {
    id: "kpi_card",
    name: "KPI Card",
    description: "Single metric with trend indicator and threshold alerts",
    icon: <TrendingUp className="w-6 h-6" />,
    category: "Metrics & KPIs",
    defaultWidth: 3,
    defaultHeight: 2,
    defaultConfig: {
      metric: "temperature",
      unit: "°C",
      decimal_places: 1,
      show_trend: true,
      trend_period: "24h",
      color: "#3b82f6",
      threshold_warning: 75,
      threshold_critical: 85,
    },
  },
  {
    id: "gauge",
    name: "Gauge",
    description: "Circular gauge with safe / warning / critical color zones",
    icon: <Gauge className="w-6 h-6" />,
    category: "Metrics & KPIs",
    defaultWidth: 2,
    defaultHeight: 3,
    defaultConfig: {
      min: 0,
      max: 100,
      unit: "%",
      decimal_places: 1,
      threshold_warning: 70,
      threshold_critical: 90,
      color_safe: "#10b981",
      color_warning: "#f59e0b",
      color_critical: "#ef4444",
      show_value: true,
    },
  },
  {
    id: "stat_group",
    name: "Stat Group",
    description: "Min / Max / Avg / Latest for a single metric in one card",
    icon: <LayoutGrid className="w-6 h-6" />,
    category: "Metrics & KPIs",
    defaultWidth: 4,
    defaultHeight: 2,
    defaultConfig: {
      unit: "",
      time_range: "24h",
      decimal_places: 2,
      color: "#3b82f6",
    },
  },

  // ── Charts ──────────────────────────────────────────────────────────────────
  {
    id: "chart",
    name: "Time-Series Chart",
    description: "Line, area, bar, stacked bar, radar or composed chart",
    icon: <BarChart3 className="w-6 h-6" />,
    category: "Charts",
    defaultWidth: 6,
    defaultHeight: 3,
    defaultConfig: {
      chart_type: "line",
      metrics: ["temperature"],
      time_range: "24h",
      colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
    },
  },
  {
    id: "pie_chart",
    name: "Pie / Donut Chart",
    description: "Proportional breakdown — one slice per data source",
    icon: <PieChart className="w-6 h-6" />,
    category: "Charts",
    defaultWidth: 3,
    defaultHeight: 4,
    defaultConfig: {
      donut: true,
      show_legend: true,
      colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"],
    },
  },
  {
    id: "scatter_plot",
    name: "Scatter Plot",
    description: "Correlation between two metrics across time",
    icon: <ScatterChart className="w-6 h-6" />,
    category: "Charts",
    defaultWidth: 4,
    defaultHeight: 4,
    defaultConfig: {
      x_label: "",
      y_label: "",
      color: "#3b82f6",
      time_range: "24h",
    },
  },

  // ── Activity ─────────────────────────────────────────────────────────────────
  {
    id: "heatmap",
    name: "Activity Heatmap",
    description: "Hour × day grid showing when devices report most data",
    icon: <Grid3X3 className="w-6 h-6" />,
    category: "Activity",
    defaultWidth: 6,
    defaultHeight: 3,
    defaultConfig: {
      color: "#3b82f6",
      time_range: "7d",
    },
  },
  {
    id: "alarm_summary",
    name: "Alarm Summary",
    description: "Active alarm counts by severity for the whole tenant",
    icon: <Bell className="w-6 h-6" />,
    category: "Activity",
    defaultWidth: 3,
    defaultHeight: 3,
    defaultConfig: {},
  },

  // ── Data Display ─────────────────────────────────────────────────────────────
  {
    id: "table",
    name: "Data Table",
    description: "Paginated telemetry table with configurable columns",
    icon: <Table className="w-6 h-6" />,
    category: "Data Display",
    defaultWidth: 6,
    defaultHeight: 3,
    defaultConfig: {
      page_size: 10,
      auto_refresh: true,
      time_range: "24h",
    },
  },

  // ── Maps & Location ──────────────────────────────────────────────────────────
  {
    id: "map",
    name: "Device Map",
    description: "Interactive map showing device GPS locations",
    icon: <Map className="w-6 h-6" />,
    category: "Maps & Location",
    defaultWidth: 6,
    defaultHeight: 4,
    defaultConfig: {
      zoom: 12,
      show_label: true,
    },
  },
];

interface WidgetLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWidget: (widgetType: WidgetType) => void;
}

export default function WidgetLibrary({
  isOpen,
  onClose,
  onSelectWidget,
}: WidgetLibraryProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  if (!isOpen) return null;

  const categories = Array.from(new Set(WIDGET_TYPES.map((w) => w.category)));
  const filteredWidgets = selectedCategory
    ? WIDGET_TYPES.filter((w) => w.category === selectedCategory)
    : WIDGET_TYPES;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Widget Library</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {WIDGET_TYPES.length} widget types available
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 px-6 py-3 border-b border-gray-200 overflow-x-auto">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              selectedCategory === null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All ({WIDGET_TYPES.length})
          </button>
          {categories.map((cat) => {
            const count = WIDGET_TYPES.filter((w) => w.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                  selectedCategory === cat
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Widget grid */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-160px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredWidgets.map((widget) => (
              <button
                key={widget.id}
                onClick={() => {
                  onSelectWidget(widget);
                  onClose();
                }}
                className="group p-4 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:shadow-md transition-all text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors flex-shrink-0">
                    {widget.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors text-sm">
                        {widget.name}
                      </h3>
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                        {widget.defaultWidth ?? 3}×{widget.defaultHeight ?? 2}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {widget.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filteredWidgets.length === 0 && (
            <div className="text-center py-12">
              <Info className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p className="text-gray-500">No widgets in this category</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}