'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';

interface MapDevice {
  id: string;
  name: string;
  device_type: string;
  device_type_id?: string;
  status: 'online' | 'offline' | 'idle';
  last_seen: string | null;
  battery_level: number | null;
  signal_strength: number | null;
  attributes: {
    latitude: number;
    longitude: number;
    [key: string]: any;
  };
}

interface DeviceMapViewProps {
  devices: MapDevice[];
  selectedDevice: MapDevice | null;
  onSelectDevice: (device: MapDevice | null) => void;
}

// Custom marker icons
const createMarkerIcon = (status: 'online' | 'offline' | 'idle') => {
  const color = status === 'online' ? '#10b981' : status === 'offline' ? '#ef4444' : '#f59e0b';
  const shadowColor = status === 'online' ? 'rgba(16, 185, 129, 0.3)' : status === 'offline' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)';

  return L.divIcon({
    html: `
      <div style="position: relative;">
        <div style="
          width: 32px;
          height: 32px;
          background: ${color};
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 8px ${shadowColor}, 0 0 0 8px ${shadowColor};
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
        </div>
      </div>
    `,
    className: 'custom-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
};

// Map bounds adjuster component
function MapBoundsAdjuster({ devices }: { devices: MapDevice[] }) {
  const map = useMap();

  useEffect(() => {
    if (devices.length > 0) {
      const bounds = L.latLngBounds(
        devices.map(d => [d.attributes.latitude, d.attributes.longitude] as [number, number])
      );
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }, [devices, map]);

  return null;
}

export default function DeviceMapView({ devices, selectedDevice, onSelectDevice }: DeviceMapViewProps) {
  const mapRef = useRef<L.Map | null>(null);

  // Default center (will be adjusted based on devices)
  const defaultCenter: [number, number] = [40.7128, -74.0060]; // New York
  const defaultZoom = 4;

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: '100%', width: '100%', zIndex: 0 }}
        ref={mapRef}
        zoomControl={true}
      >
        {/* Base map tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Adjust map bounds to show all devices */}
        <MapBoundsAdjuster devices={devices} />

        {/* Device markers */}
        {devices.map(device => (
          <Marker
            key={device.id}
            position={[device.attributes.latitude, device.attributes.longitude]}
            icon={createMarkerIcon(device.status)}
            eventHandlers={{
              click: () => onSelectDevice(device)
            }}
          >
            <Popup>
              <div className="p-2 min-w-[200px]">
                <h4 className="font-semibold text-gray-900 mb-2">{device.name}</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Status:</span>
                    <span className={`font-semibold capitalize ${
                      device.status === 'online' ? 'text-green-600' :
                      device.status === 'offline' ? 'text-red-600' :
                      'text-yellow-600'
                    }`}>
                      {device.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <span className="text-gray-900 text-xs">
                      {device.device_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>
                  {device.battery_level !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Battery:</span>
                      <span className="text-gray-900 font-medium">
                        {Math.round(device.battery_level)}%
                      </span>
                    </div>
                  )}
                  {device.last_seen && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Last seen:</span>
                      <span className="text-gray-900 text-xs">
                        {new Date(device.last_seen).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDevice(device);
                  }}
                  className="mt-3 w-full px-3 py-1.5 bg-primary-600 text-white rounded text-sm font-medium hover:bg-primary-700 transition-colors"
                >
                  View Details
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-8 left-8 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-[1000]">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Device Status</h4>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow"></div>
            <span className="text-sm text-gray-700">Online ({devices.filter(d => d.status === 'online').length})</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow"></div>
            <span className="text-sm text-gray-700">Offline ({devices.filter(d => d.status === 'offline').length})</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-yellow-500 rounded-full border-2 border-white shadow"></div>
            <span className="text-sm text-gray-700">Idle ({devices.filter(d => d.status === 'idle').length})</span>
          </div>
        </div>
      </div>

      {/* Map Controls Info */}
      <div className="absolute top-8 left-8 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-2 z-[1000]">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">{devices.length}</span> devices on map
        </p>
      </div>
    </div>
  );
}
