"use client";

import { useState, useEffect } from "react";
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
 * @param timeRange - Format: "24h" or "7d"
 * @returns Number of hours
 */
function parseTimeRangeToHours(timeRange: string): number {
  if (timeRange.includes('d')) {
    const days = parseInt(timeRange.replace(/[^0-9]/g, "")) || 1;
    return days * 24;
  }
  return parseInt(timeRange.replace(/[^0-9]/g, "")) || 24;
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

  useEffect(() => {
    const fetchData = async () => {
      try {
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

        const rangeHours = parseTimeRangeToHours(time_range);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - rangeHours * 60 * 60 * 1000);

        // Fetch telemetry data for each data source
        const promises = dataSources.map(async (ds) => {
          const params = new URLSearchParams({
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            per_page: "500",
          });

          const response = await fetch(
            `/api/v1/tenants/${tenantId}/devices/${ds.device_id}/telemetry?${params}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[ChartWidget] API Error ${response.status} for device ${ds.device_id}:`, errorText);
            return { device_id: ds.device_id, metric: ds.metric, alias: ds.alias, data: [] };
          }

          const result = await response.json();
          return {
            device_id: ds.device_id,
            metric: ds.metric,
            alias: ds.alias || ds.metric,
            data: result.data || [],
          };
        });

        const results = await Promise.all(promises);

        // Merge telemetry data by timestamp
        const mergedData: Record<string, any> = {};

        results.forEach((result) => {
          if (!result.data) return;

          result.data.forEach((point: any) => {
            const timestamp = new Date(point.timestamp).getTime();
            const timestampKey = String(timestamp);
            if (!mergedData[timestampKey]) {
              mergedData[timestampKey] = {
                time: new Date(point.timestamp).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                timestamp,
              };
            }
            // Check both direct field and payload JSONB
            const value = point[result.metric] ?? point.payload?.[result.metric];
            if (timestampKey && result.alias) {
              mergedData[timestampKey][result.alias] = value;
            }
          });
        });

        const sortedData = Object.values(mergedData).sort(
          (a, b) => a.timestamp - b.timestamp
        );

        setChartData(sortedData);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching chart data:", error);
        setLoading(false);
      }
    };

    fetchData();

    // Set up auto-refresh
    const interval = setInterval(fetchData, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [dataSources, time_range]);

  function renderChart() {
    const chartColors = color ? [color] : colors;
    const dataKeys = dataSources?.map((ds) => ds.alias || ds.metric) || metrics;

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
                {dataKeys.map((metric, index) => (
                  <linearGradient
                    key={metric}
                    id={`gradient-${metric}`}
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
              {dataKeys.length > 1 && (
                <Legend wrapperStyle={{ fontSize: "12px" }} />
              )}
              {dataKeys.map((metric, index) => (
                <Area
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  stroke={chartColors[index % chartColors.length]}
                  fill={`url(#gradient-${metric})`}
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
              {dataKeys.length > 1 && (
                <Legend wrapperStyle={{ fontSize: "12px" }} />
              )}
              {dataKeys.map((metric, index) => (
                <Bar
                  key={metric}
                  dataKey={metric}
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
              {dataKeys.length > 1 && (
                <Legend wrapperStyle={{ fontSize: "12px" }} />
              )}
              {dataKeys.map((metric, index) => (
                <Line
                  key={metric}
                  type="monotone"
                  dataKey={metric}
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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!dataSources || dataSources.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        No device bound - configure widget
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

  return <div className="h-full">{renderChart()}</div>;
}
