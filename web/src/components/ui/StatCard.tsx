import { TrendingUp, TrendingDown } from 'lucide-react';
import IconTile from './IconTile';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: number; direction: 'up' | 'down' };
  color?: string;
  accent?: string;
}

export default function StatCard({ label, value, icon, trend, color, accent }: StatCardProps) {
  const accentColor = accent || '#2563eb';

  return (
    <div
      className="gito-card p-5 relative overflow-hidden group"
    >
      {/* Subtle top accent line on hover */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
      />

      <div className="flex items-start justify-between mb-3">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}
        >
          {label}
        </span>
        {icon && <IconTile color={accentColor} icon={icon} size="sm" />}
      </div>

      <div className="flex items-end gap-2">
        <span
          className="text-2xl font-bold tracking-tight font-mono"
          style={color ? { color } : { color: 'var(--color-text-primary)' }}
        >
          {value}
        </span>
        {trend && (
          <span
            className="flex items-center gap-0.5 text-xs font-semibold mb-0.5 px-1.5 py-0.5 rounded-md"
            style={
              trend.direction === 'up'
                ? { color: '#16a34a', background: 'rgba(22,163,74,0.1)' }
                : { color: '#dc2626', background: 'rgba(220,38,38,0.1)' }
            }
          >
            {trend.direction === 'up'
              ? <TrendingUp className="w-3 h-3" />
              : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend.value).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}