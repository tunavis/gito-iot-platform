'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useHMIData from '../useHMIData';

import GenericTile from './GenericTile';
import SensorTile from './SensorTile';
import MeterTile from './MeterTile';
import GatewayTile from './GatewayTile';
import TrackerTile from './TrackerTile';
import ActuatorTile from './ActuatorTile';
import ControllerTile from './ControllerTile';

import type { HMIRendererProps } from '../index';

const TILE_RENDERERS: Record<string, React.ComponentType<HMIRendererProps>> = {
  sensor: SensorTile,
  meter: MeterTile,
  gateway: GatewayTile,
  tracker: TrackerTile,
  actuator: ActuatorTile,
  controller: ControllerTile,
  camera: GenericTile,
  other: GenericTile,
};

interface HMITileCardProps {
  device: any;
  deviceType: any;
  tenantId: string;
  staggerIndex?: number;
}

export default function HMITileCard({ device, deviceType, tenantId, staggerIndex = 0 }: HMITileCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const delay = staggerIndex * 200 + Math.random() * 500;
    const timer = setTimeout(() => setShouldLoad(true), delay);
    return () => clearTimeout(timer);
  }, [isVisible, staggerIndex]);

  const { latestValues, units, sparklineData, activeAlarmCount, loading } = useHMIData(
    device.id,
    tenantId,
    shouldLoad
  );

  const category = deviceType?.category?.toLowerCase() || 'other';
  const TileRenderer = TILE_RENDERERS[category] || GenericTile;

  return (
    <Link href={`/dashboard/devices/${device.id}`}>
      <div
        ref={containerRef}
        className="border border-gray-200 rounded-lg bg-white hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer overflow-hidden"
        style={{ height: '220px' }}
      >
        {/* Tile header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              device.status === 'online' ? 'bg-green-500' :
              device.status === 'error' ? 'bg-red-500' :
              device.status === 'idle' ? 'bg-amber-500' :
              'bg-slate-400'
            }`}
          />
          <span className="text-sm font-medium text-gray-800 truncate flex-1">{device.name}</span>
          {activeAlarmCount > 0 && (
            <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
              {activeAlarmCount}
            </span>
          )}
        </div>

        {/* Tile body */}
        <div className="p-3 h-[calc(100%-40px)] overflow-hidden">
          {!shouldLoad ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
            </div>
          ) : (
            <TileRenderer
              device={device}
              deviceType={deviceType}
              latestValues={latestValues}
              units={units}
              sparklineData={sparklineData}
              activeAlarmCount={activeAlarmCount}
              loading={loading}
            />
          )}
        </div>
      </div>
    </Link>
  );
}
