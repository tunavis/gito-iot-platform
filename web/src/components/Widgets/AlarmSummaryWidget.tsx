"use client";

import { useEffect, useState } from "react";

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; order: number }> = {
  CRITICAL: { color: "#ef4444", bg: "#fef2f2", order: 0 },
  MAJOR:    { color: "#f97316", bg: "#fff7ed", order: 1 },
  MINOR:    { color: "#f59e0b", bg: "#fffbeb", order: 2 },
  WARNING:  { color: "#3b82f6", bg: "#eff6ff", order: 3 },
  INFO:     { color: "#6b7280", bg: "#f9fafb", order: 4 },
};

interface AlarmSummaryWidgetProps {
  config: Record<string, never>;
  dataSources: Array<unknown>;
}

export default function AlarmSummaryWidget({ config: _config, dataSources: _ds }: AlarmSummaryWidgetProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const token = localStorage.getItem("auth_token");
      if (!token) { setLoading(false); return; }
      const payload = JSON.parse(atob(token.split(".")[1]));
      const tenantId = payload.tenant_id;

      try {
        const res = await fetch(
          `/api/v1/tenants/${tenantId}/alarms?status=ACTIVE&page_size=100`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) { setLoading(false); return; }
        const json = await res.json();
        const alarms: any[] = json.data || [];

        const grouped: Record<string, number> = {};
        for (const alarm of alarms) {
          const sev = (alarm.severity || "INFO").toUpperCase();
          grouped[sev] = (grouped[sev] || 0) + 1;
        }

        setCounts(grouped);
        setTotal(alarms.length);
      } catch {
        setCounts({});
        setTotal(0);
      }

      setLoading(false);
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-sm font-medium text-green-700">No active alarms</div>
      </div>
    );
  }

  const sortedEntries = Object.entries(counts).sort(([a], [b]) => {
    const ao = SEVERITY_CONFIG[a]?.order ?? 99;
    const bo = SEVERITY_CONFIG[b]?.order ?? 99;
    return ao - bo;
  });

  return (
    <div className="h-full flex flex-col p-2 gap-2">
      {/* Total */}
      <div className="flex items-center justify-between px-2 py-1 bg-gray-50 rounded-lg border border-gray-200">
        <span className="text-sm font-semibold text-gray-700">Active Alarms</span>
        <span className="text-xl font-bold text-red-600">{total}</span>
      </div>

      {/* Per-severity rows */}
      <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto">
        {sortedEntries.map(([sev, count]) => {
          const cfg = SEVERITY_CONFIG[sev] || { color: "#6b7280", bg: "#f9fafb" };
          return (
            <div
              key={sev}
              className="flex items-center justify-between px-3 py-2 rounded-lg border"
              style={{ backgroundColor: cfg.bg, borderColor: `${cfg.color}40` }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cfg.color }}
                />
                <span className="text-sm font-medium" style={{ color: cfg.color }}>
                  {sev.charAt(0) + sev.slice(1).toLowerCase()}
                </span>
              </div>
              <span className="text-sm font-bold" style={{ color: cfg.color }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}