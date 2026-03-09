'use client';

import React from 'react';
import { Cpu, Radio, Clock, BarChart3, Database } from 'lucide-react';
import { Badge, CategoryBadge } from '@/components/ui/Badge';
import StatCard from '@/components/ui/StatCard';
import {
  categoryIcons,
  capabilityColors,
  capabilityLabels,
  formatSeconds,
  formatRange,
} from '../../_constants';
import type { DeviceType, DiscoveredMetric } from '../../_types';
import DataModelTable from './DataModelTable';
import DiscoveredMetricsPanel from './DiscoveredMetricsPanel';

interface DeviceTypeViewProps {
  deviceType: DeviceType;
  discoveredMetrics: DiscoveredMetric[];
  discoveredTotal: number;
  discoveredLoading: boolean;
  onRefreshDiscovered: () => void;
}

export default function DeviceTypeView({
  deviceType,
  discoveredMetrics,
  discoveredTotal,
  discoveredLoading,
  onRefreshDiscovered,
}: DeviceTypeViewProps) {
  const dt = deviceType;

  return (
    <div className="space-y-6">
      {/* Hero Identity */}
      <div className="gito-card p-6">
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${dt.color}20`, color: dt.color }}
          >
            {categoryIcons[dt.category] || <Cpu className="w-6 h-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-th-primary">{dt.name}</h2>
              <CategoryBadge category={dt.category} />
              <Badge
                variant={dt.is_active ? 'success' : 'neutral'}
                label={dt.is_active ? 'Active' : 'Inactive'}
                size="sm"
                dot
              />
            </div>
            <p className="text-sm text-th-secondary mt-1">
              {[dt.manufacturer, dt.model].filter(Boolean).join(' · ') || 'No manufacturer/model specified'}
            </p>
            {dt.description && (
              <p className="text-sm text-th-secondary mt-2">{dt.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Devices"
          value={dt.device_count}
          icon={<Cpu className="w-5 h-5" />}
          accent={dt.color}
          color={dt.color}
        />
        <StatCard
          label="Telemetry Fields"
          value={dt.data_model?.length || 0}
          icon={<Database className="w-5 h-5" />}
          accent="#3b82f6"
          color="#3b82f6"
        />
        <StatCard
          label="Protocol"
          value={(dt.connectivity?.protocol || 'mqtt').toUpperCase()}
          icon={<Radio className="w-5 h-5" />}
          accent="#8b5cf6"
          color="#8b5cf6"
        />
        <StatCard
          label="Telemetry Interval"
          value={formatSeconds(dt.default_settings?.telemetry_interval || 300)}
          icon={<Clock className="w-5 h-5" />}
          accent="#f59e0b"
          color="#f59e0b"
        />
      </div>

      {/* Data Model */}
      <div className="gito-card overflow-hidden">
        <div className="px-6 py-4 border-b border-th-default flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-th-primary">Data Model</h3>
            <span className="px-2 py-0.5 bg-panel rounded text-xs text-th-secondary font-medium">
              {dt.data_model?.length || 0} fields
            </span>
          </div>
        </div>
        <DataModelTable fields={dt.data_model || []} mode="view" />
      </div>

      {/* Capabilities */}
      {dt.capabilities?.length > 0 && (
        <div className="gito-card p-6">
          <h3 className="text-base font-semibold text-th-primary mb-4">Capabilities</h3>
          <div className="flex flex-wrap gap-2">
            {dt.capabilities.map((cap) => {
              const c = capabilityColors[cap] || { bg: 'rgba(100,116,139,0.1)', color: '#64748b', border: 'rgba(100,116,139,0.2)' };
              return (
                <span
                  key={cap}
                  className="px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}
                >
                  {capabilityLabels[cap] || cap}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Default Settings */}
      <div className="gito-card p-6">
        <h3 className="text-base font-semibold text-th-primary mb-4">Default Settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Heartbeat Interval</p>
            <p className="text-lg font-semibold font-mono text-th-primary">
              {formatSeconds(dt.default_settings?.heartbeat_interval || 60)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Telemetry Interval</p>
            <p className="text-lg font-semibold font-mono text-th-primary">
              {formatSeconds(dt.default_settings?.telemetry_interval || 300)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Offline Threshold</p>
            <p className="text-lg font-semibold font-mono text-th-primary">
              {formatSeconds(dt.default_settings?.offline_threshold || 900)}
            </p>
          </div>
        </div>
        <p className="text-xs text-th-muted mt-4">These values can be overridden per device.</p>
      </div>

      {/* Connectivity */}
      <div className="gito-card p-6">
        <h3 className="text-base font-semibold text-th-primary mb-4">Connectivity</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className="px-3 py-1 rounded-full text-xs font-bold uppercase"
              style={{ background: 'rgba(37,99,235,0.1)', color: '#3b82f6', border: '1px solid rgba(37,99,235,0.2)' }}
            >
              {dt.connectivity?.protocol || 'MQTT'}
            </span>
          </div>

          {dt.connectivity?.mqtt?.topic_pattern && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Topic Pattern</p>
              <p className="text-sm font-mono text-th-secondary bg-panel px-3 py-2 rounded-lg border border-th-subtle">
                {dt.connectivity.mqtt.topic_pattern}
              </p>
            </div>
          )}

          {dt.connectivity?.mqtt && (
            <div className="flex gap-6">
              {dt.connectivity.mqtt.qos != null && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">QoS</p>
                  <p className="text-sm font-mono text-th-primary">{dt.connectivity.mqtt.qos}</p>
                </div>
              )}
              {dt.connectivity.mqtt.retain != null && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">Retain</p>
                  <p className="text-sm text-th-primary">{dt.connectivity.mqtt.retain ? 'Yes' : 'No'}</p>
                </div>
              )}
            </div>
          )}

          {dt.connectivity?.lorawan?.lorawan_class && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-th-muted mb-1">LoRaWAN Class</p>
              <p className="text-sm font-mono text-th-primary">Class {dt.connectivity.lorawan.lorawan_class}</p>
            </div>
          )}
        </div>
      </div>

      {/* Discovered Metrics */}
      {discoveredMetrics.length > 0 && (
        <DiscoveredMetricsPanel
          metrics={discoveredMetrics}
          totalDevices={discoveredTotal}
          loading={discoveredLoading}
          onRefresh={onRefreshDiscovered}
          currentFieldNames={(dt.data_model || []).map((f) => f.name)}
        />
      )}
    </div>
  );
}
