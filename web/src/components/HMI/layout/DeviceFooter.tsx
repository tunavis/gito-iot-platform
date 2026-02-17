'use client';

interface DeviceFooterProps {
  protocol?: string;
  deviceType?: string;
  alarmCount: number;
}

export default function DeviceFooter({ protocol, deviceType, alarmCount }: DeviceFooterProps) {
  return (
    <div
      className="flex items-center justify-between px-6 h-12 border-t text-sm"
      style={{
        background: 'var(--hmi-bg-panel)',
        borderColor: 'var(--hmi-border-subtle)',
        color: 'var(--hmi-text-muted)'
      }}
    >
      {/* Left: Protocol */}
      <div>
        Protocol: <span className="font-semibold" style={{ color: 'var(--hmi-text-primary)' }}>{protocol || 'N/A'}</span>
      </div>

      {/* Center: Alarms */}
      <div>
        Alarms: <span
          className="font-semibold"
          style={{ color: alarmCount > 0 ? 'var(--hmi-status-alarm)' : 'var(--hmi-text-primary)' }}
        >
          {alarmCount}
        </span>
      </div>

      {/* Right: Device Type */}
      <div>
        Type: <span className="font-semibold" style={{ color: 'var(--hmi-text-primary)' }}>{deviceType || 'Unknown'}</span>
      </div>
    </div>
  );
}
