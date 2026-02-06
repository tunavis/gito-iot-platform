'use client';

import { ProtocolType } from './ProtocolSelector';

interface ProtocolConfig {
  protocol: ProtocolType;
  mqtt?: {
    topic_pattern?: string;
    qos?: number;
    retain?: boolean;
  };
  http?: {
    method?: string;
    auth_type?: string;
  };
  lorawan?: {
    lorawan_class?: string;
    activation?: string;
  };
  modbus?: {
    connection_type?: string;
    port?: number;
  };
  opcua?: {
    security_mode?: string;
  };
  coap?: {
    observe?: boolean;
  };
  websocket?: {
    protocols?: string[];
  };
  custom?: {
    parser?: string;
  };
}

interface ProtocolConfigFormProps {
  protocol: ProtocolType;
  config: ProtocolConfig;
  onChange: (config: ProtocolConfig) => void;
}

export default function ProtocolConfigForm({ protocol, config, onChange }: ProtocolConfigFormProps) {
  const updateConfig = (protocolKey: string, updates: any) => {
    const currentConfig = config[protocolKey as keyof ProtocolConfig];
    const baseConfig = typeof currentConfig === 'object' && currentConfig !== null ? currentConfig : {};
    onChange({
      ...config,
      [protocolKey]: {
        ...baseConfig,
        ...updates
      }
    });
  };

  return (
    <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <h4 className="font-semibold text-gray-900 flex items-center gap-2">
        <span className="text-primary-600">⚙️</span>
        {protocol.toUpperCase()} Configuration
      </h4>

      {protocol === 'mqtt' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Topic Pattern
            </label>
            <input
              type="text"
              value={config.mqtt?.topic_pattern || '{{tenant_id}}/devices/{{device_id}}/telemetry'}
              onChange={(e) => updateConfig('mqtt', { topic_pattern: e.target.value })}
              placeholder="{{tenant_id}}/devices/{{device_id}}/telemetry"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use placeholders: {'{{tenant_id}}'}, {'{{device_id}}'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                QoS Level
              </label>
              <select
                value={config.mqtt?.qos || 1}
                onChange={(e) => updateConfig('mqtt', { qos: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value={0}>0 - At most once</option>
                <option value={1}>1 - At least once</option>
                <option value={2}>2 - Exactly once</option>
              </select>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.mqtt?.retain || false}
                  onChange={(e) => updateConfig('mqtt', { retain: e.target.checked })}
                  className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">Retain Messages</span>
              </label>
              <p className="text-xs text-gray-500 mt-1">Keep last message on broker</p>
            </div>
          </div>
        </div>
      )}

      {protocol === 'http' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              HTTP Method
            </label>
            <select
              value={config.http?.method || 'POST'}
              onChange={(e) => updateConfig('http', { method: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Authentication Type
            </label>
            <select
              value={config.http?.auth_type || 'bearer'}
              onChange={(e) => updateConfig('http', { auth_type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="bearer">Bearer Token</option>
              <option value="apikey">API Key</option>
              <option value="basic">Basic Auth</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
      )}

      {protocol === 'lorawan' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              LoRaWAN Class
            </label>
            <select
              value={config.lorawan?.lorawan_class || 'A'}
              onChange={(e) => updateConfig('lorawan', { lorawan_class: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="A">Class A - Lowest power</option>
              <option value="B">Class B - Scheduled receive</option>
              <option value="C">Class C - Always listening</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Activation Method
            </label>
            <select
              value={config.lorawan?.activation || 'OTAA'}
              onChange={(e) => updateConfig('lorawan', { activation: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="OTAA">OTAA (Over-the-Air Activation)</option>
              <option value="ABP">ABP (Activation By Personalization)</option>
            </select>
          </div>
        </div>
      )}

      {protocol === 'modbus' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Connection Type
            </label>
            <select
              value={config.modbus?.connection_type || 'tcp'}
              onChange={(e) => updateConfig('modbus', { connection_type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="tcp">Modbus TCP (Ethernet)</option>
              <option value="rtu">Modbus RTU (Serial)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Port
            </label>
            <input
              type="number"
              value={config.modbus?.port || 502}
              onChange={(e) => updateConfig('modbus', { port: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Modbus integration requires additional gateway/bridge setup for cloud connectivity.
            </p>
          </div>
        </div>
      )}

      {['opcua', 'coap', 'websocket', 'custom'].includes(protocol) && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🚧</span>
            <div>
              <h5 className="font-semibold text-yellow-900 mb-1">
                {protocol.toUpperCase()} - Coming Soon
              </h5>
              <p className="text-sm text-yellow-800">
                This protocol is supported in the platform architecture but requires additional configuration.
                Contact support for enterprise integration assistance.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { ProtocolConfig };
