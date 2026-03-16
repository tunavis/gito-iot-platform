"""Device Type schemas - Pydantic models for device type API."""

from datetime import datetime
from typing import Optional, List, Any, Dict
from uuid import UUID
from enum import Enum

from pydantic import BaseModel, Field, computed_field, model_validator


class DeviceCategory(str, Enum):
    """Device categories."""
    SENSOR = "sensor"
    GATEWAY = "gateway"
    ACTUATOR = "actuator"
    TRACKER = "tracker"
    METER = "meter"
    CAMERA = "camera"
    CONTROLLER = "controller"
    OTHER = "other"


class DeviceCapability(str, Enum):
    """Device capabilities."""
    TELEMETRY = "telemetry"
    COMMANDS = "commands"
    FIRMWARE_OTA = "firmware_ota"
    REMOTE_CONFIG = "remote_config"
    LOCATION = "location"
    ALERTS = "alerts"
    FILE_TRANSFER = "file_transfer"
    EDGE_COMPUTE = "edge_compute"


class FieldType(str, Enum):
    """Supported telemetry field types (matches frontend FIELD_TYPES)."""
    FLOAT = "float"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    STRING = "string"
    TIMESTAMP = "timestamp"
    JSON = "json"
    ARRAY = "array"


class ProtocolType(str, Enum):
    """Supported connectivity protocols (matches frontend ProtocolSelector)."""
    MQTT = "mqtt"
    LORAWAN = "lorawan"
    HTTP = "http"
    MODBUS = "modbus"
    OPCUA = "opcua"
    COAP = "coap"
    WEBSOCKET = "websocket"
    CUSTOM = "custom"


class DataModelField(BaseModel):
    """A field in the device type's data model."""
    name: str = Field(..., description="Field name (e.g., 'temperature')")
    type: FieldType = Field(default=FieldType.FLOAT, description="Data type")
    unit: Optional[str] = Field(None, description="Unit of measurement (e.g., '°C', '%')")
    description: Optional[str] = Field(None, description="Human-readable description")
    min_value: Optional[float] = Field(None, alias="min", description="Minimum valid value")
    max_value: Optional[float] = Field(None, alias="max", description="Maximum valid value")
    required: bool = Field(default=False, description="Is this field required in telemetry?")

    class Config:
        populate_by_name = True
        use_enum_values = True


class ConnectivityConfig(BaseModel):
    """Connectivity/protocol configuration."""
    protocol: ProtocolType = Field(default=ProtocolType.MQTT, description="Communication protocol")
    mqtt_topic_template: Optional[str] = Field(None, description="MQTT topic template")
    lorawan_class: Optional[str] = Field(None, description="LoRaWAN class: A, B, C")
    http_endpoint: Optional[str] = Field(None, description="HTTP webhook endpoint")

    class Config:
        use_enum_values = True


class DefaultSettings(BaseModel):
    """Default settings for devices of this type."""
    heartbeat_interval: int = Field(default=60, description="Heartbeat interval in seconds")
    telemetry_interval: int = Field(default=300, description="Telemetry reporting interval in seconds")
    offline_threshold: int = Field(default=900, description="Seconds before device considered offline")
    battery_low_threshold: Optional[int] = Field(default=20, description="Low battery alert threshold (%)")


class DeviceTypeCreate(BaseModel):
    """Schema for creating a device type."""
    name: str = Field(..., min_length=1, max_length=255, description="Device type name")
    description: Optional[str] = Field(None, description="Description")
    manufacturer: Optional[str] = Field(None, max_length=255, description="Manufacturer name")
    model: Optional[str] = Field(None, max_length=255, description="Model number/name")
    category: DeviceCategory = Field(default=DeviceCategory.SENSOR, description="Device category")

    icon: Optional[str] = Field(default="cpu", description="Lucide icon name")
    color: Optional[str] = Field(default="#6366f1", description="Hex color code")

    data_model: Optional[List[DataModelField]] = Field(default=[], description="Telemetry data model")
    capabilities: Optional[List[DeviceCapability]] = Field(default=[DeviceCapability.TELEMETRY], description="Device capabilities")
    default_settings: Optional[DefaultSettings] = Field(default=None, description="Default device settings")
    connectivity: Optional[ConnectivityConfig] = Field(default=None, description="Connectivity configuration")
    command_schema: Optional[dict] = Field(default={}, description="Available commands with parameter schemas")
    metadata: Optional[dict] = Field(default={}, description="Custom metadata")

    @model_validator(mode="after")
    def validate_unique_field_names(self) -> "DeviceTypeCreate":
        if self.data_model:
            names = [f.name for f in self.data_model]
            if len(names) != len(set(names)):
                duplicates = [n for n in set(names) if names.count(n) > 1]
                raise ValueError(f"Data model field names must be unique. Duplicates: {duplicates}")
        return self

    class Config:
        use_enum_values = True


class DeviceTypeUpdate(BaseModel):
    """Schema for updating a device type."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    category: Optional[DeviceCategory] = None

    icon: Optional[str] = None
    color: Optional[str] = None

    data_model: Optional[List[DataModelField]] = None
    capabilities: Optional[List[DeviceCapability]] = None
    default_settings: Optional[DefaultSettings] = None
    connectivity: Optional[ConnectivityConfig] = None
    command_schema: Optional[dict] = None
    metadata: Optional[dict] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def validate_unique_field_names(self) -> "DeviceTypeUpdate":
        if self.data_model:
            names = [f.name for f in self.data_model]
            if len(names) != len(set(names)):
                duplicates = [n for n in set(names) if names.count(n) > 1]
                raise ValueError(f"Data model field names must be unique. Duplicates: {duplicates}")
        return self

    class Config:
        use_enum_values = True


class DeviceTypeResponse(BaseModel):
    """Schema for device type response."""
    id: UUID
    tenant_id: UUID
    name: str
    description: Optional[str]
    manufacturer: Optional[str]
    model: Optional[str]
    category: str

    icon: Optional[str]
    color: Optional[str]

    data_model: List[Any]
    capabilities: List[str]
    default_settings: Optional[dict]
    connectivity: Optional[dict]
    command_schema: Optional[dict] = Field(default={})
    metadata: Optional[dict] = Field(None, validation_alias="extra_metadata")

    is_active: bool
    device_count: int

    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def telemetry_schema(self) -> Dict[str, Dict[str, Any]]:
        """
        Convert data_model array to telemetry_schema object for frontend compatibility.

        Transforms:
        [{"name": "temperature", "type": "float", "unit": "°C", "min": -40, "max": 85}]

        To:
        {"temperature": {"type": "float", "unit": "°C", "min": -40, "max": 85}}
        """
        schema = {}
        for field in self.data_model:
            if isinstance(field, dict) and "name" in field:
                field_name = field["name"]
                field_schema = {k: v for k, v in field.items() if k != "name"}
                schema[field_name] = field_schema
        return schema

    class Config:
        from_attributes = True
        populate_by_name = True


class DeviceTypeListResponse(BaseModel):
    """Paginated list of device types."""
    success: bool = True
    data: List[DeviceTypeResponse]
    meta: dict
