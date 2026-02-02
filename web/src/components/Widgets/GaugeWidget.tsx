"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    const fetchData = async () => {
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

        // Get latest value (last 24 hours)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

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
        setLoading(false);
      } catch (error) {
        console.error("Error fetching gauge data:", error);
        setLoading(false);
      }
    };

    fetchData();

    // Set up auto-refresh
    const interval = setInterval(fetchData, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [dataSources]);

  // Calculate gauge properties
  const percentage = value !== null ? ((value - min) / (max - min)) * 100 : 0;
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  // Determine color based on thresholds
  const getColor = () => {
    if (value === null) return color_safe;
    const percentValue = ((value - min) / (max - min)) * 100;
    if (percentValue >= threshold_critical) return color_critical;
    if (percentValue >= threshold_warning) return color_warning;
    return color_safe;
  };

  const currentColor = getColor();

  // SVG gauge parameters
  const size = 200;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Calculate arc for gauge (270 degrees, leaving 90 degrees gap at bottom)
  const startAngle = 135; // Start at bottom-left
  const endAngle = 405; // End at bottom-right (270 degrees total)
  const arcLength = (270 / 360) * circumference;
  const offset = circumference - (clampedPercentage / 100) * arcLength;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (value === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <svg
            className="w-16 h-16 mx-auto mb-2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <p className="text-sm">No data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      {/* Gauge SVG */}
      <div className="relative">
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background arc */}
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
            stroke={currentColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference - arcLength}`}
            strokeDashoffset={-circumference / 4 + offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>

        {/* Center value display */}
        {show_value && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-4xl font-bold" style={{ color: currentColor }}>
              {value.toFixed(decimal_places)}
            </div>
            <div className="text-sm text-gray-600 mt-1">{unit}</div>
          </div>
        )}
      </div>

      {/* Min/Max labels */}
      <div className="flex justify-between w-full max-w-[200px] mt-2 text-xs text-gray-500">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>

      {/* Threshold indicators */}
      {(threshold_warning !== undefined || threshold_critical !== undefined) && (
        <div className="flex gap-4 mt-4 text-xs">
          {threshold_warning !== undefined && (
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color_warning }}
              ></div>
              <span className="text-gray-600">
                Warning: {threshold_warning}%
              </span>
            </div>
          )}
          {threshold_critical !== undefined && (
            <div className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color_critical }}
              ></div>
              <span className="text-gray-600">
                Critical: {threshold_critical}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
