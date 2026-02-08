import { useEffect, useRef, useCallback, useState } from 'react';

export interface TelemetryUpdate {
  type: 'telemetry';
  data: {
    device_id: string;
    payload: Record<string, any>;
    timestamp: string;
  };
}

export interface AlertUpdate {
  type: 'alert';
  data: {
    alert_rule_id: string;
    device_id: string;
    metric: string;
    value: number;
    message: string;
    timestamp: string;
  };
}

export type WebSocketMessage = TelemetryUpdate | AlertUpdate;

interface UseDeviceWebSocketOptions {
  deviceId: string;
  token: string;
  onTelemetry?: (data: TelemetryUpdate['data']) => void;
  onAlert?: (data: AlertUpdate['data']) => void;
  onError?: (error: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * Hook for managing WebSocket connection to device telemetry stream
 * Handles automatic reconnection, message parsing, and callback dispatching
 */
export function useDeviceWebSocket({
  deviceId,
  token,
  onTelemetry,
  onAlert,
  onError,
  onConnectionChange,
  autoReconnect = true,
  reconnectInterval = 5000,
  maxReconnectAttempts = 10,
}: UseDeviceWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (isConnecting) {
      return;
    }

    setIsConnecting(true);

    try {
      // Determine WebSocket URL based on current location
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/v1/ws/devices/${deviceId}?token=${encodeURIComponent(
        token
      )}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        onConnectionChange?.(true);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'telemetry') {
            onTelemetry?.(message.data);
          } else if (message.type === 'alert') {
            onAlert?.(message.data);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
          onError?.('Failed to parse telemetry data');
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setIsConnected(false);
        setIsConnecting(false);
        onError?.('WebSocket connection error');
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        setIsConnected(false);
        setIsConnecting(false);
        onConnectionChange?.(false);

        // Attempt to reconnect
        if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = reconnectInterval * Math.pow(2, reconnectAttemptsRef.current - 1);
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          onError?.('Failed to reconnect after maximum attempts');
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setIsConnected(false);
      setIsConnecting(false);
      onError?.('Failed to create WebSocket connection');
    }
  }, [deviceId, token, onTelemetry, onAlert, onError, onConnectionChange, autoReconnect, reconnectInterval, maxReconnectAttempts, isConnecting]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const sendMessage = useCallback(
    (message: Record<string, any>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      } else {
        console.warn('WebSocket is not connected');
      }
    },
    []
  );

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    isConnecting,
    sendMessage,
    disconnect,
    reconnect: connect,
  };
}
