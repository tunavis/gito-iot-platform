'use client';

import { useState } from 'react';

export type ProtocolType = 'mqtt' | 'lorawan' | 'http' | 'modbus' | 'opcua' | 'coap' | 'websocket' | 'custom';

interface ProtocolOption {
  value: ProtocolType;
  label: string;
  description: string;
  icon: string;
  available: boolean;
}

const PROTOCOL_OPTIONS: ProtocolOption[] = [
  {
    value: 'mqtt',
    label: 'MQTT',
    description: 'Standard IoT messaging protocol with pub/sub model',
    icon: '📡',
    available: true
  },
  {
    value: 'http',
    label: 'HTTP/Webhook',
    description: 'REST API with webhook-based data push',
    icon: '🌐',
    available: true
  },
  {
    value: 'lorawan',
    label: 'LoRaWAN',
    description: 'Long-range, low-power wireless for IoT',
    icon: '📶',
    available: true
  },
  {
    value: 'modbus',
    label: 'Modbus TCP/RTU',
    description: 'Industrial protocol for PLCs and SCADA',
    icon: '🏭',
    available: true
  },
  {
    value: 'opcua',
    label: 'OPC UA',
    description: 'Industrial automation standard',
    icon: '⚙️',
    available: true
  },
  {
    value: 'coap',
    label: 'CoAP',
    description: 'Lightweight protocol for constrained devices',
    icon: '💡',
    available: true
  },
  {
    value: 'websocket',
    label: 'WebSocket',
    description: 'Real-time bidirectional communication',
    icon: '🔌',
    available: true
  },
  {
    value: 'custom',
    label: 'Custom Protocol',
    description: 'User-defined protocol with custom parser',
    icon: '🔧',
    available: true
  }
];

interface ProtocolSelectorProps {
  value: ProtocolType;
  onChange: (protocol: ProtocolType) => void;
  disabled?: boolean;
}

export default function ProtocolSelector({ value, onChange, disabled = false }: ProtocolSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = PROTOCOL_OPTIONS.find(opt => opt.value === value) || PROTOCOL_OPTIONS[0];

  return (
    <div className="relative">
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        Protocol Type
      </label>

      {/* Selected Protocol Display */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-300 rounded-lg shadow-sm hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{selectedOption.icon}</span>
          <div className="text-left">
            <div className="font-semibold text-gray-900">{selectedOption.label}</div>
            <div className="text-sm text-gray-500">{selectedOption.description}</div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Protocol Options Dropdown */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-20 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
            {PROTOCOL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                disabled={!option.available}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                  value === option.value ? 'bg-primary-50' : ''
                }`}
              >
                <span className="text-2xl">{option.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{option.label}</span>
                    {value === option.value && (
                      <svg className="w-5 h-5 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">{option.description}</div>
                </div>
                {!option.available && (
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                    Coming Soon
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export { PROTOCOL_OPTIONS };
export type { ProtocolOption };
