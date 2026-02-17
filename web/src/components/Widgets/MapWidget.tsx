"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";

// Dynamically import Leaflet components to avoid SSR issues
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
);

interface MapConfig {
  zoom?: number;
  show_label?: boolean;
  center_lat?: number;
  center_lng?: number;
}

interface MapWidgetProps {
  config: MapConfig;
  dataSources: Array<{
    device_id: string;
    metric?: string;
    alias?: string;
  }>;
}

interface DeviceLocation {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  attributes?: Record<string, any>;
}

export default function MapWidget({ config, dataSources }: MapWidgetProps) {
  const [devices, setDevices] = useState<DeviceLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  const { zoom = 15, show_label = true, center_lat, center_lng } = config;

  useEffect(() => {
    // Leaflet requires window object
    setMapReady(typeof window !== "undefined");

    const fetchDevices = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        if (!token) {
          setLoading(false);
          return;
        }

        const payload = JSON.parse(atob(token.split(".")[1]));
        const tenantId = payload.tenant_id;

        // If no data sources bound, show ALL devices with location
        if (!dataSources || dataSources.length === 0) {
          console.log("[MapWidget] No bindings - showing all devices with location");

          const response = await fetch(
            `/api/v1/tenants/${tenantId}/devices?per_page=100`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (!response.ok) {
            setLoading(false);
            return;
          }

          const result = await response.json();
          const allDevices = result.data || [];
          // Extract GPS from attributes JSONB or top-level fields
          const devicesWithGPS = allDevices.map((d: any) => ({
            ...d,
            latitude: d.latitude ?? d.attributes?.latitude,
            longitude: d.longitude ?? d.attributes?.longitude,
          }));
          const validDevices = devicesWithGPS.filter(
            (d: any) => d.latitude && d.longitude
          );

          console.log("[MapWidget] Found devices with location:", validDevices.length);
          setDevices(validDevices);
          setLoading(false);
          return;
        }

        // Fetch specific bound devices
        const devicePromises = dataSources.map(async (ds) => {
          try {
            const response = await fetch(
              `/api/v1/tenants/${tenantId}/devices/${ds.device_id}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );

            if (!response.ok) return null;

            const device = await response.json();
            return device;
          } catch (error) {
            console.error(`Failed to fetch device ${ds.device_id}:`, error);
            return null;
          }
        });

        const results = await Promise.all(devicePromises);
        // Extract GPS from attributes JSONB or top-level fields
        const devicesWithGPS = results
          .filter((d) => d !== null)
          .map((d: any) => ({
            ...d,
            latitude: d.latitude ?? d.attributes?.latitude,
            longitude: d.longitude ?? d.attributes?.longitude,
          }));
        const validDevices = devicesWithGPS.filter(
          (d) => d.latitude && d.longitude
        );
        setDevices(validDevices);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching device locations:", error);
        setLoading(false);
      }
    };

    fetchDevices();
  }, [dataSources]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 p-4">
        <div className="text-center text-gray-500 max-w-xs">
          <MapPin className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p className="text-sm font-medium text-gray-700 mb-1">
            No Device Locations Set
          </p>
          <p className="text-xs text-gray-500">
            Add latitude and longitude to your devices to see them on the map
          </p>
          <button
            onClick={() => (window.location.href = "/dashboard/devices")}
            className="mt-3 text-xs text-blue-600 hover:text-blue-700 underline"
          >
            Go to Devices
          </button>
        </div>
      </div>
    );
  }

  if (!mapReady) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-sm text-gray-500">Loading map...</div>
      </div>
    );
  }

  // Calculate center point (use first device or config)
  const centerLat =
    center_lat ?? devices[0]?.latitude ?? 40.7128;
  const centerLng =
    center_lng ?? devices[0]?.longitude ?? -74.006;

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={zoom}
        style={{ height: "100%", width: "100%", borderRadius: "0.5rem" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {devices.map((device) => {
          if (!device.latitude || !device.longitude) return null;

          return (
            <Marker
              key={device.id}
              position={[device.latitude, device.longitude]}
            >
              {show_label && (
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold text-gray-900">
                      {device.name}
                    </div>
                    {device.location && (
                      <div className="text-gray-600 mt-1">{device.location}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">
                      {device.latitude.toFixed(6)}, {device.longitude.toFixed(6)}
                    </div>
                  </div>
                </Popup>
              )}
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
