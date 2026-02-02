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

        const data = await response.json();
        console.log("[DeviceInfoWidget] Device data:", data);

        // Validate essential fields
        if (!data || !data.id) {
          console.error("[DeviceInfoWidget] Invalid device data:", data);
          setDevice(null);
          setLoading(false);
          return;
        }

        setDevice(data);
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
    if (type.includes("water") || type.includes("flow")) {
      return <Droplet className="w-8 h-8" />;
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

  return (
    <div className="h-full p-4 flex flex-col">
      {/* Device Header */}
      <div className="flex items-start gap-3 mb-4">
        {show_image && (
          <div className="flex-shrink-0">
            {device.metadata?.image_url ? (
              <img
                src={device.metadata.image_url}
                alt={device.name || "Device"}
                className="w-24 h-24 rounded-lg object-cover shadow-lg border-2 border-gray-200"
              />
            ) : (
              <div
                className={`w-16 h-16 bg-gradient-to-br ${getDeviceColor(
                  device.device_type
                )} rounded-lg flex items-center justify-center text-white shadow-lg`}
              >
                {getDeviceIcon(device.device_type)}
              </div>
            )}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 truncate">
            {device.name || "Unknown Device"}
          </h3>
          {device.device_type && (
            <p className="text-sm text-gray-500 capitalize">
              {device.device_type.replace(/_/g, " ")}
            </p>
          )}
        </div>
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
      <div className="mt-4 pt-3 border-t border-gray-200">
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
  );
}
