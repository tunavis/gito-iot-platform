"""LoRaWAN Protocol Adapter (ChirpStack integration)."""

from typing import Dict, Any, Optional
from app.protocols.base import BaseProtocolAdapter, DeviceCredentials, ProtocolRegistry
import logging
import secrets

logger = logging.getLogger(__name__)


class LoRaWANAdapter(BaseProtocolAdapter):
    """LoRaWAN protocol adapter.

    Integrates with ChirpStack Network Server for LoRaWAN device management.
    Supports Class A, B, and C devices with OTAA/ABP activation.
    """

    async def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validate LoRaWAN configuration."""
        lorawan_config = config.get('lorawan', {})

        # Validate LoRaWAN class
        lorawan_class = lorawan_config.get('lorawan_class', 'A')
        if lorawan_class not in ['A', 'B', 'C']:
            return False, "LoRaWAN class must be A, B, or C"

        # Validate activation mode
        activation = lorawan_config.get('activation', 'OTAA')
        if activation not in ['OTAA', 'ABP']:
            return False, "Activation must be OTAA or ABP"

        return True, None

    async def generate_credentials(self, device_id: str, tenant_id: str) -> DeviceCredentials:
        """Generate LoRaWAN credentials."""
        # Generate DevEUI (8 bytes hex)
        dev_eui = secrets.token_hex(8)

        # Generate AppKey (16 bytes hex for OTAA)
        app_key = secrets.token_hex(16)

        lorawan_config = self.config.get('lorawan', {})

        protocol_config = {
            'dev_eui': dev_eui,
            'app_key': app_key,
            'lorawan_class': lorawan_config.get('lorawan_class', 'A'),
            'activation': lorawan_config.get('activation', 'OTAA'),
            'app_eui': lorawan_config.get('app_eui', '0000000000000000'),  # ChirpStack JoinEUI
            'data_rate': lorawan_config.get('data_rate', 'SF7BW125'),
            'frequency_plan': lorawan_config.get('frequency_plan', 'EU868')
        }

        return DeviceCredentials(
            device_id=device_id,
            tenant_id=tenant_id,
            protocol_config=protocol_config
        )

    async def provision_device(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Provision LoRaWAN device on ChirpStack.

        TODO: Integrate with ChirpStack API to actually provision the device
        """
        logger.info(f"Provisioning LoRaWAN device: {credentials.device_id}")

        # TODO: Call ChirpStack API
        # POST /api/devices
        # {
        #   "device": {
        #     "devEUI": credentials.protocol_config['dev_eui'],
        #     "name": credentials.device_id,
        #     "applicationID": "...",
        #     "deviceProfileID": "...",
        #     "skipFCntCheck": false
        #   }
        # }

        return {
            'status': 'provisioned',
            'protocol': 'lorawan',
            'dev_eui': credentials.protocol_config['dev_eui'],
            'chirpstack_status': 'pending_integration'  # TODO: actual status
        }

    async def deprovision_device(self, device_id: str) -> bool:
        """Deprovision LoRaWAN device from ChirpStack.

        TODO: Integrate with ChirpStack API to delete the device
        """
        logger.info(f"Deprovisioning LoRaWAN device: {device_id}")
        # TODO: DELETE /api/devices/{dev_eui}
        return True

    def get_connection_instructions(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Get LoRaWAN connection instructions."""
        cfg = credentials.protocol_config

        return {
            'protocol': 'LoRaWAN',
            'network_server': 'ChirpStack',
            'credentials': {
                'dev_eui': cfg['dev_eui'],
                'app_eui': cfg['app_eui'],
                'app_key': cfg['app_key']
            },
            'configuration': {
                'class': cfg['lorawan_class'],
                'activation': cfg['activation'],
                'data_rate': cfg['data_rate'],
                'frequency_plan': cfg['frequency_plan']
            },
            'setup_instructions': [
                '1. Flash your LoRaWAN device with the credentials above',
                '2. Ensure your device is configured for ' + cfg['activation'] + ' activation',
                '3. Set LoRaWAN class to ' + cfg['lorawan_class'],
                '4. Power on the device and wait for JOIN request',
                '5. Verify successful join in ChirpStack Console',
                '6. Device will appear online when first uplink received'
            ],
            'example_payload_format': {
                'type': 'Cayenne LPP or custom binary',
                'example_hex': '01670110026873',
                'decoded': {
                    'temperature': 27.2,
                    'humidity': 58.3
                }
            }
        }

    async def test_connection(self, credentials: DeviceCredentials) -> tuple[bool, Optional[str]]:
        """Test LoRaWAN connection."""
        cfg = credentials.protocol_config
        if not cfg.get('dev_eui') or not cfg.get('app_key'):
            return False, "Missing DevEUI or AppKey"

        # TODO: Check ChirpStack API for device status
        return True, "LoRaWAN device ready for join"


# Register LoRaWAN adapter
ProtocolRegistry.register('lorawan', LoRaWANAdapter)
