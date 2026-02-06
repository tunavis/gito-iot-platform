"""MQTT Protocol Adapter."""

from typing import Dict, Any, Optional
import re
from app.protocols.base import BaseProtocolAdapter, DeviceCredentials, ProtocolRegistry
from app.config import get_settings
import logging

logger = logging.getLogger(__name__)


class MQTTAdapter(BaseProtocolAdapter):
    """MQTT protocol adapter.

    Supports standard MQTT broker connectivity with QoS and retain settings.
    Uses pattern-based topic routing with tenant and device ID substitution.
    """

    async def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validate MQTT configuration."""
        mqtt_config = config.get('mqtt', {})

        # Validate topic pattern
        topic_pattern = mqtt_config.get('topic_pattern')
        if not topic_pattern:
            return False, "MQTT topic_pattern is required"

        # Check for required placeholders
        if '{{device_id}}' not in topic_pattern:
            return False, "topic_pattern must include {{device_id}} placeholder"

        # Validate QoS
        qos = mqtt_config.get('qos', 1)
        if qos not in [0, 1, 2]:
            return False, "QoS must be 0, 1, or 2"

        return True, None

    async def generate_credentials(self, device_id: str, tenant_id: str) -> DeviceCredentials:
        """Generate MQTT credentials."""
        settings = get_settings()

        # In production, you might generate device-specific credentials
        # For now, use shared broker credentials
        protocol_config = {
            'broker_host': settings.MQTT_BROKER_HOST,
            'broker_port': settings.MQTT_BROKER_PORT,
            'username': settings.MQTT_USERNAME,
            'password': settings.MQTT_PASSWORD,
            'topic': self._generate_topic(device_id, tenant_id),
            'qos': self.config.get('mqtt', {}).get('qos', 1),
            'retain': self.config.get('mqtt', {}).get('retain', False)
        }

        return DeviceCredentials(
            device_id=device_id,
            tenant_id=tenant_id,
            protocol_config=protocol_config
        )

    async def provision_device(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Provision MQTT device.

        For MQTT, provisioning is usually just generating the topic and credentials.
        If using MQTT ACLs, you would configure them here.
        """
        return {
            'status': 'provisioned',
            'protocol': 'mqtt',
            'topic': credentials.protocol_config['topic'],
            'broker': f"{credentials.protocol_config['broker_host']}:{credentials.protocol_config['broker_port']}"
        }

    async def deprovision_device(self, device_id: str) -> bool:
        """Deprovision MQTT device.

        For MQTT, this might involve removing ACL entries or closing sessions.
        """
        logger.info(f"Deprovisioning MQTT device: {device_id}")
        # TODO: If using MQTT ACLs, remove them here
        return True

    def get_connection_instructions(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Get MQTT connection instructions."""
        cfg = credentials.protocol_config

        return {
            'protocol': 'MQTT',
            'broker_url': f"mqtt://{cfg['broker_host']}:{cfg['broker_port']}",
            'topic': cfg['topic'],
            'qos': cfg['qos'],
            'retain': cfg['retain'],
            'authentication': {
                'username': cfg['username'],
                'password': cfg['password']
            },
            'example_payload': {
                'temperature': 25.5,
                'humidity': 65.2,
                'timestamp': '2026-02-06T10:00:00Z'
            },
            'client_libraries': {
                'python': 'pip install paho-mqtt',
                'javascript': 'npm install mqtt',
                'arduino': 'PubSubClient library',
                'esp32': 'Arduino MQTT or esp-mqtt'
            },
            'example_code': {
                'python': self._generate_python_example(cfg),
                'javascript': self._generate_js_example(cfg)
            }
        }

    async def test_connection(self, credentials: DeviceCredentials) -> tuple[bool, Optional[str]]:
        """Test MQTT connection."""
        # TODO: Implement actual MQTT connection test
        # For now, just validate configuration
        cfg = credentials.protocol_config
        if not all(k in cfg for k in ['broker_host', 'broker_port', 'topic']):
            return False, "Missing required MQTT configuration"
        return True, None

    def _generate_topic(self, device_id: str, tenant_id: str) -> str:
        """Generate MQTT topic from pattern."""
        topic_pattern = self.config.get('mqtt', {}).get('topic_pattern', '{{tenant_id}}/devices/{{device_id}}/telemetry')
        topic = topic_pattern.replace('{{tenant_id}}', tenant_id)
        topic = topic.replace('{{device_id}}', device_id)
        return topic

    def _generate_python_example(self, cfg: Dict) -> str:
        """Generate Python MQTT example code."""
        return f"""
import paho.mqtt.client as mqtt
import json
import time

# MQTT Configuration
broker = "{cfg['broker_host']}"
port = {cfg['broker_port']}
topic = "{cfg['topic']}"
username = "{cfg['username']}"
password = "{cfg['password']}"

# Connect to broker
client = mqtt.Client()
client.username_pw_set(username, password)
client.connect(broker, port, 60)

# Publish telemetry
data = {{
    "temperature": 25.5,
    "humidity": 65.2,
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")
}}

client.publish(topic, json.dumps(data), qos={cfg['qos']})
client.disconnect()
        """.strip()

    def _generate_js_example(self, cfg: Dict) -> str:
        """Generate JavaScript/Node.js MQTT example code."""
        return f"""
const mqtt = require('mqtt');

// MQTT Configuration
const client = mqtt.connect('mqtt://{cfg['broker_host']}:{cfg['broker_port']}', {{
    username: '{cfg['username']}',
    password: '{cfg['password']}'
}});

client.on('connect', () => {{
    const data = {{
        temperature: 25.5,
        humidity: 65.2,
        timestamp: new Date().toISOString()
    }};

    client.publish('{cfg['topic']}', JSON.stringify(data), {{qos: {cfg['qos']}}});
    client.end();
}});
        """.strip()


# Register MQTT adapter
ProtocolRegistry.register('mqtt', MQTTAdapter)
