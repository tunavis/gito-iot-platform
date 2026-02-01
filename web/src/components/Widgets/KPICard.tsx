"use client";

import { TrendingUp, TrendingDown, Minus, LucideIcon } from "lucide-react";
import WidgetWrapper from "./WidgetWrapper";
import { useEffect, useState } from "react";

interface KPICardConfig {
  metric?: string;
  unit?: string;
  decimal_places?: number;
  show_trend?: boolean;
  trend_period?: string;
  threshold_warning?: number;
  threshold_critical?: number;
  icon?: string;
  color?: string;
}

interface KPICardProps {
  id: string;
  title?: string;
  configuration: KPICardConfig;
  data_sources: Array<{
    device_id: string;
    metric?: string;
    alias?: string;
  }>;
  isEditMode?: boolean;
  onSettings?: () => void;
  onRemove?: () => void;
}

export default function KPICard({
  id,
  title,
  configuration,
  data_sources,
  isEditMode = false,
  onSettings,
  onRemove,
}: KPICardProps) {
  const [value, setValue] = useState<number | null>(null);
  const [trend, setTrend] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const {
    metric = "value",
    unit = "",
    decimal_places = 2,
    show_trend = true,
    trend_period = "24h",
    color = "#3b82f6",
    threshold_warning,
    threshold_critical,
  } = configuration;

  useEffect(() => {
    // Fetch latest value from device
    const fetchData = async () => {
      try {
        if (!data_sources || data_sources.length === 0) {
          setValue(null);
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
        const source = data_sources[0];
        const deviceId = source.device_id;
        const metricName = source.metric || metric;

        // Get latest value (last 1 hour)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 60 * 60 * 1000);

        const params = new URLSearchParams({
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          per_page: "1",
        });

        const response = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!response.ok) throw new Error("Failed to fetch telemetry");

        const data = await response.json();
        const dataPoint = data.data?.[0];
        // Check both direct field and payload JSONB
        const latestValue = dataPoint?.[metricName] ?? dataPoint?.payload?.[metricName];

        setValue(latestValue ?? null);

        // Calculate trend (compare with previous period)
        if (show_trend && trend_period) {
          const trendHours = parseInt(trend_period.replace(/[^0-9]/g, "")) || 24;
          const trendStart = new Date(endTime.getTime() - trendHours * 60 * 60 * 1000);

          const trendParams = new URLSearchParams({
            start_time: trendStart.toISOString(),
            end_time: endTime.toISOString(),
            per_page: "100",
          });

          const trendResponse = await fetch(
            `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry?${trendParams}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          if (trendResponse.ok) {
            const trendData = await trendResponse.json();
            if (trendData.data && trendData.data.length > 0) {
              const sum = trendData.data.reduce(
                (acc: number, item: any) => {
                  // Check both direct field and payload JSONB
                  const val = item[metricName] ?? item.payload?.[metricName] ?? 0;
                  return acc + val;
                },
                0
              );
              const avgPrevious = sum / trendData.data.length;
              const trendPercentage =
                avgPrevious > 0
                  ? ((latestValue - avgPrevious) / avgPrevious) * 100
                  : 0;
              setTrend(trendPercentage);
            }
          }
        }

        setLoading(false);
      } catch (error) {
        console.error("Error fetching KPI data:", error);
        setLoading(false);
      }
    };

    fetchData();

    // Set up auto-refresh
    const interval = setInterval(fetchData, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [data_sources, metric, show_trend, trend_period]);

  // Determine color based on thresholds
  const getValueColor = () => {
    if (value === null) return color;

    if (threshold_critical !== undefined && value >= threshold_critical) {
      return "#ef4444"; // Red
    }
    if (threshold_warning !== undefined && value >= threshold_warning) {
      return "#f59e0b"; // Orange
    }
    return color;
  };

  const valueColor = getValueColor();

  const getTrendIcon = () => {
    if (trend > 0) return TrendingUp;
    if (trend < 0) return TrendingDown;
    return Minus;
  };

  const getTrendColor = () => {
    if (trend > 0) return "text-green-600";
    if (trend < 0) return "text-red-600";
    return "text-gray-600";
  };

  const TrendIcon = getTrendIcon();

  return (
    <WidgetWrapper
      title={title}
      isEditMode={isEditMode}
      onSettings={onSettings}
      onRemove={onRemove}
    >
      <div className="flex flex-col items-center justify-center h-full p-6">
        {loading ? (
          <div className="animate-pulse">
            <div className="h-12 w-32 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 w-20 bg-gray-200 rounded mx-auto"></div>
          </div>
        ) : (
          <>
            <div
              className="text-4xl font-bold mb-1"
              style={{ color: valueColor }}
            >
              {value !== null ? value.toFixed(decimal_places) : "0"}
              {unit && <span className="text-2xl ml-1">{unit}</span>}
            </div>

            {show_trend && (
              <div className={`flex items-center gap-1 text-sm ${getTrendColor()}`}>
                <TrendIcon className="w-4 h-4" />
                <span>{Math.abs(trend).toFixed(1)}%</span>
              </div>
            )}

            {(!data_sources || data_sources.length === 0) && (
              <div className="text-xs text-gray-400 mt-2">
                No device bound - configure widget
              </div>
            )}
          </>
        )}
      </div>
    </WidgetWrapper>
  );
}
