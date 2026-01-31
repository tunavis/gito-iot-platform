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
    color = "#3b82f6",
    threshold_warning,
    threshold_critical,
  } = configuration;

  useEffect(() => {
    // Fetch latest value from device
    const fetchData = async () => {
      try {
        // TODO: REMOVE MOCK DATA AFTER REAL API INTEGRATION
        // This is TEMPORARY demo data for Iteration 1
        // Replace with actual API call to:
        // GET /api/v1/tenants/{tenant_id}/devices/{device_id}/telemetry?metric={metric}

        // MOCK DATA - TO BE REMOVED:
        const mockValue = Math.random() * 100;
        const mockTrend = (Math.random() - 0.5) * 20;

        setValue(mockValue);
        setTrend(mockTrend);
        setLoading(false);

        /* REAL IMPLEMENTATION (Uncomment when ready):
        if (!data_sources || data_sources.length === 0) {
          setValue(null);
          setLoading(false);
          return;
        }

        const token = localStorage.getItem('auth_token');
        const payload = JSON.parse(atob(token.split('.')[1]));
        const tenantId = payload.tenant_id;
        const source = data_sources[0];
        const deviceId = source.device_id;
        const metricName = source.metric || metric;

        const response = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry?metric=${metricName}&limit=1`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (!response.ok) throw new Error('Failed to fetch telemetry');

        const data = await response.json();
        const latestValue = data.data?.[0]?.[metricName];

        setValue(latestValue ?? null);

        // Calculate trend (compare with previous period)
        const trendResponse = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry?metric=${metricName}&time_range=${trend_period}`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const trendData = await trendResponse.json();
        const avgPrevious = calculateAverage(trendData.data);
        const trendPercentage = ((latestValue - avgPrevious) / avgPrevious) * 100;

        setTrend(trendPercentage);
        setLoading(false);
        */
      } catch (error) {
        console.error("Error fetching KPI data:", error);
        setLoading(false);
      }
    };

    fetchData();

    // Set up auto-refresh
    const interval = setInterval(fetchData, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [data_sources, metric]);

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
                Demo data - bind device in production
              </div>
            )}
          </>
        )}
      </div>
    </WidgetWrapper>
  );
}
