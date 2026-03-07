"use client";

import { useEffect, useState, useCallback } from "react";

interface GaugeConfig {
  min?: number;
  max?: number;
  unit?: string;
  decimal_places?: number;
  threshold_warning?: number;
  threshold_critical?: number;
  color_safe?: string;
  color_warning?: string;
  color_critical?: string;
  show_value?: boolean;
}

interface GaugeWidgetProps {
  config: GaugeConfig;
  dataSources: Array<{
    device_id: string;
    metric: string;
    alias?: string;
  }>;
}

export default function GaugeWidget({ config, dataSources }: GaugeWidgetProps) {
  const [value, setValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    min = 0,
    max = 100,
    unit = "%",
    decimal_places = 1,
    threshold_warning = 70,
    threshold_critical = 90,
    color_safe = "#10b981",
    color_warning = "#f59e0b",
    color_critical = "#ef4444",
    show_value = true,
  } = config;

  const fetchData = useCallback(async () => {
    try {
      if (!dataSources || dataSources.length === 0) {
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
      const source = dataSources[0];
      const deviceId = source.device_id;
      const metricName = source.metric;

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      const params = new URLSearchParams({
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        per_page: "1",
        metrics: metricName,
      });

      const response = await fetch(
        `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        setValue(null);
        setLoading(false);
        return;
      }

      const data = await response.json();
      // API returns SuccessResponse: { data: [...], meta: {...} }
      // Each row is pivoted: { timestamp, temperature: 25.5, humidity: 65 }
      const dataPoint = data.data?.[0];
      const latestValue = dataPoint?.[metricName];

      setValue(typeof latestValue === "number" ? latestValue : null);
      setLoading(false);
    } catch (error) {
      console.error("[GaugeWidget] Error fetching data:", error);
      setValue(null);
      setLoading(false);
    }
  }, [dataSources]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // SVG gauge parameters
  const size = 180;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // 270-degree arc, gap at bottom
  const arcLength = (270 / 360) * circumference;

  const percentage = value !== null ? ((value - min) / (max - min)) * 100 : 0;
  const clampedPct = Math.max(0, Math.min(100, percentage));
  const offset = circumference - (clampedPct / 100) * arcLength;

  const getColor = () => {
    if (value === null) return "#e5e7eb";
    const pct = ((value - min) / (max - min)) * 100;
    if (pct >= threshold_critical) return color_critical;
    if (pct >= threshold_warning) return color_warning;
    return color_safe;
  };

  const currentColor = getColor();
  const center = size / 2;

  if (!dataSources || dataSources.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-th-muted text-sm">
        No device bound — configure widget
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-3 gap-2">
      <div className="relative">
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference - arcLength}`}
            strokeDashoffset={-circumference / 4}
          />
          {/* Value arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={value !== null ? currentColor : "#e5e7eb"}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference - arcLength}`}
            strokeDashoffset={-circumference / 4 + offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>

        {show_value && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {value !== null ? (
              <>
                <span className="text-3xl font-bold leading-none" style={{ color: currentColor }}>
                  {value.toFixed(decimal_places)}
                </span>
                <span className="text-xs text-th-secondary mt-0.5">{unit}</span>
              </>
            ) : (
              <span className="text-sm text-th-muted">No data</span>
            )}
          </div>
        )}
      </div>

      {/* Min / Max labels */}
      <div className="flex justify-between w-full max-w-[180px] text-xs text-th-muted -mt-3">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>

      {/* Threshold legend */}
      <div className="flex gap-3 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color_warning }} />
          <span className="text-th-secondary">Warn {threshold_warning}%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color_critical }} />
          <span className="text-th-secondary">Crit {threshold_critical}%</span>
        </div>
      </div>
    </div>
  );
}