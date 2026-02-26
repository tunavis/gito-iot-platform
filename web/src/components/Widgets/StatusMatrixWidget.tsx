"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Device {
  id: string;
  name: string;
  status: string;
  device_type?: string;
  last_seen?: string;
  location?: string;
}

interface StatusMatrixConfig {
  show_location?: boolean;
  show_last_seen?: boolean;
  tile_size?: "sm" | "md" | "lg";
}

interface StatusMatrixWidgetProps {
  config: StatusMatrixConfig;
  dataSources: Array<unknown>;
}

const STATUS_CONFIG: Record<string, { bg: string; border: string; dot: string; label: string }> = {
  online:      { bg: "#f0fdf4", border: "#86efac", dot: "#22c55e", label: "Online" },
  offline:     { bg: "#fef2f2", border: "#fca5a5", dot: "#ef4444", label: "Offline" },
  idle:        { bg: "#fffbeb", border: "#fcd34d", dot: "#f59e0b", label: "Idle" },
  maintenance: { bg: "#eff6ff", border: "#93c5fd", dot: "#3b82f6", label: "Maintenance" },
  error:       { bg: "#fef2f2", border: "#fca5a5", dot: "#ef4444", label: "Error" },
};

function getStatusCfg(status: string) {
  return STATUS_CONFIG[status?.toLowerCase()] ?? STATUS_CONFIG["offline"];
}

function getRelativeTime(dateStr?: string): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function StatusMatrixWidget({ config }: StatusMatrixWidgetProps) {
  const {
    show_location = false,
    show_last_seen = true,
    tile_size = "md",
  } = config;

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string>("");

  const fetchDevices = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) { setLoading(false); return; }

    const payload = JSON.parse(atob(token.split(".")[1]));
    const tid = payload.tenant_id;
    setTenantId(tid);

    try {
      const res = await fetch(
        `/api/v1/tenants/${tid}/devices?per_page=200`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) { setLoading(false); return; }

      const json = await res.json();
      setDevices(json.data || []);
    } catch {
      setDevices([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 30_000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        No devices found
      </div>
    );
  }

  const onlineCount = devices.filter((d) => d.status === "online").length;
  const offlineCount = devices.filter((d) => ["offline", "error"].includes(d.status)).length;
  const idleCount = devices.filter((d) => ["idle", "maintenance"].includes(d.status)).length;
  const healthPct = Math.round((onlineCount / devices.length) * 100);

  const tileClass = tile_size === "sm"
    ? "p-2 min-h-[56px]"
    : tile_size === "lg"
    ? "p-3 min-h-[88px]"
    : "p-2.5 min-h-[72px]";

  const gridClass = tile_size === "sm"
    ? "grid-cols-[repeat(auto-fill,minmax(90px,1fr))]"
    : tile_size === "lg"
    ? "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]"
    : "grid-cols-[repeat(auto-fill,minmax(110px,1fr))]";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Fleet health summary bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        {/* Health score */}
        <div className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: healthPct >= 80 ? "#22c55e" : healthPct >= 50 ? "#f59e0b" : "#ef4444" }}
          />
          <span className="text-sm font-bold text-gray-900">{healthPct}%</span>
          <span className="text-xs text-gray-500">fleet health</span>
        </div>

        {/* Progress bar */}
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${healthPct}%`,
              backgroundColor: healthPct >= 80 ? "#22c55e" : healthPct >= 50 ? "#f59e0b" : "#ef4444",
            }}
          />
        </div>

        {/* Counts */}
        <div className="flex items-center gap-2 text-xs flex-shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            <span className="text-gray-600">{onlineCount}</span>
          </span>
          {idleCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
              <span className="text-gray-600">{idleCount}</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
            <span className="text-gray-600">{offlineCount}</span>
          </span>
        </div>
      </div>

      {/* Device tiles grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className={`grid gap-1.5 ${gridClass}`}>
          {devices.map((device) => {
            const cfg = getStatusCfg(device.status);
            return (
              <Link
                key={device.id}
                href={`/dashboard/devices/${device.id}`}
                className={`rounded-lg border flex flex-col justify-between ${tileClass} hover:shadow-md transition-shadow`}
                style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}
              >
                {/* Status dot + name */}
                <div className="flex items-start gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: cfg.dot }}
                  />
                  <span
                    className="text-xs font-semibold leading-tight line-clamp-2 text-gray-800"
                    title={device.name}
                  >
                    {device.name}
                  </span>
                </div>

                {/* Bottom metadata */}
                <div className="mt-1 flex flex-col gap-0.5">
                  {device.device_type && tile_size !== "sm" && (
                    <span className="text-[10px] text-gray-400 truncate capitalize">
                      {device.device_type.replace(/_/g, " ")}
                    </span>
                  )}
                  {show_location && device.location && (
                    <span className="text-[10px] text-gray-400 truncate">{device.location}</span>
                  )}
                  {show_last_seen && tile_size !== "sm" && (
                    <span className="text-[10px]" style={{ color: cfg.dot }}>
                      {getRelativeTime(device.last_seen)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}