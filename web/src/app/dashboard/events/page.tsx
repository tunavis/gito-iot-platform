'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import PageShell from '@/components/ui/PageShell';
import {
  Activity, Wifi, WifiOff, Bell, BellOff, Zap, AlertTriangle,
  Info, ChevronDown, ChevronRight, RefreshCw, Filter, X,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface IoTEvent {
  id: string;
  tenant_id: string;
  device_id: string | null;
  device_name: string | null;
  event_type: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string | null;
  payload: Record<string, unknown>;
  ts: string;
}

interface Meta {
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

interface Filters {
  device_id: string;
  event_type: string;
  severity: string;
  from: string;
  to: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getAuth() {
  const token = localStorage.getItem('auth_token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return { token, tenantId: payload.tenant_id as string };
}

const SEVERITY_CONFIG = {
  INFO:     { color: 'text-blue-400',    bg: 'bg-blue-500/10',    icon: <Info className="w-3.5 h-3.5" /> },
  WARNING:  { color: 'text-amber-400',   bg: 'bg-amber-500/10',   icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  ERROR:    { color: 'text-red-400',     bg: 'bg-red-500/10',     icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  CRITICAL: { color: 'text-red-500',     bg: 'bg-red-500/15',     icon: <Zap className="w-3.5 h-3.5" /> },
} as const;

const EVENT_TYPE_ICONS: Record<string, React.ReactNode> = {
  'device.connected':          <Wifi className="w-4 h-4 text-emerald-400" />,
  'device.disconnected':       <WifiOff className="w-4 h-4 text-slate-400" />,
  'alarm.raised':              <Bell className="w-4 h-4 text-amber-400" />,
  'alarm.cleared':             <BellOff className="w-4 h-4 text-emerald-400" />,
  'alarm.acknowledged':        <Bell className="w-4 h-4 text-blue-400" />,
  'telemetry.threshold_crossed': <Zap className="w-4 h-4 text-red-400" />,
};

function formatRelative(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

function formatExact(ts: string) {
  return new Date(ts).toLocaleString();
}

// ── Components ─────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: IoTEvent }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[event.severity] ?? SEVERITY_CONFIG.INFO;
  const typeIcon = EVENT_TYPE_ICONS[event.event_type] ?? <Activity className="w-4 h-4 text-slate-400" />;
  const hasPayload = Object.keys(event.payload ?? {}).length > 0;

  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <button
        className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors flex items-start gap-3"
        onClick={() => hasPayload && setExpanded(e => !e)}
      >
        {/* Type icon */}
        <div className="shrink-0 mt-0.5">{typeIcon}</div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-mono text-[var(--color-text-primary)]">
              {event.event_type}
            </span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${sev.bg} ${sev.color}`}>
              {sev.icon}
              {event.severity}
            </span>
          </div>
          {event.message && (
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5 truncate">{event.message}</p>
          )}
          <div className="flex items-center gap-3 mt-1">
            {event.device_name && (
              <span className="text-xs text-blue-400">{event.device_name}</span>
            )}
            <span className="text-xs text-[var(--color-text-secondary)]" title={formatExact(event.ts)}>
              {formatRelative(event.ts)}
            </span>
          </div>
        </div>

        {/* Expand toggle */}
        {hasPayload && (
          <div className="shrink-0 text-[var(--color-text-secondary)]">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        )}
      </button>

      {/* Payload drawer */}
      {expanded && hasPayload && (
        <div className="px-4 pb-3 ml-7">
          <pre className="text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-3 text-[var(--color-text-secondary)] overflow-x-auto">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  onClear,
}: {
  filters: Filters;
  onChange: (f: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const anyActive = Object.values(filters).some(v => v !== '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={filters.severity}
        onChange={e => onChange({ severity: e.target.value })}
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All severities</option>
        <option value="INFO">INFO</option>
        <option value="WARNING">WARNING</option>
        <option value="ERROR">ERROR</option>
        <option value="CRITICAL">CRITICAL</option>
      </select>

      <input
        value={filters.event_type}
        onChange={e => onChange({ event_type: e.target.value })}
        placeholder="Event type…"
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
      />

      <input
        type="datetime-local"
        value={filters.from}
        onChange={e => onChange({ from: e.target.value })}
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <span className="text-xs text-[var(--color-text-secondary)]">to</span>
      <input
        type="datetime-local"
        value={filters.to}
        onChange={e => onChange({ to: e.target.value })}
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {anyActive && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-red-400 transition-colors"
        >
          <X className="w-3 h-3" /> Clear
        </button>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: Filters = { device_id: '', event_type: '', severity: '', from: '', to: '' };

export default function EventsPage() {
  const [events, setEvents] = useState<IoTEvent[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchEvents = useCallback(async (pg: number, f: Filters, isRefresh = false) => {
    const auth = getAuth();
    if (!auth) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ page: String(pg), per_page: '50' });
      if (f.severity)   params.set('severity', f.severity);
      if (f.event_type) params.set('event_type', f.event_type);
      if (f.device_id)  params.set('device_id', f.device_id);
      if (f.from)       params.set('from', new Date(f.from).toISOString());
      if (f.to)         params.set('to', new Date(f.to).toISOString());

      const res = await fetch(
        `/api/v1/tenants/${auth.tenantId}/events?${params}`,
        { headers: { Authorization: `Bearer ${auth.token}` }, signal: ctrl.signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setEvents(json.data);
      setMeta(json.meta);
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents(page, filters);
  }, [fetchEvents, page, filters]);

  function updateFilter(patch: Partial<Filters>) {
    setFilters(f => ({ ...f, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  const SEVERITY_LABELS = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
  const severityCounts = SEVERITY_LABELS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = events.filter(e => e.severity === s).length;
    return acc;
  }, {});

  return (
    <PageShell
      title="Events"
      subtitle="Device lifecycle events, alarm state changes, and custom events"
      icon={<Activity className="w-5 h-5" />}
      action={
        <button
          onClick={() => fetchEvents(page, filters, true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      }
    >
    <div className="space-y-6">

      {/* Severity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SEVERITY_LABELS.map(sev => {
          const cfg = SEVERITY_CONFIG[sev];
          return (
            <button
              key={sev}
              onClick={() => updateFilter({ severity: filters.severity === sev ? '' : sev })}
              className={`gito-card rounded-xl p-3 text-left transition-all ${
                filters.severity === sev ? 'ring-2 ring-blue-500' : 'hover:border-[var(--color-border-hover)]'
              }`}
            >
              <div className={`flex items-center gap-1.5 ${cfg.color}`}>
                {cfg.icon}
                <span className="text-xs font-medium">{sev}</span>
              </div>
              <p className="text-xl font-bold text-[var(--color-text-primary)] mt-1">
                {meta ? events.filter(e => e.severity === sev).length : '—'}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">this page</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="gito-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-[var(--color-text-secondary)]" />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Filters</span>
        </div>
        <FilterBar filters={filters} onChange={updateFilter} onClear={clearFilters} />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Event list */}
      <div className="gito-card rounded-xl overflow-hidden">
        {/* List header */}
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {meta ? `${meta.total.toLocaleString()} events` : 'Events'}
          </span>
          {meta && meta.pages > 1 && (
            <span className="text-xs text-[var(--color-text-secondary)]">
              Page {meta.page} of {meta.pages}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40 text-[var(--color-text-secondary)] text-sm">
            Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[var(--color-text-secondary)]">
            <Activity className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No events found</p>
            <p className="text-xs mt-1">Events are generated automatically as devices connect and alarms fire</p>
          </div>
        ) : (
          <div>
            {events.map(ev => <EventRow key={ev.id} event={ev} />)}
          </div>
        )}

        {/* Pagination */}
        {meta && meta.pages > 1 && (
          <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-[var(--color-text-secondary)]">
              {page} / {meta.pages}
            </span>
            <button
              disabled={page >= meta.pages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
    </PageShell>
  );
}
