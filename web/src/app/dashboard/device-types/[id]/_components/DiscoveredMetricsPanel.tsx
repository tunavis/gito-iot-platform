'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import type { DiscoveredMetric } from '../../_types';

interface DiscoveredMetricsPanelProps {
  metrics: DiscoveredMetric[];
  totalDevices: number;
  loading: boolean;
  onRefresh: () => void;
  /** Current field names in the data model — used to check in_schema live */
  currentFieldNames?: string[];
  /** If provided, shows "+ Add" button for undeclared metrics */
  onAddField?: (metricKey: string) => void;
}

export default function DiscoveredMetricsPanel({
  metrics,
  totalDevices,
  loading,
  onRefresh,
  currentFieldNames = [],
  onAddField,
}: DiscoveredMetricsPanelProps) {
  return (
    <div className="p-4 bg-panel border border-th-default rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-th-primary">
          Discovered Metrics
          {totalDevices > 0 && (
            <span className="ml-2 text-xs font-normal text-th-secondary">
              from {totalDevices} device{totalDevices !== 1 ? 's' : ''}, last 7 days
            </span>
          )}
        </h4>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 hover:bg-page rounded text-th-secondary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && metrics.length === 0 ? (
        <p className="text-xs text-th-secondary">Loading...</p>
      ) : metrics.length === 0 ? (
        <p className="text-xs text-th-secondary">
          No telemetry received from devices of this type yet.
        </p>
      ) : (
        <div className="space-y-1">
          {metrics.map((m) => {
            const inSchema = currentFieldNames.includes(m.key);
            return (
              <div
                key={m.key}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-page transition-colors"
              >
                <div className="flex items-center gap-2">
                  {inSchema ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                  )}
                  <span className={`text-sm font-mono ${inSchema ? 'text-th-primary' : 'font-medium'}`}
                    style={inSchema ? undefined : { color: '#f59e0b' }}
                  >
                    {m.key}
                  </span>
                  <span className="text-xs text-th-muted">
                    {m.device_count}/{totalDevices} device{totalDevices !== 1 ? 's' : ''}
                  </span>
                </div>
                {!inSchema && onAddField && (
                  <button
                    type="button"
                    onClick={() => onAddField(m.key)}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-0.5 hover:bg-page rounded transition-colors"
                  >
                    + Add
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
