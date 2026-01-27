"""
Database seeding module for Gito IoT Platform.

This module provides industry-standard seed data generation using SQLAlchemy ORM.
All operations are idempotent and follow multi-tenant patterns.

Usage:
    python -m app.seed                  # From API container
    docker exec api python -m app.seed
"""

import asyncio
import logging
from typing import Optional
from uuid import UUID
from sqlalchemy import select
from app.database import _SessionLocal
from app.models import (
    Tenant, User, 
    NotificationChannel, NotificationTemplate
)
from app.security import hash_password

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DatabaseSeeder:
    """Handles all seed data creation with idempotent operations."""
    
    def __init__(self, db):
        self.db = db
        self.tenant_id: Optional[UUID] = None
        self.user_id: Optional[UUID] = None
    
    async def run(self) -> bool:
        """Execute all seeding operations."""
        try:
            logger.info("🌱 Starting database seeding...")
            
            await self._ensure_tenant()
            await self._ensure_user()
            await self._seed_notification_channels()
            await self._seed_notification_templates()
            
            await self.db.commit()
            logger.info("✅ Database seeding completed successfully!")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"❌ Seeding failed: {e}", exc_info=True)
            return False
    
    async def _ensure_tenant(self) -> None:
        """Ensure default tenant exists."""
        result = await self.db.execute(select(Tenant))
        tenant = result.scalars().first()
        
        if tenant:
            self.tenant_id = tenant.id
            logger.info(f"✓ Using existing tenant: {tenant.name} ({tenant.id})")
        else:
            tenant = Tenant(
                name="Default Tenant",
                slug="default-tenant",
                status="active"
            )
            self.db.add(tenant)
            await self.db.flush()
            self.tenant_id = tenant.id
            logger.info(f"✓ Created default tenant ({self.tenant_id})")
    
    async def _ensure_user(self) -> None:
        """Ensure default user exists."""
        result = await self.db.execute(
            select(User).where(User.tenant_id == self.tenant_id)
        )
        user = result.scalars().first()
        
        if user:
            self.user_id = user.id
            logger.info(f"✓ Using existing user: {user.email}")
        else:
            user = User(
                tenant_id=self.tenant_id,
                email="admin@gito-iot.local",
                password_hash=hash_password("dev-password"),
                full_name="Default Admin",
                role="TENANT_ADMIN",
                status="active"
            )
            self.db.add(user)
            await self.db.flush()
            self.user_id = user.id
            logger.info(f"✓ Created default user: {user.email}")
    
    async def _seed_notification_channels(self) -> None:
        """Create notification channels."""
        channels_config = [
            {
                "name": "Admin Email",
                "type": "email",
                "config": {"email": "admin@gito-iot.com"},
            },
            {
                "name": "Operations Email",
                "type": "email",
                "config": {"email": "operations@gito-iot.com"},
            },
            {
                "name": "Webhook Endpoint",
                "type": "webhook",
                "config": {
                    "url": "https://example.com/webhook",
                    "auth_type": "bearer",
                    "secret": "webhook-secret-key"
                },
            },
            {
                "name": "SMS Alert",
                "type": "sms",
                "config": {"phone": "+1234567890"},
            },
        ]
        
        for config in channels_config:
            result = await self.db.execute(
                select(NotificationChannel).where(
                    NotificationChannel.tenant_id == self.tenant_id,
                    NotificationChannel.channel_type == config["type"]
                )
            )
            existing = result.scalars().first()
            
            if existing:
                logger.info(f"⊘ Channel already exists: {config['name']}")
                continue
            
            channel = NotificationChannel(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                channel_type=config["type"],
                config=config["config"],
                enabled=True,
                verified=True
            )
            self.db.add(channel)
            logger.info(f"✓ Created notification channel: {config['name']}")
    
    async def _seed_notification_templates(self) -> None:
        """Create notification email templates."""
        templates_config = [
            {
                "channel_type": "email",
                "alert_type": "temperature_alarm",
                "name": "High Temperature Alert Email",
                "subject": "Temperature Alert: {{device_name}} - {{metric_value}}°C",
                "body": """Device: {{device_name}}
Location: {{site_name}}
Temperature: {{metric_value}}°C
Threshold: {{threshold}}°C
Time: {{alert_time}}

Please investigate immediately.""",
            },
            {
                "channel_type": "email",
                "alert_type": "device_offline",
                "name": "Device Offline Alert Email",
                "subject": "Device Offline: {{device_name}}",
                "body": """Device: {{device_name}}
Location: {{site_name}}
Last Seen: {{last_seen}}

Device has not reported any data. Check connectivity.""",
            },
            {
                "channel_type": "email",
                "alert_type": "battery_alert",
                "name": "Low Battery Alert Email",
                "subject": "Low Battery Warning: {{device_name}} - {{metric_value}}%",
                "body": """Device: {{device_name}}
Location: {{site_name}}
Battery Level: {{metric_value}}%
Last Updated: {{alert_time}}

Prepare for device replacement or battery swap soon.""",
            },
            {
                "channel_type": "email",
                "alert_type": "composite_alert",
                "name": "Composite Alert Email",
                "subject": "Multi-Condition Alert: {{alert_name}}",
                "body": """Alert Rule: {{alert_name}}
Device: {{device_name}}
Severity: {{severity}}
Conditions Matched: {{conditions_met}}

Time: {{alert_time}}

Review the situation and take necessary action.""",
            },
        ]
        
        for config in templates_config:
            result = await self.db.execute(
                select(NotificationTemplate).where(
                    NotificationTemplate.tenant_id == self.tenant_id,
                    NotificationTemplate.channel_type == config["channel_type"],
                    NotificationTemplate.alert_type == config["alert_type"]
                )
            )
            existing = result.scalars().first()
            
            if existing:
                logger.info(f"⊘ Template already exists: {config['name']}")
                continue
            
            template = NotificationTemplate(
                tenant_id=self.tenant_id,
                channel_type=config["channel_type"],
                alert_type=config["alert_type"],
                name=config["name"],
                subject=config.get("subject"),
                body=config["body"],
                enabled=True
            )
            self.db.add(template)
            logger.info(f"✓ Created notification template: {config['name']}")


async def main() -> int:
    """Main entry point for seeding."""
    async with _SessionLocal() as db:
        try:
            seeder = DatabaseSeeder(db)
            success = await seeder.run()
            return 0 if success else 1
        except Exception as e:
            logger.error(f"Fatal error: {e}", exc_info=True)
            return 1


if __name__ == "__main__":
    exit(asyncio.run(main()))
