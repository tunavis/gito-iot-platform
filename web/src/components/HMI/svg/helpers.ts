// Shared SVG geometry and formatting helpers
// Extracted from IndustrialGauge.tsx — used across all SVG HMI primitives

export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

export function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function percentage(value: number, min: number, max: number): number {
  const range = max - min || 1;
  return (clamp(value, min, max) - min) / range;
}

export function formatValue(v: number | string | null, precision?: number): string {
  if (v === null || v === undefined) return '--';
  if (typeof v === 'string') return v;
  if (Number.isInteger(v)) return v.toLocaleString();
  return v.toFixed(precision ?? 1);
}

export function formatCompactValue(v: number | null): string {
  if (v === null) return '--';
  if (Math.abs(v) >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export function getStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'online':
    case 'active':
      return 'var(--hmi-status-online)';
    case 'offline':
    case 'inactive':
      return 'var(--hmi-status-offline)';
    case 'idle':
      return 'var(--hmi-status-idle)';
    case 'error':
    case 'fault':
      return 'var(--hmi-status-alarm)';
    default:
      return 'var(--hmi-status-offline)';
  }
}

export function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 0) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Threshold color logic for gauges
export function getThresholdColor(
  value: number | null,
  thresholdWarning?: number,
  thresholdCritical?: number,
  accentColor = 'var(--hmi-gauge-fill)'
): string {
  if (value === null) return '#94a3b8';
  if (thresholdCritical !== undefined && value >= thresholdCritical) return 'var(--hmi-status-alarm)';
  if (thresholdWarning !== undefined && value >= thresholdWarning) return 'var(--hmi-status-warn)';
  return accentColor;
}
