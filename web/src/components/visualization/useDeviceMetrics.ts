'use client';

/**
 * useDeviceMetrics — Real-time device telemetry data hook
 *
 * Provides live telemetry values via:
 *   1. REST fetch on mount (latest values, 30-day lookback)
 *   2. WebSocket push (zero-latency real-time updates)
 *   3. Polling fallback (15s interval when WebSocket is disconnected)
 *
 * Returns normalized values compatible with MetricRenderer and FlowLine.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { DeviceMetrics } from './types';

export type { DeviceMetrics };

const POLL_INTERVAL     = 15_000;  // ms — fallback poll interval
const WS_RECONNECT_BASE = 5_000;   // ms — base WebSocket reconnect delay
const WS_MAX_ATTEMPTS   = 10;

const SYSTEM_FIELDS = new Set([
  'timestamp', 'device_id', 'tenant_id', 'id', 'ts',
  'metric_key', 'metric_value', 'metric_value_str', 'metric_value_json',
  // Aggregation artifacts — never real sensor metrics
  'time_bucket', 'sample_count',
]);

function isUnitField(key: string): boolean {
  return key.endsWith('_unit');
}

function parseValue(val: unknown): number | string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return (!isNaN(num) && trimmed !== '') ? num : trimmed;
  }
  return String(val);
}

export default function useDeviceMetrics(
  deviceId: string,
  tenantId: string,
  enabled = true
): DeviceMetrics {
  const [latestValues, setLatestValues]     = useState<Record<string, number | string | null>>({});
  const [units, setUnits]                   = useState<Record<string, string>>({});
  const [lastUpdated, setLastUpdated]       = useState<string | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [wsConnected, setWsConnected]       = useState(false);
  const [activeAlarmCount, setAlarmCount]   = useState(0);

  const wsRef          = useRef<WebSocket | null>(null);
  const wsAttemptsRef  = useRef(0);
  const wsTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getToken = useCallback(() => localStorage.getItem('auth_token'), []);

  // ── Fetch latest telemetry ────────────────────────────────────────────────
  const fetchLatest = useCallback(async () => {
    const token = getToken();
    if (!token || !tenantId || !deviceId) return;

    try {
      const res = await fetch(
        `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry/latest?minutes=43200`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.status === 404) {
        setLatestValues({});
        setUnits({});
        setLastUpdated(null);
        setError(null);
        return;
      }
      if (!res.ok) { setError('Failed to fetch telemetry'); return; }

      const json = await res.json();
      const data = json.data ?? json;

      const values: Record<string, number | string | null> = {};
      const extractedUnits: Record<string, string> = {};
      let timestamp: string | null = null;

      if (Array.isArray(data)) {
        if (data.length > 0 && data[0].metric_key) {
          // Key-value row format
          for (const row of data) {
            const key = row.metric_key;
            if (key && !SYSTEM_FIELDS.has(key) && !isUnitField(key)) {
              values[key] = parseValue(row.metric_value ?? row.metric_value_str);
              if (row.unit) extractedUnits[key] = row.unit;
            }
          }
          if (data[0].ts) timestamp = data[0].ts;
        } else if (data.length > 0) {
          // Legacy flat object format
          const latest = data[data.length - 1];
          for (const [key, val] of Object.entries(latest)) {
            if (SYSTEM_FIELDS.has(key)) {
              if (key === 'timestamp') timestamp = val as string;
              continue;
            }
            if (isUnitField(key)) {
              const metricKey = key.replace(/_unit$/, '');
              if (typeof val === 'string') extractedUnits[metricKey] = val;
              continue;
            }
            values[key] = parseValue(val);
          }
        }
      } else if (typeof data === 'object' && data !== null) {
        for (const [key, val] of Object.entries(data)) {
          if (SYSTEM_FIELDS.has(key)) {
            if (key === 'timestamp') timestamp = val as string;
            continue;
          }
          if (isUnitField(key)) {
            const metricKey = key.replace(/_unit$/, '');
            if (typeof val === 'string') extractedUnits[metricKey] = val;
            continue;
          }
          values[key] = parseValue(val);
        }
      }

      setLatestValues(values);
      setUnits(extractedUnits);
      setLastUpdated(timestamp);
      setError(null);
    } catch {
      setError('Failed to fetch telemetry');
    }
  }, [deviceId, tenantId, getToken]);

  // ── Fetch active alarm count ──────────────────────────────────────────────
  const fetchAlarms = useCallback(async () => {
    const token = getToken();
    if (!token || !tenantId || !deviceId) return;
    try {
      const res = await fetch(
        `/api/v1/tenants/${tenantId}/alarms?device_id=${deviceId}&status=ACTIVE&page_size=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return;
      const json = await res.json();
      setAlarmCount(json.total ?? json.data?.length ?? 0);
    } catch {
      // Alarm fetch failure is non-critical
    }
  }, [deviceId, tenantId, getToken]);

  // ── Apply WebSocket telemetry push ────────────────────────────────────────
  const applyWsTelemetry = useCallback((payload: Record<string, unknown>, timestamp: string) => {
    setLatestValues(prev => {
      const next = { ...prev };
      for (const [key, val] of Object.entries(payload)) {
        if (SYSTEM_FIELDS.has(key)) continue;
        next[key] = parseValue(val);
      }
      return next;
    });
    setLastUpdated(timestamp);
  }, []);

  // ── WebSocket connection with exponential back-off ────────────────────────
  const connectWs = useCallback(() => {
    const token = getToken();
    if (!token || !tenantId || !deviceId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const proto  = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl  = `${proto}//${window.location.host}/api/v1/ws/devices/${deviceId}?token=${encodeURIComponent(token)}`;
      const ws     = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
        wsAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'telemetry' && msg.data?.payload) {
            applyWsTelemetry(msg.data.payload as Record<string, unknown>, msg.data.timestamp);
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        if (wsAttemptsRef.current < WS_MAX_ATTEMPTS) {
          wsAttemptsRef.current += 1;
          const delay = WS_RECONNECT_BASE * Math.min(wsAttemptsRef.current, 4);
          wsTimerRef.current = setTimeout(connectWs, delay);
        }
      };

      ws.onerror = () => ws.close();
      wsRef.current = ws;
    } catch { /* WebSocket unavailable — polling fallback covers it */ }
  }, [deviceId, tenantId, getToken, applyWsTelemetry]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !deviceId || !tenantId) return;
    setLoading(true);
    Promise.all([fetchLatest(), fetchAlarms()]).then(() => setLoading(false));
  }, [enabled, deviceId, tenantId, fetchLatest, fetchAlarms]);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !deviceId || !tenantId) return;
    connectWs();
    return () => {
      if (wsTimerRef.current) clearTimeout(wsTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, deviceId, tenantId, connectWs]);

  // ── Polling fallback (only when WebSocket is down) ────────────────────────
  useEffect(() => {
    if (!enabled || !deviceId || !tenantId) return;
    const iv = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) fetchLatest();
      fetchAlarms();
    }, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [enabled, deviceId, tenantId, fetchLatest, fetchAlarms]);

  return { latestValues, units, lastUpdated, loading, error, wsConnected, activeAlarmCount };
}
