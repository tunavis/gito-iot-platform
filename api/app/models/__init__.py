"""SQLAlchemy models for Gito IoT Platform."""

from app.models.base import (
    BaseModel,
    Tenant,
    User,
    Device,
    DeviceCredential,
    AlertEvent,
    AuditLog,
    FirmwareVersion,
    OTACampaign,
    OTACampaignDevice,
    DeviceFirmwareHistory,
)
from app.models.organization import Organization
from app.models.site import Site
from app.models.asset import Asset, MAX_ASSET_DEPTH
from app.models.device_group import DeviceGroup, GroupDevice, BulkOperation
from app.models.notification import (
    NotificationChannel,
    NotificationRule,
    Notification,
    NotificationTemplate,
    NotificationQueue,
)
from app.models.alarm import Alarm
from app.models.unified_alert_rule import UnifiedAlertRule
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.device_type import DeviceType
from app.models.billing import (
    Plan,
    PlanPrice,
    Feature,
    PlanFeature,
    Subscription,
    SubscriptionEvent,
    UsageCounter,
    Invoice,
    Payment,
    WebhookEvent,
    TrialFingerprint,
)

__all__ = [
    "BaseModel",
    "Tenant",
    "User",
    "Device",
    "DeviceCredential",
    "AlertEvent",
    "AuditLog",
    "Organization",
    "Site",
    "Asset",
    "MAX_ASSET_DEPTH",
    "DeviceGroup",
    "GroupDevice",
    "BulkOperation",
    "NotificationChannel",
    "NotificationRule",
    "Notification",
    "NotificationTemplate",
    "NotificationQueue",
    "Alarm",
    "UnifiedAlertRule",  # Unified alert rules (THRESHOLD + COMPOSITE)
    "Dashboard",
    "DashboardWidget",
    "DeviceType",
    "FirmwareVersion",
    "OTACampaign",
    "OTACampaignDevice",
    "DeviceFirmwareHistory",
    "Plan",
    "PlanPrice",
    "Feature",
    "PlanFeature",
    "Subscription",
    "SubscriptionEvent",
    "UsageCounter",
    "Invoice",
    "Payment",
    "WebhookEvent",
    "TrialFingerprint",
]
