"use client";

import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface PieChartConfig {
  donut?: boolean;
  show_legend?: boolean;
  colors?: string[];
}

interface PieChartWidgetProps {
  config: PieChartConfig;
  dataSources: Array<{ device_id: string; metric: string; alias?: string }>;
}

const DEFAULT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export default function PieChartWidget({ config, dataSources }: PieChartWidgetProps) {
  const { donut = false, show_legend = true, colors = DEFAULT_COLORS } = config;
  const [slices, setSlices] = useState<Array<{ name: string; value: number }>>([]);
  const [loading, setLoading] = useState(true);

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

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      const results = await Promise.all(
        dataSources.map(async (src) => {
          const params = new URLSearchParams({
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            per_page: "1",
          });
          try {
            const res = await fetch(
              `/api/v1/tenants/${tenantId}/devices/${src.device_id}/telemetry?${params}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!res.ok) return { name: src.alias || src.metric, value: 0 };
            const json = await res.json();
            const point = (json.data || [])[0];
            const raw = point?.[src.metric];
            const value = raw !== undefined && raw !== null ? Math.abs(Number(raw)) : 0;
            return { name: src.alias || src.metric, value: isNaN(value) ? 0 : value };
          } catch {
            return { name: src.alias || src.metric, value: 0 };
          }
        })
      );

      setSlices(results);
      setLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [dataSources]);

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

  const total = slices.reduce((s, d) => s + d.value, 0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={donut ? "50%" : 0}
              outerRadius="75%"
              paddingAngle={2}
              dataKey="value"
            >
              {slices.map((_, index) => (
                <Cell key={index} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [
                value.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                name,
              ]}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.375rem",
                fontSize: "12px",
              }}
            />
            {show_legend && <Legend wrapperStyle={{ fontSize: "12px" }} />}
          </PieChart>
        </ResponsiveContainer>
        {donut && total > 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-800">
                {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </div>
              <div className="text-xs text-gray-500">total</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}