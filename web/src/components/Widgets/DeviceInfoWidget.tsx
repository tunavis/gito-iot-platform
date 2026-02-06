"use client";

import { useEffect, useState } from "react";
import {
  MapPin,
  Activity,
  Clock,
  Wifi,
  WifiOff,
  Droplet,
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

interface DeviceType {
  id: string;
  name: string;
  category: string;
  icon: string;
  color: string;
}

interface DeviceData {
  id: string;
  name: string;
  device_type_id?: string;
  device_type?: DeviceType;
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

  const getDeviceIcon = (deviceType?: DeviceType) => {
    if (!deviceType) return <Activity className="w-8 h-8" />;

    const type = (deviceType.name || deviceType.category || '').toLowerCase();

    // Water meter - custom SVG illustration
    if (type.includes("water") || type.includes("flow")) {
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          {/* Meter body */}
          <circle cx="60" cy="60" r="50" fill="#0ea5e9" opacity="0.2" />
          <circle cx="60" cy="60" r="45" fill="white" stroke="#0ea5e9" strokeWidth="3" />

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

          {/* Needle */}
          <line x1="60" y1="60" x2="60" y2="30" stroke="#0ea5e9" strokeWidth="2" />
          <circle cx="60" cy="60" r="4" fill="#0ea5e9" />

          {/* Water droplet icon */}
          <path
            d="M60 75 C 55 75, 50 70, 50 65 C 50 60, 60 50, 60 50 C 60 50, 70 60, 70 65 C 70 70, 65 75, 60 75 Z"
            fill="#0ea5e9"
          />

          {/* Flow arrows */}
          <path d="M 25 60 L 35 60 L 30 55 M 35 60 L 30 65" stroke="#0ea5e9" strokeWidth="2" fill="none" />
          <path d="M 85 60 L 95 60 L 90 55 M 95 60 L 90 65" stroke="#0ea5e9" strokeWidth="2" fill="none" />
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

  const getDeviceColor = (deviceType?: DeviceType) => {
    if (!deviceType) return "from-blue-500 to-blue-600";

    const type = (deviceType.name || deviceType.category || '').toLowerCase();
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

  const getDeviceImageUrl = (deviceType?: string) => {
    if (!deviceType) return null;

    const type = deviceType.toLowerCase();

    // Water meter images
    if (type.includes("water") || type.includes("flow")) {
      return "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=400&h=300&fit=crop";
    }

    // Energy/Electric meter images
    if (type.includes("energy") || type.includes("electric") || type.includes("power") || type.includes("meter")) {
      return "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=400&h=300&fit=crop";
    }

    // Temperature sensor images
    if (type.includes("temperature") || type.includes("thermometer")) {
      return "https://images.unsplash.com/photo-1607400201889-565b1ee75f8e?w=400&h=300&fit=crop";
    }

    // GPS tracker / Vehicle images
    if (type.includes("gps") || type.includes("tracker") || type.includes("vehicle")) {
      return "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=400&h=300&fit=crop";
    }

    // Gas/Air sensor images
    if (type.includes("gas") || type.includes("air") || type.includes("environmental")) {
      return "https://images.unsplash.com/photo-1534237710431-e2fc698436d0?w=400&h=300&fit=crop";
    }

    return null; // Fallback to icon
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

  return (
    <div className="h-full p-4 flex gap-4 bg-white rounded-lg">
      {/* Left Side - Device Image */}
      <div className="w-32 flex-shrink-0 flex items-center justify-center">
        <div
          className={`w-28 h-28 bg-gradient-to-br ${getDeviceColor(
            device.device_type
          )} rounded-xl flex items-center justify-center text-white shadow-lg`}
        >
          {getDeviceIcon(device.device_type)}
        </div>
      </div>

      {/* Right Side - Device Details */}
      <div className="flex-1 flex flex-col">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 truncate">
            {device.name || "Unknown Device"}
          </h3>
          {device.device_type && (
            <p
              className="text-sm font-medium px-2 py-0.5 rounded inline-block"
              style={{
                backgroundColor: device.device_type.color ? `${device.device_type.color}20` : '#f3f4f6',
                color: device.device_type.color || '#6b7280'
              }}
            >
              {device.device_type.name}
            </p>
          )}
        </div>

        {/* Device Details */}
        <div className="space-y-3 flex-1">
        {/* Status */}
        {show_status && (
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
            {online ? (
              <>
                <Wifi className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-600">
                  Online
                </span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-500">
                  Offline
                </span>
              </>
            )}
          </div>
        )}

        {/* Last Seen */}
        {show_last_seen && device.last_seen && (
          <div className="flex items-start gap-2 text-sm">
            <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-gray-500">Last seen</div>
              <div className="text-gray-900 font-medium">
                {formatLastSeen(device.last_seen)}
              </div>
            </div>
          </div>
        )}

        {/* Location */}
        {show_location && (device.latitude || device.location) && (
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-gray-500">Location</div>
              {device.location ? (
                <div className="text-gray-900 font-medium">
                  {device.location}
                </div>
              ) : (
                <div className="text-gray-900 font-medium">
                  {device.latitude?.toFixed(6)}, {device.longitude?.toFixed(6)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Device ID */}
        {device.id && (
          <div className="flex items-start gap-2 text-sm">
            <Activity className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-gray-500">Device ID</div>
              <div className="text-gray-900 font-mono text-xs truncate">
                {device.id.split("-")[0]}...
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Status Badge at Bottom */}
        <div className="mt-auto pt-3 border-t border-gray-200">
          <div
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
              online
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full mr-1.5 ${
                online ? "bg-green-500 animate-pulse" : "bg-gray-400"
              }`}
            ></div>
            {online ? "Active" : "Inactive"}
          </div>
        </div>
      </div>
    </div>
  );
}
