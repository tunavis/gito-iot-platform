'use client';

/**
 * MetricRenderer — Generic Metric Visualization Dispatcher
 *
 * Selects the correct visualization based on MetricDefinition.category.
 * Never references device names, IDs, or per-device logic.
 *
 * Categories:
 *   flow        → FlowLine (animated SVG dashes, speed ∝ value)
 *   scalar      → Large numeric value + unit label
 *   level       → Vertical fill bar (0 – max)
 *   state       → Colored text badge
 *   time-series → Latest value display (full chart in future phase)
 */

import React, { useMemo } from 'react';
import FlowLine from './FlowLine';
import type { MetricDefinition } from './types';
import { formatMetricLabel } from '@/lib/formatMetricLabel';

export interface MetricRendererProps {
  /** The metric key (e.g. "flow_rate", "temperature") */
  metricKey: string;
  /** Current value from telemetry */
  value: number | string | null;
  /** Metric definition — category, unit, max, effect, etc. */
  definition: MetricDefinition;
  /** Optional override for display label */
  label?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


function formatNumeric(val: number): string {
  if (Math.abs(val) >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(val) >= 10)   return val.toFixed(1);
  return val.toFixed(2);
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

// ─── Sub-renderers ────────────────────────────────────────────────────────────

function FlowRenderer({ value, definition }: { value: number; definition: MetricDefinition }) {
  const max = Math.abs(definition.max ?? 100);
  const absVal = Math.abs(value);
  const formatted = formatNumeric(absVal);

  return (
    <div className="flex flex-col gap-2">
      <FlowLine
        value={value}
        maxValue={max}
        effect={definition.effect ?? 'water'}
        direction="horizontal"
        thickness={8}
        length={220}
      />
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
          {formatted}
        </span>
        {definition.unit && (
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{definition.unit}</span>
        )}
        {value < 0 && (
          <span className="text-xs ml-1" style={{ color: 'var(--color-text-muted)' }}>↩ reverse</span>
        )}
      </div>
    </div>
  );
}

function ScalarRenderer({ value, definition }: { value: number; definition: MetricDefinition }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
        {formatNumeric(value)}
      </span>
      {definition.unit && (
        <span className="text-base" style={{ color: 'var(--color-text-muted)' }}>{definition.unit}</span>
      )}
    </div>
  );
}

function LevelRenderer({ value, definition }: { value: number; definition: MetricDefinition }) {
  const min = definition.min ?? 0;
  const max = definition.max ?? 100;
  const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);

  const color =
    pct > 75 ? '#22c55e' :   // green
    pct > 35 ? '#3b82f6' :   // blue
    pct > 15 ? '#f59e0b' :   // amber
               '#ef4444';     // red

  return (
    <div className="flex items-end gap-3">
      {/* Vertical bar */}
      <div className="relative w-5 h-20 rounded-sm overflow-hidden" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
        <div
          className="absolute bottom-0 left-0 right-0 rounded-sm transition-all duration-700"
          style={{ height: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex flex-col">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
            {formatNumeric(value)}
          </span>
          {definition.unit && (
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{definition.unit}</span>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function StateRenderer({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const { bg, text } =
    ['online', 'running', 'active', 'open', 'on', 'true', '1'].includes(lower)
      ? { bg: 'bg-emerald-500/20', text: 'text-emerald-400' }
    : ['offline', 'stopped', 'inactive', 'closed', 'off', 'false', '0'].includes(lower)
      ? { bg: 'bg-red-500/20', text: 'text-red-400' }
    : ['warning', 'idle', 'standby', 'partial'].includes(lower)
      ? { bg: 'bg-amber-500/20', text: 'text-amber-400' }
    : { bg: 'bg-slate-500/15', text: 'text-slate-500' };

  return (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${bg} ${text}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-2 opacity-80" />
      {value}
    </span>
  );
}

// ─── MetricRenderer ───────────────────────────────────────────────────────────

export default function MetricRenderer({ metricKey, value, definition, label }: MetricRendererProps) {
  const displayLabel = label ?? definition.label ?? formatMetricLabel(metricKey);

  const content = useMemo(() => {
    // No data
    if (value === null || value === undefined) {
      return (
        <span className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>No data</span>
      );
    }

    const { category } = definition;

    // State: string or state category
    if (category === 'state' || typeof value === 'string') {
      return <StateRenderer value={String(value)} />;
    }

    const numVal = typeof value === 'number' ? value : Number(value);
    if (isNaN(numVal)) {
      return <StateRenderer value={String(value)} />;
    }

    switch (category) {
      case 'flow':
        return <FlowRenderer value={numVal} definition={definition} />;
      case 'level':
        return <LevelRenderer value={numVal} definition={definition} />;
      case 'time-series':
      case 'scalar':
      default:
        return <ScalarRenderer value={numVal} definition={definition} />;
    }
  }, [value, definition]);

  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl gito-card">
      <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
        {displayLabel}
      </span>
      {content}
    </div>
  );
}
