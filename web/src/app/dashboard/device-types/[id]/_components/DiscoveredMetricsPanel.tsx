'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, KeyRound } from 'lucide-react';
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
  /** If provided, shows a "Map to…" picker so an undeclared raw key can be
   *  renamed into an existing metric instead of added as a new one. */
  onMapField?: (rawKey: string, canonicalName: string) => void;
  /** rawKey -> canonical name for keys already mapped (from key_mapping). */
  renameMap?: Record<string, string>;
}

export default function DiscoveredMetricsPanel({
  metrics,
  totalDevices,
  loading,
  onRefresh,
  currentFieldNames = [],
  onAddField,
  onMapField,
  renameMap = {},
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
            const mappedTo = renameMap[m.key];
            const handled = inSchema || !!mappedTo;
            return (
              <div
                key={m.key}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-page transition-colors gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {inSchema ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  ) : mappedTo ? (
                    <KeyRound className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#8b5cf6' }} />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                  )}
                  <span className={`text-sm font-mono truncate ${handled ? 'text-th-primary' : 'font-medium'}`}
                    style={handled ? undefined : { color: '#f59e0b' }}
                  >
                    {m.key}
                  </span>
                  {mappedTo && (
                    <span className="text-xs font-mono text-th-muted flex-shrink-0">→ {mappedTo}</span>
                  )}
                  <span className="text-xs text-th-muted flex-shrink-0">
                    {m.device_count}/{totalDevices} device{totalDevices !== 1 ? 's' : ''}
                  </span>
                </div>
                {!handled && (onAddField || onMapField) && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {onMapField && currentFieldNames.length > 0 && (
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) onMapField(m.key, e.target.value); }}
                        title={`Rename ${m.key} into an existing metric`}
                        className="text-xs bg-surface border border-[var(--color-input-border)] rounded px-1.5 py-0.5 text-th-secondary focus:outline-none focus:ring-1 focus:ring-primary-500"
                      >
                        <option value="" disabled>Map to…</option>
                        {currentFieldNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    )}
                    {onAddField && (
                      <button
                        type="button"
                        onClick={() => onAddField(m.key)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-0.5 hover:bg-page rounded transition-colors"
                      >
                        + Add
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
