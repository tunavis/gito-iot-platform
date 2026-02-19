'use client';

interface DeviceHeaderProps {
  status: string;
  lastSeen: string | null;
  isLoading?: boolean;
  wsConnected?: boolean;
}

function formatTimeAgo(isoString: string | null): string {
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

export default function DeviceHeader({ status, lastSeen, isLoading = false, wsConnected = false }: DeviceHeaderProps) {
  const statusColor = status?.toLowerCase() === 'online' ? 'var(--hmi-status-online)' : 'var(--hmi-status-offline)';

  return (
    <div
      className="flex items-center justify-between px-6 h-12 border-b"
      style={{
        background: 'var(--hmi-bg-panel)',
        borderColor: 'var(--hmi-border-subtle)'
      }}
    >
      {/* Left: Status */}
      <div className="flex items-center gap-3">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: statusColor }}
        />
        <span className="text-sm font-semibold" style={{ color: 'var(--hmi-text-primary)' }}>
          {status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown'}
        </span>
      </div>

      {/* Center: Last Seen */}
      <div className="text-sm" style={{ color: 'var(--hmi-text-muted)' }}>
        Last seen: <span className="font-medium">{formatTimeAgo(lastSeen)}</span>
      </div>

      {/* Right: Connection status */}
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--hmi-text-muted)' }}>
        <div className={wsConnected ? 'w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse' : 'w-1.5 h-1.5 rounded-full bg-yellow-400'} />
        <span>{wsConnected ? 'Live' : 'Polling 15s'}</span>
      </div>
    </div>
  );
}
