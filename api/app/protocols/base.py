"""Base protocol adapter interface and registry."""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Type
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class DeviceCredentials:
    """Device credentials for protocol connection."""
    device_id: str
    tenant_id: str
    protocol_config: Dict[str, Any]


@dataclass
class TelemetryMessage:
    """Standardized telemetry message format."""
    device_id: str
    tenant_id: str
    timestamp: str
    data: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None


class BaseProtocolAdapter(ABC):
    """Abstract base class for protocol adapters.

    All protocol adapters must implement these methods to provide
    a consistent interface for device connectivity across protocols.
    """

    def __init__(self, config: Dict[str, Any]):
        """Initialize protocol adapter with configuration.

        Args:
            config: Protocol-specific configuration from device_type.connectivity
        """
        self.config = config
        self.protocol_name = self.__class__.__name__.replace("Adapter", "").lower()

    @abstractmethod
    async def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validate protocol-specific configuration.

        Args:
            config: Protocol configuration to validate

        Returns:
            (is_valid, error_message)
        """
        pass

    @abstractmethod
    async def generate_credentials(self, device_id: str, tenant_id: str) -> DeviceCredentials:
        """Generate credentials for a new device.

        Args:
            device_id: Unique device identifier
            tenant_id: Tenant the device belongs to

        Returns:
            DeviceCredentials object
        """
        pass

    @abstractmethod
    async def provision_device(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Provision device on the protocol server/broker.

        Args:
            credentials: Device credentials

        Returns:
            Provisioning result with connection instructions
        """
        pass

    @abstractmethod
    async def deprovision_device(self, device_id: str) -> bool:
        """Remove device from protocol server/broker.

        Args:
            device_id: Device to deprovision

        Returns:
            Success status
        """
        pass

    @abstractmethod
    def get_connection_instructions(self, credentials: DeviceCredentials) -> Dict[str, Any]:
        """Get human-readable connection instructions for device setup.

        Args:
            credentials: Device credentials

        Returns:
            Connection instructions (URLs, topics, endpoints, etc.)
        """
        pass

    @abstractmethod
    async def test_connection(self, credentials: DeviceCredentials) -> tuple[bool, Optional[str]]:
        """Test if device can connect with given credentials.

        Args:
            credentials: Device credentials to test

        Returns:
            (success, error_message)
        """
        pass

    def parse_telemetry(self, raw_message: bytes, metadata: Dict[str, Any]) -> Optional[TelemetryMessage]:
        """Parse raw telemetry message into standardized format.

        Override this if protocol needs custom parsing.

        Args:
            raw_message: Raw bytes from protocol
            metadata: Protocol-specific metadata

        Returns:
            Parsed TelemetryMessage or None if parsing fails
        """
        # Default: assume JSON payload
        import json
        try:
            data = json.loads(raw_message.decode('utf-8'))
            return TelemetryMessage(
                device_id=metadata.get('device_id'),
                tenant_id=metadata.get('tenant_id'),
                timestamp=metadata.get('timestamp'),
                data=data,
                metadata=metadata
            )
        except Exception as e:
            logger.error(f"Failed to parse telemetry: {e}")
            return None


class ProtocolRegistry:
    """Registry for protocol adapters (Factory pattern)."""

    _adapters: Dict[str, Type[BaseProtocolAdapter]] = {}

    @classmethod
    def register(cls, protocol: str, adapter_class: Type[BaseProtocolAdapter]):
        """Register a protocol adapter.

        Args:
            protocol: Protocol name (mqtt, lorawan, http, etc.)
            adapter_class: Adapter class to register
        """
        cls._adapters[protocol.lower()] = adapter_class
        logger.info(f"Registered protocol adapter: {protocol}")

    @classmethod
    def get_adapter(cls, protocol: str, config: Dict[str, Any]) -> Optional[BaseProtocolAdapter]:
        """Get protocol adapter instance.

        Args:
            protocol: Protocol name
            config: Protocol configuration

        Returns:
            Adapter instance or None if protocol not supported
        """
        adapter_class = cls._adapters.get(protocol.lower())
        if not adapter_class:
            logger.warning(f"No adapter registered for protocol: {protocol}")
            return None
        return adapter_class(config)

    @classmethod
    def list_protocols(cls) -> list[str]:
        """List all registered protocols."""
        return list(cls._adapters.keys())
