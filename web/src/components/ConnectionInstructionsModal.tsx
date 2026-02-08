'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  Copy,
  CheckCircle2,
  Wifi,
  Terminal,
  Code,
  ExternalLink,
  Download,
  ChevronRight
} from 'lucide-react';

interface Device {
  id: string;
  name: string;
  device_type?: {
    name: string;
    connectivity?: {
      protocol: string;
    };
  };
}

interface ConnectionInstructionsModalProps {
  device: Device;
  onClose: () => void;
}

export default function ConnectionInstructionsModal({ device, onClose }: ConnectionInstructionsModalProps) {
  const router = useRouter();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'mqtt' | 'python' | 'arduino'>('mqtt');

  const protocol = device.device_type?.connectivity?.protocol || 'mqtt';

  // MQTT Configuration (from environment or defaults)
  const mqttConfig = {
    host: typeof window !== 'undefined' && window.location.hostname !== 'localhost'
      ? window.location.hostname
      : 'localhost',
    port: 1883,
    tlsPort: 8883,
    topic: `devices/${device.id}/telemetry`,
    username: 'anonymous', // TODO: Will be device-specific in Phase 2
    password: 'Not required (dev mode)', // TODO: Will be device-specific in Phase 2
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const pythonExample = `import paho.mqtt.client as mqtt
import json
import time
import random

# MQTT Configuration
BROKER = "${mqttConfig.host}"
PORT = ${mqttConfig.port}
DEVICE_ID = "${device.id}"
TOPIC = "${mqttConfig.topic}"

# Connect to broker
client = mqtt.Client(client_id=DEVICE_ID)
# client.username_pw_set("username", "password")  # Enable in production
client.connect(BROKER, PORT, 60)

print(f"✓ Connected to MQTT broker at {BROKER}:{PORT}")

# Publish telemetry every 30 seconds
while True:
    payload = {
        "temperature": round(20 + random.uniform(-5, 5), 2),
        "humidity": round(60 + random.uniform(-10, 10), 2),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }

    client.publish(TOPIC, json.dumps(payload))
    print(f"✓ Published: {payload}")
    time.sleep(30)
`;

  const arduinoExample = `#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// WiFi credentials
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// MQTT Configuration
const char* mqtt_server = "${mqttConfig.host}";
const int mqtt_port = ${mqttConfig.port};
const char* device_id = "${device.id}";
const char* topic = "${mqttConfig.topic}";

WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
  Serial.begin(115200);

  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\n✓ WiFi connected");

  // Configure MQTT
  client.setServer(mqtt_server, mqtt_port);
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting to MQTT...");
    if (client.connect(device_id)) {
      Serial.println("✓ Connected");
    } else {
      Serial.print("✗ Failed, rc=");
      Serial.print(client.state());
      Serial.println(" Retrying in 5s");
      delay(5000);
    }
  }
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // Create JSON payload
  StaticJsonDocument<200> doc;
  doc["temperature"] = random(15, 30);
  doc["humidity"] = random(40, 80);

  char buffer[200];
  serializeJson(doc, buffer);

  // Publish telemetry
  if (client.publish(topic, buffer)) {
    Serial.println("✓ Published: " + String(buffer));
  }

  delay(30000); // 30 seconds
}
`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Device Created Successfully!</h2>
              <p className="text-primary-100 text-sm mt-0.5">Follow the instructions below to connect your device</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Device Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Device Name</label>
                <p className="text-sm font-semibold text-gray-900 mt-1">{device.name}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Device Type</label>
                <p className="text-sm font-semibold text-gray-900 mt-1">{device.device_type?.name || 'Unknown'}</p>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 uppercase mb-2 block">Device ID</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-white border border-gray-300 rounded px-3 py-2 text-gray-900">
                    {device.id}
                  </code>
                  <button
                    onClick={() => copyToClipboard(device.id, 'device_id')}
                    className="px-3 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    {copiedField === 'device_id' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-600" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Connection Details */}
          {protocol === 'mqtt' && (
            <>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Wifi className="w-5 h-5 text-primary-600" />
                  MQTT Connection Details
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase block mb-1">Broker Host</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-900">
                          {mqttConfig.host}
                        </code>
                        <button
                          onClick={() => copyToClipboard(mqttConfig.host, 'host')}
                          className="p-2 hover:bg-gray-100 rounded transition-colors"
                        >
                          {copiedField === 'host' ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-gray-600" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase block mb-1">Port</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-900">
                          {mqttConfig.port} (Plain) / {mqttConfig.tlsPort} (TLS)
                        </code>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 uppercase block mb-1">Telemetry Topic</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-900">
                        {mqttConfig.topic}
                      </code>
                      <button
                        onClick={() => copyToClipboard(mqttConfig.topic, 'topic')}
                        className="p-2 hover:bg-gray-100 rounded transition-colors"
                      >
                        {copiedField === 'topic' ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 text-gray-600" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm text-yellow-800">
                      <strong>⚠️ Development Mode:</strong> Anonymous access is enabled. In production, each device will have unique credentials.
                    </p>
                  </div>
                </div>
              </div>

              {/* Code Examples */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Code className="w-5 h-5 text-primary-600" />
                  Code Examples
                </h3>

                {/* Tabs */}
                <div className="flex gap-2 border-b border-gray-200 mb-4">
                  <button
                    onClick={() => setActiveTab('mqtt')}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      activeTab === 'mqtt'
                        ? 'text-primary-600 border-primary-600'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    MQTT Client
                  </button>
                  <button
                    onClick={() => setActiveTab('python')}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      activeTab === 'python'
                        ? 'text-primary-600 border-primary-600'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    Python
                  </button>
                  <button
                    onClick={() => setActiveTab('arduino')}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      activeTab === 'arduino'
                        ? 'text-primary-600 border-primary-600'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    Arduino/ESP32
                  </button>
                </div>

                {/* Tab Content */}
                <div className="relative">
                  {activeTab === 'mqtt' && (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600">Test your device connection using any MQTT client:</p>
                      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-xs">
{`# Using mosquitto_pub (command line)
mosquitto_pub -h ${mqttConfig.host} -p ${mqttConfig.port} \\
  -t ${mqttConfig.topic} \\
  -m '{"temperature": 25.5, "humidity": 65.0}'

# Using MQTT.fx or MQTT Explorer (GUI)
1. Connect to: ${mqttConfig.host}:${mqttConfig.port}
2. Publish to topic: ${mqttConfig.topic}
3. Payload: {"temperature": 25.5, "humidity": 65.0}`}
                      </pre>
                    </div>
                  )}

                  {activeTab === 'python' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-600">Python script with paho-mqtt library:</p>
                        <button
                          onClick={() => copyToClipboard(pythonExample, 'python')}
                          className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm transition-colors"
                        >
                          {copiedField === 'python' ? (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                              <span className="text-green-600">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-xs">
                        {pythonExample}
                      </pre>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-sm text-blue-800">
                          <strong>📦 Install:</strong> <code className="bg-blue-100 px-2 py-0.5 rounded">pip install paho-mqtt</code>
                        </p>
                      </div>
                    </div>
                  )}

                  {activeTab === 'arduino' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-600">ESP32/ESP8266 Arduino sketch:</p>
                        <button
                          onClick={() => copyToClipboard(arduinoExample, 'arduino')}
                          className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm transition-colors"
                        >
                          {copiedField === 'arduino' ? (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                              <span className="text-green-600">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-xs">
                        {arduinoExample}
                      </pre>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-sm text-blue-800">
                          <strong>📦 Libraries:</strong> WiFi, PubSubClient, ArduinoJson (install via Library Manager)
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Next Steps */}
              <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-primary-900 mb-2">✅ Next Steps</h4>
                <ol className="space-y-2 text-sm text-primary-800">
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>Copy the code example above and configure your device</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>Connect your device to power and network</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>Device status will change to "online" within 30 seconds</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ChevronRight className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>View live telemetry data in the device dashboard</span>
                  </li>
                </ol>
              </div>
            </>
          )}

          {protocol === 'lorawan' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-blue-900 mb-2">LoRaWAN Device Setup</h3>
              <p className="text-sm text-blue-800 mb-3">
                Configure your LoRaWAN device in The Things Network (TTN) with the credentials you provided during device creation.
              </p>
              <ol className="space-y-2 text-sm text-blue-800">
                <li>1. Register device in TTN console with DevEUI and AppKey</li>
                <li>2. Configure webhook integration to point to this platform</li>
                <li>3. Device will auto-connect when it joins the network</li>
              </ol>
            </div>
          )}

          {(protocol === 'http' || protocol === 'modbus' || protocol === 'opcua' || protocol === 'coap') && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-purple-900 mb-2">{protocol.toUpperCase()} Device</h3>
              <p className="text-sm text-purple-800">
                Connection instructions for {protocol.toUpperCase()} devices will be available in the device settings page.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => router.push(`/dashboard/devices/${device.id}`)}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-medium"
          >
            View Device Dashboard
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
