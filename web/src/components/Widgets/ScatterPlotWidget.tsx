"use client";

import { useEffect, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ScatterPlotConfig {
  x_label?: string;
  y_label?: string;
  color?: string;
  time_range?: string;
}

interface ScatterPlotWidgetProps {
  config: ScatterPlotConfig;
  dataSources: Array<{ device_id: string; metric: string; alias?: string }>;
}

function parseHours(range: string): number {
  if (range.includes("d")) return parseInt(range) * 24;
  return parseInt(range) || 24;
}

export default function ScatterPlotWidget({ config, dataSources }: ScatterPlotWidgetProps) {
  const { color = "#3b82f6", time_range = "24h" } = config;
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [loading, setLoading] = useState(true);

  const xSource = dataSources?.[0];
  const ySource = dataSources?.[1];
  const xLabel = config.x_label || xSource?.alias || xSource?.metric || "X";
  const yLabel = config.y_label || ySource?.alias || ySource?.metric || "Y";

  useEffect(() => {
    const fetchData = async () => {
      if (!xSource || !ySource) {
        setLoading(false);
        return;
      }

      const token = localStorage.getItem("auth_token");
      if (!token) { setLoading(false); return; }
      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - parseHours(time_range) * 60 * 60 * 1000);

      const fetchSeries = async (src: { device_id: string; metric: string }) => {
        const params = new URLSearchParams({
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          per_page: "500",
        });
        const res = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${src.device_id}/telemetry?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return [];
        const json = await res.json();
        return (json.data || []).map((p: any) => ({
          ts: new Date(p.timestamp).getTime(),
          value: Number(p[src.metric]),
        })).filter((p: { ts: number; value: number }) => !isNaN(p.ts) && !isNaN(p.value));
      };

      try {
        const [xSeries, ySeries] = await Promise.all([
          fetchSeries(xSource),
          fetchSeries(ySource),
        ]);

        // Inner join by nearest timestamp (within 60s tolerance)
        const TOLERANCE_MS = 60 * 1000;
        const matched: Array<{ x: number; y: number }> = [];

        for (const xp of xSeries) {
          let closest: { ts: number; value: number } | null = null;
          let minDiff = Infinity;
          for (const yp of ySeries) {
            const diff = Math.abs(xp.ts - yp.ts);
            if (diff < minDiff && diff <= TOLERANCE_MS) {
              minDiff = diff;
              closest = yp;
            }
          }
          if (closest) {
            matched.push({ x: xp.value, y: closest.value });
          }
        }

        setPoints(matched);
      } catch {
        setPoints([]);
      }

      setLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [dataSources, time_range]);

  if (!xSource || !ySource) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm text-center px-4">
        Bind two metrics to see correlation (X axis + Y axis)
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

  if (points.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        No correlated data in {time_range}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="x"
              type="number"
              name={xLabel}
              label={{ value: xLabel, position: "insideBottom", offset: -10, fontSize: 11, fill: "#9ca3af" }}
              stroke="#9ca3af"
              fontSize={11}
              tickLine={false}
              domain={["auto", "auto"]}
            />
            <YAxis
              dataKey="y"
              type="number"
              name={yLabel}
              label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: "#9ca3af" }}
              stroke="#9ca3af"
              fontSize={11}
              tickLine={false}
              domain={["auto", "auto"]}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow-sm">
                    <div>{xLabel}: <strong>{d.x?.toFixed(2)}</strong></div>
                    <div>{yLabel}: <strong>{d.y?.toFixed(2)}</strong></div>
                  </div>
                );
              }}
            />
            <Scatter data={points} fill={color} fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center text-xs text-gray-400 pb-1">{points.length} data points matched</div>
    </div>
  );
}