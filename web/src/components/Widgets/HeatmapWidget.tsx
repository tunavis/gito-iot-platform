"use client";

import { useEffect, useState } from "react";

interface HeatmapConfig {
  color?: string;
  time_range?: "7d" | "30d";
}

interface HeatmapWidgetProps {
  config: HeatmapConfig;
  dataSources: Array<{ device_id: string; metric?: string; alias?: string }>;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_LABELS = ["0", "6", "12", "18", "24"];

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export default function HeatmapWidget({ config, dataSources }: HeatmapWidgetProps) {
  const { color = "#3b82f6", time_range = "7d" } = config;
  // grid[dayOfWeek 0=Mon..6=Sun][hour 0..23]
  const [grid, setGrid] = useState<number[][]>(Array.from({ length: 7 }, () => Array(24).fill(0)));
  const [maxCount, setMaxCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ day: number; hour: number; count: number } | null>(null);

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

      const days = time_range === "30d" ? 30 : 7;
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

      try {
        const params = new URLSearchParams({
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          per_page: "1000",
        });
        const res = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${src.device_id}/telemetry?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) { setLoading(false); return; }
        const json = await res.json();
        const data: any[] = json.data || [];

        const newGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
        for (const point of data) {
          const ts = new Date(point.timestamp);
          if (isNaN(ts.getTime())) continue;
          // getDay() returns 0=Sun..6=Sat, remap to 0=Mon..6=Sun
          const jsDay = ts.getDay();
          const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
          const hourIdx = ts.getHours();
          newGrid[dayIdx][hourIdx]++;
        }

        let max = 1;
        for (const row of newGrid) for (const v of row) if (v > max) max = v;

        setGrid(newGrid);
        setMaxCount(max);
      } catch {
        // Keep empty grid
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

  const [cr, cg, cb] = hexToRgb(color);

  function cellColor(count: number): string {
    if (count === 0) return "#f3f4f6";
    const intensity = Math.min(count / maxCount, 1);
    const alpha = 0.15 + intensity * 0.85;
    return `rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
  }

  return (
    <div className="h-full flex flex-col p-2 gap-1 select-none">
      {/* Grid area */}
      <div className="flex flex-1 min-h-0 gap-1">
        {/* Day labels */}
        <div className="flex flex-col justify-around pr-1 flex-shrink-0">
          {DAY_LABELS.map((d) => (
            <div key={d} className="text-xs text-gray-400 leading-none" style={{ fontSize: "10px" }}>
              {d}
            </div>
          ))}
        </div>

        {/* Cells */}
        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
          {grid.map((row, dayIdx) => (
            <div key={dayIdx} className="flex gap-0.5 flex-1 min-h-0">
              {row.map((count, hourIdx) => (
                <div
                  key={hourIdx}
                  className="flex-1 rounded-sm cursor-default transition-opacity hover:opacity-80"
                  style={{ backgroundColor: cellColor(count), minWidth: 0 }}
                  onMouseEnter={() => setTooltip({ day: dayIdx, hour: hourIdx, count })}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Hour axis labels */}
      <div className="flex pl-8">
        {HOUR_LABELS.map((h, i) => (
          <div
            key={h}
            className="text-gray-400 text-center"
            style={{
              fontSize: "9px",
              position: "relative",
              left: i === 0 ? 0 : undefined,
              width: i < 4 ? "25%" : "auto",
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="text-center text-xs text-gray-500">
          {DAY_LABELS[tooltip.day]} {String(tooltip.hour).padStart(2, "0")}:00 —{" "}
          <strong>{tooltip.count}</strong> reading{tooltip.count !== 1 ? "s" : ""}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-2 justify-end">
        <span className="text-xs text-gray-400">Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <div
            key={t}
            className="w-3 h-3 rounded-sm"
            style={{
              backgroundColor: t === 0 ? "#f3f4f6" : `rgba(${cr},${cg},${cb},${0.15 + t * 0.85})`,
            }}
          />
        ))}
        <span className="text-xs text-gray-400">More</span>
      </div>
    </div>
  );
}