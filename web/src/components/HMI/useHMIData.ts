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
}

const POLL_INTERVAL = 15000;
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
  const sparklineLoadedRef = useRef(false);

  const getToken = useCallback(() => {
    return localStorage.getItem('auth_token');
  }, []);

  const fetchLatest = useCallback(async () => {
    const token = getToken();
    if (!token || !tenantId || !deviceId) return;

    try {
      // Use 1440 min (24h) lookback to find data even if device hasn't reported recently
      const res = await fetch(
        `/api/v1/tenants/${tenantId}/devices/${deviceId}/telemetry/latest?minutes=1440`,
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

  // Polling
  useEffect(() => {
    if (!enabled || !deviceId || !tenantId) return;

    const interval = setInterval(() => {
      fetchLatest();
      fetchAlarms();
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [enabled, deviceId, tenantId, fetchLatest, fetchAlarms]);

  return { latestValues, units, sparklineData, activeAlarmCount, lastUpdated, loading, error };
}
