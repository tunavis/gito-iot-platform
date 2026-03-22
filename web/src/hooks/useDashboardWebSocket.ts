import { useEffect, useRef, useCallback, useState } from "react";

export interface DashboardTelemetryUpdate {
  type: "telemetry";
  device_id: string;
  data: Record<string, any>;
}

export interface DashboardAlertUpdate {
  type: "alerts";
  device_id: string;
  data: Record<string, any>;
}

export type DashboardWebSocketMessage =
  | DashboardTelemetryUpdate
  | DashboardAlertUpdate;

interface UseDashboardWebSocketOptions {
  tenantId: string;
  token: string;
  enabled?: boolean;
  onMessage?: (msg: DashboardWebSocketMessage) => void;
}

export function useDashboardWebSocket({
  tenantId,
  token,
  enabled = true,
  onMessage,
}: UseDashboardWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxReconnectAttempts = 10;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!tenantId || !token || !enabled) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/v1/ws/tenants/${tenantId}/telemetry?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        onMessageRef.current?.(JSON.parse(event.data));
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      if (enabled && reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttempts.current),
          30000
        );
        reconnectAttempts.current++;
        reconnectTimer.current = setTimeout(() => connectRef.current(), delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [tenantId, token, enabled]);

  connectRef.current = connect;

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  // Keepalive ping every 30 s
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      wsRef.current?.send(JSON.stringify({ type: "ping" }));
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected]);

  return { isConnected };
}
