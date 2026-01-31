"use client";

import { X, TrendingUp, BarChart3, Gauge, Map, Table, Info } from "lucide-react";
import { useState } from "react";

interface WidgetType {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  defaultConfig: any;
}

const WIDGET_TYPES: WidgetType[] = [
  {
    id: "kpi_card",
    name: "KPI Card",
    description: "Display a single metric with trend indicator",
    icon: <TrendingUp className="w-6 h-6" />,
    category: "Metrics & KPIs",
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
    id: "chart",
    name: "Chart",
    description: "Line, area, or bar chart for time-series data",
    icon: <BarChart3 className="w-6 h-6" />,
    category: "Charts",
    defaultConfig: {
      chart_type: "line",
      metrics: ["temperature"],
      time_range: "24h",
      colors: ["#3b82f6"],
    },
  },
  // TODO: Add more widget types in Iteration 3
  // {
  //   id: "gauge",
  //   name: "Gauge",
  //   description: "Circular or linear gauge for single metrics",
  //   icon: <Gauge className="w-6 h-6" />,
  //   category: "Metrics & KPIs",
  //   defaultConfig: {},
  // },
  // {
  //   id: "map",
  //   name: "Map",
  //   description: "Device location map",
  //   icon: <Map className="w-6 h-6" />,
  //   category: "Maps & Location",
  //   defaultConfig: {},
  // },
  // {
  //   id: "table",
  //   name: "Table",
  //   description: "Data table with sorting and filtering",
  //   icon: <Table className="w-6 h-6" />,
  //   category: "Data Display",
  //   defaultConfig: {},
  // },
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
        className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Widget Library
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Select a widget type to add to your dashboard
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Categories */}
        <div className="flex gap-2 px-6 py-3 border-b border-gray-200 overflow-x-auto">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              selectedCategory === null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All Widgets
          </button>
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                selectedCategory === category
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Widget Grid */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-180px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWidgets.map((widget) => (
              <button
                key={widget.id}
                onClick={() => {
                  onSelectWidget(widget);
                  onClose();
                }}
                className="group p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-lg transition-all text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-100 text-blue-600 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    {widget.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                      {widget.name}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">
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
              <p className="text-gray-500">
                No widgets found in this category
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-gray-500">
            More widget types will be available in future updates
          </p>
        </div>
      </div>
    </div>
  );
}
