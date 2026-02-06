"""Protocol adapters for multi-protocol device connectivity.

This module provides a unified interface for different IoT protocols:
- MQTT (default)
- LoRaWAN (via ChirpStack)
- HTTP/Webhooks
- Modbus TCP/RTU
- OPC UA
- CoAP
- WebSocket
- Custom protocols

Architecture:
- BaseProtocolAdapter: Abstract base class defining the interface
- Protocol-specific adapters: Concrete implementations
- ProtocolRegistry: Factory for creating adapters
"""

from app.protocols.base import BaseProtocolAdapter, ProtocolRegistry
from app.protocols.mqtt import MQTTAdapter
from app.protocols.http import HTTPAdapter
from app.protocols.lorawan import LoRaWANAdapter

__all__ = [
    "BaseProtocolAdapter",
    "ProtocolRegistry",
    "MQTTAdapter",
    "HTTPAdapter",
    "LoRaWANAdapter",
]
