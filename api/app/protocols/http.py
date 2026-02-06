"""HTTP/Webhook Protocol Adapter."""

from typing import Dict, Any, Optional
from app.protocols.base import BaseProtocolAdapter, DeviceCredentials, ProtocolRegistry
import logging
import secrets

logger = logging.getLogger(__name__)


class HTTPAdapter(BaseProtocolAdapter):
    """HTTP/Webhook protocol adapter.

    Supports devices that push data via HTTP POST/PUT requests.
    Generates unique webhook URLs with authentication tokens.
    """

    async def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validate HTTP configuration."""
        http_config = config.get('http', {})

        # Validate HTTP method
        method = http_config.get('method', 'POST')
        if method not in ['POST', 'PUT', 'PATCH']:
            return False, "HTTP method must be POST, PUT, or PATCH"

        # Validate auth type
        auth_type = http_config.get('auth_type', 'bearer')
        if auth_type not in ['bearer', 'apikey', 'basic', 'none']:
            return False, "auth_type must be bearer, apikey, basic, or none"

        return True, None

    async def generate_credentials(self, device_id: str, tenant_id: str) -> DeviceCredentials:
        """Generate HTTP webhook credentials."""
        # Generate secure authentication token
        auth_token = secrets.token_urlsafe(32)

        # Generate webhook URL
        # In production, this would be your actual API domain
        webhook_url = f"/api/v1/telemetry/webhook/{tenant_id}/{device_id}"

        protocol_config = {
            'webhook_url': webhook_url,
            'full_url': f"https://your-domain.com{webhook_url}",  # Replace with actual domain
            'method': self.config.get('http', {}).get('method', 'POST'),
            'auth_type': self.config.get('http', {}).get('auth_type', 'bearer'),
            'auth_token': auth_token,
            'headers': {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {auth_token}'
            }
        }

        return DeviceCredentials(
            device_id=device_id,
            tenant_id=tenant_id,
            protocol_config=protocol_config
        )

    async def provision_device(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Provision HTTP webhook device."""
        return {
            'status': 'provisioned',
            'protocol': 'http',
            'webhook_url': credentials.protocol_config['full_url'],
            'auth_token': credentials.protocol_config['auth_token']
        }

    async def deprovision_device(self, device_id: str) -> bool:
        """Deprovision HTTP device."""
        logger.info(f"Deprovisioning HTTP device: {device_id}")
        # Revoke auth token in database
        return True

    def get_connection_instructions(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Get HTTP connection instructions."""
        cfg = credentials.protocol_config

        return {
            'protocol': 'HTTP/Webhook',
            'webhook_url': cfg['full_url'],
            'method': cfg['method'],
            'authentication': {
                'type': cfg['auth_type'],
                'header': 'Authorization',
                'value': f"Bearer {cfg['auth_token']}"
            },
            'headers': cfg['headers'],
            'example_payload': {
                'temperature': 25.5,
                'humidity': 65.2,
                'timestamp': '2026-02-06T10:00:00Z'
            },
            'example_code': {
                'curl': self._generate_curl_example(cfg),
                'python': self._generate_python_example(cfg),
                'javascript': self._generate_js_example(cfg)
            }
        }

    async def test_connection(self, credentials: DeviceCredentials) -> tuple[bool, Optional[str]]:
        """Test HTTP connection."""
        cfg = credentials.protocol_config
        if not cfg.get('webhook_url') or not cfg.get('auth_token'):
            return False, "Missing webhook URL or auth token"
        return True, None

    def _generate_curl_example(self, cfg: Dict) -> str:
        """Generate curl example."""
        return f"""
curl -X {cfg['method']} '{cfg['full_url']}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer {cfg['auth_token']}' \\
  -d '{{
    "temperature": 25.5,
    "humidity": 65.2,
    "timestamp": "2026-02-06T10:00:00Z"
  }}'
        """.strip()

    def _generate_python_example(self, cfg: Dict) -> str:
        """Generate Python requests example."""
        return f"""
import requests
import json
from datetime import datetime

url = "{cfg['full_url']}"
headers = {{
    'Content-Type': 'application/json',
    'Authorization': 'Bearer {cfg['auth_token']}'
}}

data = {{
    "temperature": 25.5,
    "humidity": 65.2,
    "timestamp": datetime.utcnow().isoformat() + 'Z'
}}

response = requests.{cfg['method'].lower()}(url, headers=headers, json=data)
print(f"Status: {{response.status_code}}")
        """.strip()

    def _generate_js_example(self, cfg: Dict) -> str:
        """Generate JavaScript fetch example."""
        return f"""
const url = '{cfg['full_url']}';
const data = {{
    temperature: 25.5,
    humidity: 65.2,
    timestamp: new Date().toISOString()
}};

fetch(url, {{
    method: '{cfg['method']}',
    headers: {{
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {cfg['auth_token']}'
    }},
    body: JSON.stringify(data)
}})
.then(response => response.json())
.then(data => console.log('Success:', data))
.catch(error => console.error('Error:', error));
        """.strip()


# Register HTTP adapter
ProtocolRegistry.register('http', HTTPAdapter)
