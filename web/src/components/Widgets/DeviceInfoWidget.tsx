"use client";

import { useEffect, useState } from "react";
import {
  MapPin,
  Activity,
  Clock,
  Wifi,
  Zap,
  Gauge,
  Thermometer,
  Wind,
  MapPinned,
  Battery,
  Radio,
} from "lucide-react";

interface DeviceInfoConfig {
  show_image?: boolean;
  show_status?: boolean;
  show_location?: boolean;
  show_last_seen?: boolean;
}

interface DeviceInfoWidgetProps {
  config: DeviceInfoConfig;
  dataSources: Array<{
    device_id: string;
    metric?: string;
    alias?: string;
  }>;
}

interface DeviceData {
  id: string;
  name: string;
  device_type?: string;
  status?: string;
  last_seen?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  metadata?: any;
}

export default function DeviceInfoWidget({
  config,
  dataSources,
}: DeviceInfoWidgetProps) {
  const [device, setDevice] = useState<DeviceData | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    show_image = true,
    show_status = true,
    show_location = true,
    show_last_seen = true,
  } = config;

  useEffect(() => {
    const fetchDevice = async () => {
      try {
        console.log("[DeviceInfoWidget] dataSources:", dataSources);

        if (!dataSources || dataSources.length === 0) {
          console.log("[DeviceInfoWidget] No data sources configured");
          setDevice(null);
          setLoading(false);
          return;
        }

        const token = localStorage.getItem("auth_token");
        if (!token) {
          console.error("[DeviceInfoWidget] No auth token");
          setLoading(false);
          return;
        }

        const payload = JSON.parse(atob(token.split(".")[1]));
        const tenantId = payload.tenant_id;
        const deviceId = dataSources[0].device_id;

        console.log("[DeviceInfoWidget] Fetching device:", deviceId);

        const response = await fetch(
          `/api/v1/tenants/${tenantId}/devices/${deviceId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          console.error("[DeviceInfoWidget] API error:", response.status);
          throw new Error("Failed to fetch device");
        }

        let data = await response.json();
        console.log("[DeviceInfoWidget] Device data:", data);

        // Handle wrapped response (some endpoints return {data: {...}})
        const deviceData = data.data || data;

        console.log("[DeviceInfoWidget] Unwrapped device:", deviceData);

        // Validate essential fields
        if (!deviceData || !deviceData.id) {
          console.error("[DeviceInfoWidget] Invalid device data:", deviceData);
          setDevice(null);
          setLoading(false);
          return;
        }

        setDevice(deviceData);
        setLoading(false);
      } catch (error) {
        console.error("[DeviceInfoWidget] Error:", error);
        setDevice(null);
        setLoading(false);
      }
    };

    fetchDevice();
  }, [dataSources]);

  const isOnline = () => {
    if (!device?.last_seen) return false;
    const lastSeen = new Date(device.last_seen);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeen.getTime()) / 1000 / 60;
    return diffMinutes < 15; // Consider online if seen in last 15 minutes
  };

  const formatLastSeen = (lastSeen?: string) => {
    if (!lastSeen) return "Never";
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMinutes = Math.floor(
      (now.getTime() - date.getTime()) / 1000 / 60
    );

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const getDeviceIcon = (deviceType?: string) => {
    if (!deviceType) return <Activity className="w-8 h-8" />;

    const type = deviceType.toLowerCase();

    // Water meter - custom ANIMATED SVG illustration
    if (type.includes("water") || type.includes("flow")) {
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <defs>
            {/* Animated gradient for water flow */}
            <linearGradient id="waterFlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3">
                <animate attributeName="offset" values="0;1;0" dur="2s" repeatCount="indefinite" />
              </stop>
              <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.8">
                <animate attributeName="offset" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
              </stop>
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.3">
                <animate attributeName="offset" values="1;0;1" dur="2s" repeatCount="indefinite" />
              </stop>
            </linearGradient>
          </defs>

          {/* Meter body */}
          <circle cx="60" cy="60" r="50" fill="#0ea5e9" opacity="0.2" />
          <circle cx="60" cy="60" r="45" fill="white" stroke="#0ea5e9" strokeWidth="3">
            {online && <animate attributeName="stroke-opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite" />}
          </circle>

          {/* Gauge face */}
          <circle cx="60" cy="60" r="35" fill="#f0f9ff" />

          {/* Tick marks */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle) => {
            const rad = (angle - 90) * Math.PI / 180;
            const x1 = 60 + Math.cos(rad) * 30;
            const y1 = 60 + Math.sin(rad) * 30;
            const x2 = 60 + Math.cos(rad) * 35;
            const y2 = 60 + Math.sin(rad) * 35;
            return (
              <line
                key={angle}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#0ea5e9"
                strokeWidth="2"
              />
            );
          })}

          {/* Animated needle (swings when active) */}
          <line x1="60" y1="60" x2="60" y2="30" stroke="#0ea5e9" strokeWidth="2">
            {online && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                values="0 60 60; 15 60 60; -5 60 60; 10 60 60; 0 60 60"
                dur="4s"
                repeatCount="indefinite"
              />
            )}
          </line>
          <circle cx="60" cy="60" r="4" fill="#0ea5e9" />

          {/* Animated water droplet icon (pulses when active) */}
          <path
            d="M60 75 C 55 75, 50 70, 50 65 C 50 60, 60 50, 60 50 C 60 50, 70 60, 70 65 C 70 70, 65 75, 60 75 Z"
            fill="#0ea5e9"
          >
            {online && (
              <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
            )}
          </path>

          {/* Animated flow arrows (move when active) */}
          <g opacity={online ? "1" : "0.3"}>
            <path d="M 25 60 L 35 60 L 30 55 M 35 60 L 30 65" stroke={online ? "url(#waterFlow)" : "#0ea5e9"} strokeWidth="2" fill="none">
              {online && <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite" />}
            </path>
            <path d="M 85 60 L 95 60 L 90 55 M 95 60 L 90 65" stroke={online ? "url(#waterFlow)" : "#0ea5e9"} strokeWidth="2" fill="none">
              {online && <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0.5s" repeatCount="indefinite" />}
            </path>
            {/* Extra flowing water particles when active */}
            {online && (
              <>
                <circle cx="20" cy="60" r="2" fill="#0ea5e9">
                  <animate attributeName="cx" values="20;40;20" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" />
                </circle>
                <circle cx="80" cy="60" r="2" fill="#0ea5e9">
                  <animate attributeName="cx" values="80;100;80" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" />
                </circle>
              </>
            )}
          </g>
        </svg>
      );
    }

    if (type.includes("energy") || type.includes("electric") || type.includes("power")) {
      return <Zap className="w-8 h-8" />;
    }
    if (type.includes("temperature") || type.includes("temp")) {
      return <Thermometer className="w-8 h-8" />;
    }
    if (type.includes("gps") || type.includes("tracker") || type.includes("vehicle")) {
      return <MapPinned className="w-8 h-8" />;
    }
    if (type.includes("battery")) {
      return <Battery className="w-8 h-8" />;
    }
    if (type.includes("gas") || type.includes("air")) {
      return <Wind className="w-8 h-8" />;
    }
    if (type.includes("sensor")) {
      return <Radio className="w-8 h-8" />;
    }
    if (type.includes("meter") || type.includes("gauge")) {
      return <Gauge className="w-8 h-8" />;
    }
    return <Activity className="w-8 h-8" />;
  };

  const getDeviceColor = (deviceType?: string) => {
    if (!deviceType) return "from-blue-500 to-blue-600";

    const type = deviceType.toLowerCase();
    if (type.includes("water") || type.includes("flow")) {
      return "from-cyan-500 to-blue-600";
    }
    if (type.includes("energy") || type.includes("electric") || type.includes("power")) {
      return "from-amber-500 to-orange-600";
    }
    if (type.includes("temperature")) {
      return "from-red-500 to-pink-600";
    }
    if (type.includes("gps") || type.includes("tracker")) {
      return "from-purple-500 to-indigo-600";
    }
    if (type.includes("gas") || type.includes("air")) {
      return "from-green-500 to-emerald-600";
    }
    return "from-blue-500 to-blue-600";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <Activity className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No device selected</p>
        </div>
      </div>
    );
  }

  const online = isOnline();
  const isWaterType = device.device_type?.toLowerCase().includes("water") || device.device_type?.toLowerCase().includes("flow");
  const hasCustomSvg = isWaterType;

  return (
    <div className="h-full flex flex-col bg-white rounded-lg overflow-hidden">
      {/* Header row - Device name + status */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 truncate">
            {device.name || "Unknown Device"}
          </h3>
          {device.device_type && (
            <p className="text-xs text-gray-500 capitalize mt-0.5">
              {device.device_type.replace(/_/g, " ")}
            </p>
          )}
        </div>
        {show_status && (
          <div
            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
              online
                ? "bg-green-50 text-green-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                online ? "bg-green-500 animate-pulse" : "bg-gray-400"
              }`}
            ></div>
            {online ? "Online" : "Offline"}
          </div>
        )}
      </div>

      {/* SVG Visualization - hero section */}
      <div className="flex-1 flex items-center justify-center px-4 py-2 min-h-0">
        {hasCustomSvg ? (
          <div className="w-full h-full max-w-[160px] max-h-[160px]">
            {getDeviceIcon(device.device_type)}
          </div>
        ) : (
          <div
            className={`w-20 h-20 bg-gradient-to-br ${getDeviceColor(
              device.device_type
            )} rounded-xl flex items-center justify-center text-white`}
          >
            {getDeviceIcon(device.device_type)}
          </div>
        )}
      </div>

    </div>
  );
}
