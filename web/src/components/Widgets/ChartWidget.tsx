"use client";

import { useState, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface ChartWidgetProps {
  config: {
    chart_type?: "line" | "area" | "bar";
    metrics?: string[];
    time_range?: string;
    colors?: string[];
    color?: string;
  };
  dataSources?: Array<{
    device_id: string;
    metric: string;
    alias?: string;
  }>;
}

/**
 * Parse time range string to hours
 * @param timeRange - Format: "1h", "6h", "24h", "7d", "30d"
 * @returns Number of hours
 */
function parseTimeRangeToHours(timeRange: string): number {
  if (timeRange.includes("d")) {
    const days = parseInt(timeRange.replace(/[^0-9]/g, "")) || 1;
    return days * 24;
  }
  return parseInt(timeRange.replace(/[^0-9]/g, "")) || 24;
}

const TIME_RANGE_OPTIONS = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "12h", value: "12h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];

/**
 * Resolve the effective metric list for chart queries.
 *
 * Template-generated widgets store metrics in config.metrics (e.g. ["flow_rate"])
 * and bind devices in data_sources with metric: null.
 * User-configured widgets may store metric directly on each data source.
 *
 * This function normalizes both patterns into a flat list of
 * { device_id, metric, alias } entries with a guaranteed non-null metric.
 */
function resolveMetricSources(
  dataSources: Array<{ device_id: string; metric: string; alias?: string }>,
  configMetrics: string[]
): Array<{ device_id: string; metric: string; alias: string }> {
  const resolved: Array<{ device_id: string; metric: string; alias: string }> = [];

  // Check if any data source has a real (non-null) metric
  const hasExplicitMetrics = dataSources.some((ds) => ds.metric);

  if (hasExplicitMetrics) {
    // User-configured: each data source specifies its own metric
    for (const ds of dataSources) {
      if (ds.metric) {
        resolved.push({
          device_id: ds.device_id,
          metric: ds.metric,
          alias: ds.alias || ds.metric,
        });
      }
    }
  } else {
    // Template-configured: device bound in data_sources, metrics in config
    // Create one entry per device per config metric
    for (const ds of dataSources) {
      for (const metricName of configMetrics) {
        resolved.push({
          device_id: ds.device_id,
          metric: metricName,
          alias: metricName,
        });
      }
    }
  }

  return resolved;
}

export default function ChartWidget({ config, dataSources }: ChartWidgetProps) {
  const {
    chart_type = "line",
    metrics = [],
    time_range = "24h",
    colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
    color,
  } = config;

  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRange, setActiveRange] = useState(time_range);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setFetchError(null);

        if (!dataSources || dataSources.length === 0) {
          setChartData([]);
          setLoading(false);
          return;
        }

        const token = localStorage.getItem("auth_token");
        if (!token) {
          setLoading(false);
          return;
        }

        const payload = JSON.parse(atob(token.split(".")[1]));
        const tenantId = payload.tenant_id;

        const rangeHours = parseTimeRangeToHours(activeRange);
        const endTime = new Date();
        const startTime = new Date(
          endTime.getTime() - rangeHours * 60 * 60 * 1000
        );

        // Use aggregation for longer time ranges to reduce data points
        const useAggregation = rangeHours > 6;
        const aggregationType = useAggregation ? "avg" : "raw";

        // Resolve metrics from both data_sources and config
        const effectiveSources = resolveMetricSources(dataSources, metrics);

        if (effectiveSources.length === 0) {
          console.warn("[ChartWidget] No metrics resolved from data_sources or config");
          setChartData([]);
          setLoading(false);
          return;
        }

        console.log(
          `[ChartWidget] Fetching ${activeRange} (${rangeHours}h), ` +
          `aggregation=${aggregationType}, resolved sources:`,
          effectiveSources
        );

        // Fetch telemetry for each resolved source
        const promises = effectiveSources.map(async (src) => {
          const params = new URLSearchParams({
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            per_page: "1000",
            aggregation: aggregationType,
            metrics: src.metric,
          });

          const url = `/api/v1/tenants/${tenantId}/devices/${src.device_id}/telemetry?${params}`;
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(
              `[ChartWidget] API ${response.status} for ${src.metric}:`,
              errorText
            );
            return { metric: src.metric, alias: src.alias, data: [] };
          }

          const result = await response.json();
          console.log(
            `[ChartWidget] ${src.metric}: ${result.data?.length || 0} points`,
            result.data?.slice(0, 2)
          );
          return {
            metric: src.metric,
            alias: src.alias,
            data: result.data || [],
          };
        });

        const results = await Promise.all(promises);

        // Merge all data sources by timestamp
        const mergedData: Record<string, any> = {};

        results.forEach((result) => {
          if (!result.data || result.data.length === 0) return;

          result.data.forEach((point: any) => {
            // Raw data uses "timestamp", aggregated uses "time_bucket"
            const timeField = point.timestamp || point.time_bucket;
            if (!timeField) return;

            const ts = new Date(timeField).getTime();
            if (isNaN(ts)) return;

            const tsKey = String(ts);

            if (!mergedData[tsKey]) {
              const dateObj = new Date(timeField);
              mergedData[tsKey] = {
                time: useAggregation
                  ? dateObj.toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : dateObj.toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                _ts: ts,
              };
            }

            // Extract metric value - it's a direct key on the point object
            // Both raw and aggregated formats place metric values as top-level keys
            const value = point[result.metric];
            if (value !== undefined && value !== null) {
              mergedData[tsKey][result.alias] = Number(value);
            }
          });
        });

        // Sort ascending (oldest first) for chart display
        const sortedData = Object.values(mergedData).sort(
          (a, b) => a._ts - b._ts
        );

        console.log(
          `[ChartWidget] Merged ${sortedData.length} data points`,
          sortedData.length > 0
            ? {
                first: sortedData[0],
                last: sortedData[sortedData.length - 1],
              }
            : "empty"
        );

        setChartData(sortedData);
        setLoading(false);
      } catch (error) {
        console.error("[ChartWidget] Error:", error);
        setFetchError(String(error));
        setLoading(false);
      }
    };

    fetchData();

    // Auto-refresh every 30 seconds
    intervalRef.current = setInterval(fetchData, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [dataSources, activeRange, metrics]);

  const handleRangeChange = (range: string) => {
    setActiveRange(range);
    setLoading(true);
    setChartData([]);
  };

  // Derive display keys from resolved sources
  const effectiveKeys = (() => {
    if (!dataSources || dataSources.length === 0) return [];
    const resolved = resolveMetricSources(dataSources, metrics);
    return resolved.map((s) => s.alias);
  })();

  const chartColors = color ? [color] : colors;

  function renderChart() {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 20, left: 0, bottom: 5 },
    };

    switch (chart_type) {
      case "area":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart {...commonProps}>
              <defs>
                {effectiveKeys.map((key, index) => (
                  <linearGradient
                    key={key}
                    id={`gradient-${key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={chartColors[index % chartColors.length]}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={chartColors[index % chartColors.length]}
                      stopOpacity={0}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.375rem",
                  fontSize: "12px",
                }}
              />
              {effectiveKeys.length > 1 && (
                <Legend wrapperStyle={{ fontSize: "12px" }} />
              )}
              {effectiveKeys.map((key, index) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={chartColors[index % chartColors.length]}
                  fill={`url(#gradient-${key})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case "bar":
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.375rem",
                  fontSize: "12px",
                }}
              />
              {effectiveKeys.length > 1 && (
                <Legend wrapperStyle={{ fontSize: "12px" }} />
              )}
              {effectiveKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={chartColors[index % chartColors.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case "line":
      default:
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="time"
                stroke="#9ca3af"
                fontSize={12}
                tickLine={false}
              />
              <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.375rem",
                  fontSize: "12px",
                }}
              />
              {effectiveKeys.length > 1 && (
                <Legend wrapperStyle={{ fontSize: "12px" }} />
              )}
              {effectiveKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={chartColors[index % chartColors.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );
    }
  }

  // Render content area
  function renderContent() {
    if (!dataSources || dataSources.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-gray-400 text-sm">
          No device bound - configure widget
        </div>
      );
    }

    if (loading) {
      return (
        <div className="h-full flex items-center justify-center text-gray-400">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    if (fetchError) {
      return (
        <div className="h-full flex items-center justify-center text-red-400 text-sm px-4 text-center">
          Error loading data
        </div>
      );
    }

    if (!chartData || chartData.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-gray-400 text-sm">
          No data available for selected time range
        </div>
      );
    }

    return renderChart();
  }

  return (
    <div className="h-full flex flex-col">
      {/* Time range selector - ALWAYS visible when device is bound */}
      {dataSources && dataSources.length > 0 && (
        <div className="flex items-center justify-end gap-1 px-2 pb-1 flex-shrink-0">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleRangeChange(opt.value)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                activeRange === opt.value
                  ? "bg-blue-600 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0">{renderContent()}</div>
    </div>
  );
}
