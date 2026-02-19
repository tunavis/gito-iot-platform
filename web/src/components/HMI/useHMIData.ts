'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface HMIData {
  latestValues: Record<string, number | string | null>;
  units: Record<string, string>;
  sparklineData: Record<string, number[]>;
  activeAlarmCount: number;
  lastUpdated: string | null;
  loading: boolean;
  error: string | null;
  wsConnected: boolean;
}

const POLL_INTERVAL = 15000;
const WS_RECONNECT_DELAY = 5000;
const WS_MAX_ATTEMPTS = 10;

const SYSTEM_FIELDS = new Set([
  'timestamp', 'device_id', 'tenant_id', 'id', 'ts',
  'metric_key', 'metric_value', 'metric_value_str', 'metric_value_json',
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
    if (!isNaN(num) && trimmed !== '') return num;
    return trimmed;
  }
  return String(val);
}

export default function useHMIData(deviceId: string, tenantId: string, enabled = true): HMIData {
  const [latestValues, setLatestValues] = useState<Record<string, number | string | null>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [sparklineData, setSparklineData] = useState<Record<string, number[]>>({});
  const [activeAlarmCount, setActiveAlarmCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const sparklineLoadedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsAttemptsRef = useRef(0);
  const wsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getToken = useCallback(() => {
    return localStorage.getItem('auth_token');
  }, []);

  const fetchLatest = useCallback(async () => {
    const token = getToken();
    if (!token || !tenantId || !deviceId) return;

    try {
      // Use 43200 min (30d) lookback to find data even if device hasn't reported recently
      const res = await fetch(
        `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry/latest?minutes=43200`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.status === 404) {
        // No data found — not an error, just no telemetry yet
        setLatestValues({});
        setUnits({});
        setLastUpdated(null);
        setError(null);
        return;
      }

      if (!res.ok) {
        setError('Failed to fetch telemetry');
        return;
      }

      const json = await res.json();
      const data = json.data || json;

      const values: Record<string, number | string | null> = {};
      const extractedUnits: Record<string, string> = {};
      let timestamp: string | null = null;

      if (Array.isArray(data)) {
        if (data.length > 0 && data[0].metric_key) {
          for (const row of data) {
            const key = row.metric_key;
            if (key && !SYSTEM_FIELDS.has(key) && !isUnitField(key)) {
              values[key] = parseValue(row.metric_value ?? row.metric_value_str);
              if (row.unit) extractedUnits[key] = row.unit;
            }
          }
          if (data[0].ts) timestamp = data[0].ts;
        } else if (data.length > 0) {
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

  const fetchSparklines = useCallback(async () => {
    const token = getToken();
    if (!token || !tenantId || !deviceId) return;

    try {
      // Fetch last 6 hours for sparklines
      const startTime = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const res = await fetch(
        `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry?start_time=${startTime}&per_page=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) return;

      const json = await res.json();
      const data = json.data || json;

      if (!Array.isArray(data) || data.length === 0) return;

      const sparks: Record<string, number[]> = {};

      // API returns DESC order, iterate in reverse for chronological sparklines
      for (let i = data.length - 1; i >= 0; i--) {
        const point = data[i];
        for (const [key, val] of Object.entries(point)) {
          if (SYSTEM_FIELDS.has(key) || isUnitField(key)) continue;
          const parsed = parseValue(val);
          if (typeof parsed === 'number') {
            if (!sparks[key]) sparks[key] = [];
            sparks[key].push(parsed);
          }
        }
      }

      setSparklineData(sparks);
    } catch {
      // Sparkline failure is non-critical
    }
  }, [deviceId, tenantId, getToken]);

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
      setActiveAlarmCount(json.total || json.data?.length || 0);
    } catch {
      // Alarm fetch failure is non-critical
    }
  }, [deviceId, tenantId, getToken]);

  // Apply a real-time WebSocket telemetry push to latestValues
  const applyWsTelemetry = useCallback((wsPayload: Record<string, unknown>, timestamp: string) => {
    setLatestValues(prev => {
      const next = { ...prev };
      for (const [key, val] of Object.entries(wsPayload)) {
        if (SYSTEM_FIELDS.has(key)) continue;
        next[key] = parseValue(val);
      }
      return next;
    });
    setLastUpdated(timestamp);
  }, []);

  // WebSocket connection management
  const connectWs = useCallback(() => {
    const token = getToken();
    if (!token || !tenantId || !deviceId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/v1/ws/devices/${deviceId}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);

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
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        // Exponential back-off reconnect
        if (wsAttemptsRef.current < WS_MAX_ATTEMPTS) {
          wsAttemptsRef.current += 1;
          const delay = WS_RECONNECT_DELAY * Math.min(wsAttemptsRef.current, 4);
          wsTimerRef.current = setTimeout(connectWs, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      // WebSocket not available or blocked — polling fallback handles data
    }
  }, [deviceId, tenantId, getToken, applyWsTelemetry]);

  // Initial load
  useEffect(() => {
    if (!enabled || !deviceId || !tenantId) return;

    const load = async () => {
      setLoading(true);
      await Promise.all([fetchLatest(), fetchAlarms()]);

      if (!sparklineLoadedRef.current) {
        await fetchSparklines();
        sparklineLoadedRef.current = true;
      }

      setLoading(false);
    };

    load();
  }, [enabled, deviceId, tenantId, fetchLatest, fetchAlarms, fetchSparklines]);

  // WebSocket connection (real-time push)
  useEffect(() => {
    if (!enabled || !deviceId || !tenantId) return;
    connectWs();
    return () => {
      if (wsTimerRef.current) clearTimeout(wsTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, deviceId, tenantId, connectWs]);

  // Polling fallback — only polls when WebSocket is disconnected
  useEffect(() => {
    if (!enabled || !deviceId || !tenantId) return;

    const interval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        fetchLatest();
      }
      fetchAlarms();
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [enabled, deviceId, tenantId, fetchLatest, fetchAlarms]);

  return { latestValues, units, sparklineData, activeAlarmCount, lastUpdated, loading, error, wsConnected };
}