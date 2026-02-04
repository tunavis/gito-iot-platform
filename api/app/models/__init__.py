"""SQLAlchemy models for Gito IoT Platform."""

from app.models.base import (
    BaseModel,
    Tenant,
    User,
    Device,
    DeviceCredential,
    AlertRule,
    AlertRuleCondition,
    AuditLog,
)
from app.models.organization import Organization
from app.models.site import Site
from app.models.device_group import DeviceGroup, GroupDevice, BulkOperation
from app.models.notification import (
    NotificationChannel,
    NotificationRule,
    Notification,
    NotificationTemplate,
    NotificationQueue,
)
from app.models.alarm import Alarm
from app.models.composite_alert_rule import CompositeAlertRule
from app.models.unified_alert_rule import UnifiedAlertRule

__all__ = [
    "BaseModel",
    "Tenant",
    "User",
    "Device",
    "DeviceCredential",
    "AlertRule",
    "AlertRuleCondition",
    "AuditLog",
    "Organization",
    "Site",
    "DeviceGroup",
    "GroupDevice",
    "BulkOperation",
    "NotificationChannel",
    "NotificationRule",
    "Notification",
    "NotificationTemplate",
    "NotificationQueue",
    "Alarm",
    "CompositeAlertRule",  # Legacy - use UnifiedAlertRule
    "UnifiedAlertRule",    # Unified alert rules (THRESHOLD + COMPOSITE)
]
