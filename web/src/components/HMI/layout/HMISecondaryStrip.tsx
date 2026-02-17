'use client';

import { formatValue } from '../svg/helpers';

interface Metric {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
}

interface HMISecondaryStripProps {
  metrics: Metric[];
  maxVisible?: number;
}

export default function HMISecondaryStrip({ metrics, maxVisible = 6 }: HMISecondaryStripProps) {
  const displayMetrics = metrics.slice(0, maxVisible);

  if (displayMetrics.length === 0) {
    return null;
  }

  return (
    <div
      className="w-full border-t"
      style={{
        borderColor: 'var(--hmi-border-subtle)',
        background: 'var(--hmi-bg-panel)'
      }}
    >
      <div
        className="grid gap-px"
        style={{
          gridTemplateColumns: `repeat(${Math.min(displayMetrics.length, 6)}, minmax(0, 1fr))`,
          background: 'var(--hmi-border-subtle)'
        }}
      >
        {displayMetrics.map((metric) => {
          const formattedValue = typeof metric.value === 'number'
            ? formatValue(metric.value)
            : metric.value ?? '--';

          return (
            <div
              key={metric.key}
              className="px-4 py-3"
              style={{ background: 'var(--hmi-bg-panel)' }}
            >
              <div className="text-xs" style={{ color: 'var(--hmi-text-muted)' }}>
                {metric.label}
              </div>
              <div
                className="text-base font-semibold mt-1"
                style={{
                  color: 'var(--hmi-text-value)',
                  fontFamily: 'var(--hmi-font-mono)'
                }}
              >
                {formattedValue}{metric.unit ? ` ${metric.unit}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
