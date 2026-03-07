import React from 'react';

export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'purple';
export type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  variant?: BadgeVariant;
  label: string;
  dot?: boolean;
  icon?: React.ReactNode;
  size?: BadgeSize;
  className?: string;
}

const variantStyles: Record<BadgeVariant, { bg: string; color: string; border: string; dot: string }> = {
  success: {
    bg:     'rgba(22, 163, 74, 0.12)',
    color:  '#16a34a',
    border: 'rgba(22, 163, 74, 0.25)',
    dot:    '#16a34a',
  },
  danger: {
    bg:     'rgba(220, 38, 38, 0.12)',
    color:  '#dc2626',
    border: 'rgba(220, 38, 38, 0.25)',
    dot:    '#dc2626',
  },
  warning: {
    bg:     'rgba(217, 119, 6, 0.12)',
    color:  '#d97706',
    border: 'rgba(217, 119, 6, 0.25)',
    dot:    '#f59e0b',
  },
  info: {
    bg:     'rgba(37, 99, 235, 0.12)',
    color:  '#2563eb',
    border: 'rgba(37, 99, 235, 0.25)',
    dot:    '#3b82f6',
  },
  neutral: {
    bg:     'rgba(100, 116, 139, 0.1)',
    color:  'var(--color-text-secondary)',
    border: 'rgba(100, 116, 139, 0.2)',
    dot:    '#64748b',
  },
  purple: {
    bg:     'rgba(124, 58, 237, 0.12)',
    color:  '#7c3aed',
    border: 'rgba(124, 58, 237, 0.25)',
    dot:    '#7c3aed',
  },
};

export function Badge({ variant = 'neutral', label, dot, icon, size = 'sm', className = '' }: BadgeProps) {
  const s = variantStyles[variant];
  const padding = size === 'sm' ? '2px 8px' : '4px 10px';
  const fontSize = size === 'sm' ? '11px' : '12px';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${className}`}
      style={{
        background:   s.bg,
        color:        s.color,
        border:       `1px solid ${s.border}`,
        padding,
        fontSize,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          className={variant === 'danger' || variant === 'success' ? 'hmi-pulse' : ''}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: s.dot,
            flexShrink: 0,
            display: 'inline-block',
          }}
        />
      )}
      {icon && <span className="flex-shrink-0" style={{ lineHeight: 0 }}>{icon}</span>}
      {label}
    </span>
  );
}

/* ─── Convenience helpers ─────────────────────────────────────────────────── */

export function DeviceStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    online:  'success',
    offline: 'danger',
    idle:    'warning',
    error:   'danger',
  };
  return <Badge variant={map[status] ?? 'neutral'} label={status} dot />;
}

export function AlarmSeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, BadgeVariant> = {
    CRITICAL: 'danger',
    MAJOR:    'danger',
    MINOR:    'warning',
    WARNING:  'info',
  };
  const labels: Record<string, string> = {
    CRITICAL: 'Critical',
    MAJOR:    'Major',
    MINOR:    'Minor',
    WARNING:  'Warning',
  };
  return <Badge variant={map[severity] ?? 'neutral'} label={labels[severity] ?? severity} />;
}

export function AlarmStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    ACTIVE:       'danger',
    ACKNOWLEDGED: 'warning',
    CLEARED:      'success',
  };
  const labels: Record<string, string> = {
    ACTIVE:       'Active',
    ACKNOWLEDGED: 'Acknowledged',
    CLEARED:      'Cleared',
  };
  return <Badge variant={map[status] ?? 'neutral'} label={labels[status] ?? status} dot={status === 'ACTIVE'} />;
}

export function UserRoleBadge({ role }: { role: string }) {
  const map: Record<string, BadgeVariant> = {
    SUPER_ADMIN:  'danger',
    TENANT_ADMIN: 'purple',
    SITE_ADMIN:   'info',
    CLIENT:       'warning',
    VIEWER:       'neutral',
  };
  return (
    <Badge
      variant={map[role] ?? 'neutral'}
      label={role.replace(/_/g, ' ')}
    />
  );
}

export function UserStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    active:    'success',
    inactive:  'neutral',
    suspended: 'danger',
  };
  return <Badge variant={map[status] ?? 'neutral'} label={status} dot={status === 'active'} />;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, BadgeVariant> = {
    critical: 'danger',
    warning:  'warning',
    info:     'info',
  };
  return <Badge variant={map[severity] ?? 'neutral'} label={severity} />;
}

export function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, BadgeVariant> = {
    sensor:     'success',
    gateway:    'purple',
    actuator:   'danger',
    tracker:    'info',
    meter:      'info',
    camera:     'neutral',
    controller: 'warning',
    other:      'neutral',
  };
  return <Badge variant={map[category] ?? 'neutral'} label={category} />;
}
