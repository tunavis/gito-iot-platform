/**
 * Health signalling shared by the hierarchy page and its canvas nodes.
 * Lifted out of `dashboard/hierarchy/page.tsx` so the node components and the
 * detail sidebar cannot drift apart on what "amber" means.
 */

export function healthColor(alarms: number, online: number, total: number): string {
  if (alarms > 0) return '#ef4444'; // red
  if (total > 0 && online / total < 0.8) return '#f59e0b'; // amber
  return '#22c55e'; // green
}

export function HealthDot({ alarms, online, total }: { alarms: number; online: number; total: number }) {
  const color = healthColor(alarms, online, total);
  return (
    <span
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: color, boxShadow: `0 0 5px ${color}60` }}
    />
  );
}

export function AlarmBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
      style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
    >
      {count}
    </span>
  );
}
