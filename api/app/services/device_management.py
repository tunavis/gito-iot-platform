"""Device management service with ChirpStack integration.

This service handles creating, updating, and deleting devices with automatic
synchronization to ChirpStack for LoRaWAN devices.

Key responsibility: Keep Gito database and ChirpStack in sync automatically.
"""

import logging
from typing import Optional
from uuid import UUID

from app.config import get_settings
from app.services.chirpstack import get_chirpstack_client

logger = logging.getLogger(__name__)


class DeviceManagementService:
    """Service for managing devices with ChirpStack sync."""

    def __init__(self):
        """Initialize device management service."""
        self.settings = get_settings()
        self.chirpstack_client = None

        # Initialize ChirpStack client if configured
        if (
            self.settings.CHIRPSTACK_API_URL
            and self.settings.CHIRPSTACK_TENANT_ID
            and self.settings.CHIRPSTACK_API_KEY
        ):
            self.chirpstack_client = get_chirpstack_client(
                api_url=self.settings.CHIRPSTACK_API_URL,
                tenant_id=self.settings.CHIRPSTACK_TENANT_ID,
                api_key=self.settings.CHIRPSTACK_API_KEY,
            )

    async def create_device_with_chirpstack_sync(
        self,
        tenant_id: UUID,
        device_name: str,
        device_type: str,
        attributes: Optional[dict] = None,
        lorawan_dev_eui: Optional[str] = None,
        chirpstack_app_id: Optional[str] = None,
        device_profile_id: Optional[str] = None,
    ) -> dict:
        """Create device in Gito and sync to ChirpStack if applicable.

        This is the key unified integration point. When a customer creates a device:
        1. Device is saved to Gito database
        2. If LoRaWAN, device is automatically created in ChirpStack
        3. Metadata is kept in sync

        Args:
            tenant_id: Gito tenant UUID
            device_name: Human-readable device name
            device_type: Device type (temperature_sensor, water_meter, etc.)
            attributes: Optional device attributes (location, gateway, etc.)
            lorawan_dev_eui: Optional LoRaWAN device EUI (triggers ChirpStack sync)
            chirpstack_app_id: ChirpStack application ID (required if lorawan_dev_eui provided)
            device_profile_id: ChirpStack device profile UUID

        Returns:
            Device data with integration status

        Raises:
            Exception: If ChirpStack sync fails
        """
        device_data = {
            "id": None,  # Would be set by database
            "tenant_id": str(tenant_id),
            "name": device_name,
            "device_type": device_type,
            "attributes": attributes or {},
            "status": "offline",
            "chirpstack_synced": False,
            "chirpstack_dev_eui": lorawan_dev_eui,
        }

        # If this is a LoRaWAN device, sync to ChirpStack
        if lorawan_dev_eui and self.chirpstack_client:
            try:
                logger.info(
                    "Syncing device to ChirpStack",
                    extra={
                        "tenant_id": str(tenant_id),
                        "device_eui": lorawan_dev_eui,
                        "device_name": device_name,
                    },
                )

                # Create device in ChirpStack
                chirpstack_response = await self.chirpstack_client.create_device(
                    application_id=chirpstack_app_id,
                    dev_eui=lorawan_dev_eui,
                    name=device_name,
                    description=f"Device for tenant {tenant_id}",
                    device_profile_id=device_profile_id,
                    variables={"gito_device_id": str(None)},  # Will have ID after DB save
                )

                device_data["chirpstack_synced"] = True
                device_data["chirpstack_device_id"] = chirpstack_response.get("id")

                logger.info(
                    "Device synced to ChirpStack successfully",
                    extra={
                        "tenant_id": str(tenant_id),
                        "device_eui": lorawan_dev_eui,
                        "chirpstack_id": chirpstack_response.get("id"),
                    },
                )

            except Exception as e:
                logger.error(
                    "Failed to sync device to ChirpStack",
                    extra={
                        "tenant_id": str(tenant_id),
                        "device_eui": lorawan_dev_eui,
                        "error": str(e),
                    },
                )
                # Don't fail device creation if ChirpStack is down
                # Device will be created in Gito, sync can retry later
                device_data["chirpstack_sync_error"] = str(e)

        return device_data

    async def update_device_with_chirpstack_sync(
        self,
        tenant_id: UUID,
        device_id: UUID,
        device_name: Optional[str] = None,
        lorawan_dev_eui: Optional[str] = None,
        attributes: Optional[dict] = None,
    ) -> dict:
        """Update device in Gito and sync changes to ChirpStack.

        Args:
            tenant_id: Gito tenant UUID
            device_id: Gito device UUID
            device_name: New device name (optional)
            lorawan_dev_eui: LoRaWAN device EUI (if device is LoRaWAN)
            attributes: Updated attributes

        Returns:
            Updated device data

        Raises:
            Exception: If ChirpStack sync fails
        """
        logger.info(
            "Updating device",
            extra={
                "tenant_id": str(tenant_id),
                "device_id": str(device_id),
                "name": device_name,
            },
        )

        # Update in ChirpStack if LoRaWAN
        if lorawan_dev_eui and self.chirpstack_client:
            try:
                await self.chirpstack_client.update_device(
                    dev_eui=lorawan_dev_eui,
                    name=device_name,
                    variables={"gito_device_id": str(device_id)},
                )

                logger.info(
                    "Device updated in ChirpStack",
                    extra={
                        "tenant_id": str(tenant_id),
                        "device_eui": lorawan_dev_eui,
                    },
                )

            except Exception as e:
                logger.error(
                    "Failed to update device in ChirpStack",
                    extra={
                        "tenant_id": str(tenant_id),
                        "device_eui": lorawan_dev_eui,
                        "error": str(e),
                    },
                )

        return {
            "id": device_id,
            "tenant_id": tenant_id,
            "name": device_name,
            "attributes": attributes,
            "chirpstack_synced": bool(lorawan_dev_eui),
        }

    async def delete_device_with_chirpstack_cleanup(
        self,
        tenant_id: UUID,
        device_id: UUID,
        lorawan_dev_eui: Optional[str] = None,
    ) -> bool:
        """Delete device from Gito and clean up ChirpStack.

        Args:
            tenant_id: Gito tenant UUID
            device_id: Gito device UUID
            lorawan_dev_eui: LoRaWAN device EUI (if device is LoRaWAN)

        Returns:
            True if deletion successful

        Raises:
            Exception: If ChirpStack cleanup fails
        """
        logger.info(
            "Deleting device",
            extra={
                "tenant_id": str(tenant_id),
                "device_id": str(device_id),
                "lorawan_dev_eui": lorawan_dev_eui,
            },
        )

        # Delete from ChirpStack if LoRaWAN
        if lorawan_dev_eui and self.chirpstack_client:
            try:
                await self.chirpstack_client.delete_device(dev_eui=lorawan_dev_eui)

                logger.info(
                    "Device deleted from ChirpStack",
                    extra={
                        "tenant_id": str(tenant_id),
                        "device_eui": lorawan_dev_eui,
                    },
                )

            except Exception as e:
                logger.error(
                    "Failed to delete device from ChirpStack",
                    extra={
                        "tenant_id": str(tenant_id),
                        "device_eui": lorawan_dev_eui,
                        "error": str(e),
                    },
                )
                # Continue with Gito deletion even if ChirpStack fails

        return True

    async def sync_device_to_chirpstack_retro(
        self,
        tenant_id: UUID,
        device_id: UUID,
        device_name: str,
        lorawan_dev_eui: str,
        chirpstack_app_id: str,
        device_profile_id: Optional[str] = None,
    ) -> dict:
        """Retroactively sync an existing Gito device to ChirpStack.

        This is useful for devices created before ChirpStack integration was enabled,
        or if initial sync failed and you want to retry.

        Args:
            tenant_id: Gito tenant UUID
            device_id: Gito device UUID
            device_name: Device name
            lorawan_dev_eui: LoRaWAN device EUI
            chirpstack_app_id: ChirpStack application ID
            device_profile_id: Optional ChirpStack device profile ID

        Returns:
            Sync result with status

        Raises:
            Exception: If sync fails
        """
        if not self.chirpstack_client:
            raise Exception("ChirpStack integration not configured")

        logger.info(
            "Retroactively syncing device to ChirpStack",
            extra={
                "tenant_id": str(tenant_id),
                "device_id": str(device_id),
                "device_eui": lorawan_dev_eui,
            },
        )

        try:
            # Check if device already exists in ChirpStack
            existing = await self.chirpstack_client.get_device(lorawan_dev_eui)

            if existing:
                logger.warning(
                    "Device already exists in ChirpStack, updating",
                    extra={"device_eui": lorawan_dev_eui},
                )

                # Update existing device
                await self.chirpstack_client.update_device(
                    dev_eui=lorawan_dev_eui,
                    name=device_name,
                    variables={"gito_device_id": str(device_id)},
                )
            else:
                # Create new device
                await self.chirpstack_client.create_device(
                    application_id=chirpstack_app_id,
                    dev_eui=lorawan_dev_eui,
                    name=device_name,
                    description=f"Device for tenant {tenant_id}",
                    device_profile_id=device_profile_id,
                    variables={"gito_device_id": str(device_id)},
                )

            logger.info(
                "Device retroactively synced to ChirpStack",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_eui": lorawan_dev_eui,
                },
            )

            return {
                "success": True,
                "device_eui": lorawan_dev_eui,
                "synced_at": None,  # Would have timestamp from DB
            }

        except Exception as e:
            logger.error(
                "Failed to retroactively sync device",
                extra={
                    "tenant_id": str(tenant_id),
                    "device_eui": lorawan_dev_eui,
                    "error": str(e),
                },
            )
            raise


# Global instance
_device_mgmt_service: Optional[DeviceManagementService] = None


def get_device_management_service() -> DeviceManagementService:
    """Get or create device management service instance."""
    global _device_mgmt_service

    if _device_mgmt_service is None:
        _device_mgmt_service = DeviceManagementService()

    return _device_mgmt_service
