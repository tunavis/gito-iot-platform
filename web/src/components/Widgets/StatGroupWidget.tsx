"use client";

import { useEffect, useState } from "react";

interface StatGroupConfig {
  unit?: string;
  time_range?: string;
  decimal_places?: number;
  color?: string;
}

interface StatGroupWidgetProps {
  config: StatGroupConfig;
  dataSources: Array<{ device_id: string; metric: string; alias?: string }>;
}

function parseHours(range: string): number {
  if (range.includes("d")) return parseInt(range) * 24;
  return parseInt(range) || 24;
}

function fmt(val: number | null, dp: number, unit: string): string {
  if (val === null) return "—";
  return `${val.toFixed(dp)}${unit ? " " + unit : ""}`;
}

export default function StatGroupWidget({ config, dataSources }: StatGroupWidgetProps) {
  const {
    unit = "",
    time_range = "24h",
    decimal_places = 2,
    color = "#3b82f6",
  } = config;

  const [stats, setStats] = useState<{
    latest: number | null;
    avg: number | null;
    min: number | null;
    max: number | null;
  }>({ latest: null, avg: null, min: null, max: null });
  const [loading, setLoading] = useState(true);
  const [metricLabel, setMetricLabel] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      if (!dataSources || dataSources.length === 0) {
        setLoading(false);
        return;
      }

      const token = localStorage.getItem("auth_token");
      if (!token) { setLoading(false); return; }
      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const src = dataSources[0];
      setMetricLabel(src.alias || src.metric);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - parseHours(time_range) * 60 * 60 * 1000);

      try {
        const params = new URLSearchParams({
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          per_page: "500",
        });
        const res = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${src.device_id}/telemetry?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) { setLoading(false); return; }
        const json = await res.json();
        const data: any[] = json.data || [];

        const values = data
          .map((p) => p[src.metric])
          .filter((v) => v !== undefined && v !== null)
          .map(Number)
          .filter((v) => !isNaN(v));

        if (values.length === 0) {
          setStats({ latest: null, avg: null, min: null, max: null });
        } else {
          const latest = values[values.length - 1];
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          const min = Math.min(...values);
          const max = Math.max(...values);
          setStats({ latest, avg, min, max });
        }
      } catch {
        setStats({ latest: null, avg: null, min: null, max: null });
      }

      setLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [dataSources, time_range]);

  if (!dataSources || dataSources.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        No device bound — configure widget
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const statCards = [
    { label: "Latest", value: stats.latest, accent: true },
    { label: "Average", value: stats.avg, accent: false },
    { label: "Minimum", value: stats.min, accent: false },
    { label: "Maximum", value: stats.max, accent: false },
  ];

  return (
    <div className="h-full flex flex-col gap-2 p-1">
      {metricLabel && (
        <div className="text-xs text-gray-500 font-medium text-center truncate">{metricLabel} · {time_range}</div>
      )}
      <div className="grid grid-cols-2 gap-2 flex-1">
        {statCards.map(({ label, value, accent }) => (
          <div
            key={label}
            className="rounded-lg border flex flex-col items-center justify-center p-3 min-h-0"
            style={{
              borderColor: accent ? color : "#e5e7eb",
              backgroundColor: accent ? `${color}10` : "#f9fafb",
            }}
          >
            <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
            <div
              className="text-lg font-bold truncate max-w-full"
              style={{ color: accent ? color : "#374151" }}
            >
              {fmt(value, decimal_places, unit)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}