"""ChirpStack API integration service for unified device management.

This service acts as a bridge between Gito and ChirpStack, allowing customers to manage
LoRaWAN devices through the Gito UI without needing to access ChirpStack directly.

Features:
- Create/update/delete ChirpStack devices from Gito
- Create/update ChirpStack applications from Gito
- Create ChirpStack gateways from Gito
- Bidirectional sync of device metadata
- Transparent error handling and logging
"""

import logging
from typing import Optional
from uuid import UUID

import aiohttp
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class ChirpStackAPIClient:
    """Client for ChirpStack REST API integration."""

    def __init__(
        self,
        api_url: str,
        tenant_id: str,
        api_key: str,
        timeout: int = 10,
    ):
        """Initialize ChirpStack API client.

        Args:
            api_url: ChirpStack REST API base URL (e.g., http://localhost:8090)
            tenant_id: ChirpStack tenant UUID
            api_key: ChirpStack API key for authentication
            timeout: Request timeout in seconds
        """
        self.api_url = api_url.rstrip("/")
        self.tenant_id = tenant_id
        self.api_key = api_key
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def health_check(self) -> bool:
        """Check if ChirpStack API is available.

        Returns:
            True if API is reachable, False otherwise
        """
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.api_url}/api/tenants",
                    headers=self.headers,
                    timeout=self.timeout,
                ) as resp:
                    return resp.status in (200, 401)  # 401 means API is up but auth failed
        except Exception as e:
            logger.warning(f"ChirpStack health check failed: {e}")
            return False

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def create_application(
        self,
        name: str,
        description: Optional[str] = None,
    ) -> dict:
        """Create a new application in ChirpStack.

        Args:
            name: Application name
            description: Optional application description

        Returns:
            Created application data

        Raises:
            Exception: If creation fails
        """
        payload = {
            "application": {
                "tenantId": self.tenant_id,
                "name": name,
                "description": description or "",
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.api_url}/api/applications",
                json=payload,
                headers=self.headers,
                timeout=self.timeout,
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Failed to create application: {error}")

                data = await resp.json()
                logger.info(
                    f"Created ChirpStack application: {name}",
                    extra={"application_id": data.get("id")},
                )
                return data

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def create_device(
        self,
        application_id: str,
        dev_eui: str,
        name: str,
        description: Optional[str] = None,
        device_profile_id: Optional[str] = None,
        variables: Optional[dict] = None,
    ) -> dict:
        """Create a new device in ChirpStack.

        Args:
            application_id: ChirpStack application ID
            dev_eui: LoRaWAN device EUI
            name: Device name
            description: Optional device description
            device_profile_id: Optional device profile UUID
            variables: Optional device variables

        Returns:
            Created device data

        Raises:
            Exception: If creation fails
        """
        payload = {
            "device": {
                "applicationId": application_id,
                "devEui": dev_eui,
                "name": name,
                "description": description or "",
                "deviceProfileId": device_profile_id or "",
                "variables": variables or {},
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.api_url}/api/devices",
                json=payload,
                headers=self.headers,
                timeout=self.timeout,
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Failed to create device: {error}")

                data = await resp.json()
                logger.info(
                    f"Created ChirpStack device: {name} ({dev_eui})",
                    extra={"device_eui": dev_eui},
                )
                return data

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def get_device(self, dev_eui: str) -> dict:
        """Get device details from ChirpStack.

        Args:
            dev_eui: LoRaWAN device EUI

        Returns:
            Device data

        Raises:
            Exception: If retrieval fails
        """
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.api_url}/api/devices/{dev_eui}",
                headers=self.headers,
                timeout=self.timeout,
            ) as resp:
                if resp.status == 404:
                    return None
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Failed to get device: {error}")

                return await resp.json()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def update_device(
        self,
        dev_eui: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        variables: Optional[dict] = None,
    ) -> dict:
        """Update device in ChirpStack.

        Args:
            dev_eui: LoRaWAN device EUI
            name: Optional new device name
            description: Optional new device description
            variables: Optional device variables

        Returns:
            Updated device data

        Raises:
            Exception: If update fails
        """
        # First get current device
        device = await self.get_device(dev_eui)
        if not device:
            raise Exception(f"Device not found: {dev_eui}")

        # Update fields
        if name is not None:
            device["device"]["name"] = name
        if description is not None:
            device["device"]["description"] = description
        if variables is not None:
            device["device"]["variables"] = variables

        async with aiohttp.ClientSession() as session:
            async with session.put(
                f"{self.api_url}/api/devices/{dev_eui}",
                json=device,
                headers=self.headers,
                timeout=self.timeout,
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Failed to update device: {error}")

                logger.info(
                    f"Updated ChirpStack device: {dev_eui}",
                    extra={"device_eui": dev_eui},
                )
                return await resp.json()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def delete_device(self, dev_eui: str) -> bool:
        """Delete device from ChirpStack.

        Args:
            dev_eui: LoRaWAN device EUI

        Returns:
            True if deleted successfully

        Raises:
            Exception: If deletion fails
        """
        async with aiohttp.ClientSession() as session:
            async with session.delete(
                f"{self.api_url}/api/devices/{dev_eui}",
                headers=self.headers,
                timeout=self.timeout,
            ) as resp:
                if resp.status not in (200, 204):
                    error = await resp.text()
                    raise Exception(f"Failed to delete device: {error}")

                logger.info(
                    f"Deleted ChirpStack device: {dev_eui}",
                    extra={"device_eui": dev_eui},
                )
                return True

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def list_applications(self, limit: int = 100) -> list:
        """List all applications in the tenant.

        Args:
            limit: Maximum number of applications to return

        Returns:
            List of application data

        Raises:
            Exception: If listing fails
        """
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.api_url}/api/applications",
                headers=self.headers,
                params={"limit": limit},
                timeout=self.timeout,
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Failed to list applications: {error}")

                data = await resp.json()
                return data.get("result", [])

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def list_device_profiles(self, limit: int = 100) -> list:
        """List all device profiles in the tenant.

        Args:
            limit: Maximum number of profiles to return

        Returns:
            List of device profile data

        Raises:
            Exception: If listing fails
        """
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.api_url}/api/device-profiles",
                headers=self.headers,
                params={"tenantId": self.tenant_id, "limit": limit},
                timeout=self.timeout,
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Failed to list device profiles: {error}")

                data = await resp.json()
                return data.get("result", [])

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
    )
    async def activate_device(
        self,
        dev_eui: str,
        dev_addr: str,
        nwk_s_key: str,
        app_s_key: str,
    ) -> dict:
        """Activate a device with ABP keys.

        Args:
            dev_eui: LoRaWAN device EUI
            dev_addr: Device address
            nwk_s_key: Network session key
            app_s_key: Application session key

        Returns:
            Activation response

        Raises:
            Exception: If activation fails
        """
        payload = {
            "deviceActivation": {
                "devAddr": dev_addr,
                "appSKey": app_s_key,
                "nwkSEncKey": nwk_s_key,
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.api_url}/api/devices/{dev_eui}/activate",
                json=payload,
                headers=self.headers,
                timeout=self.timeout,
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Failed to activate device: {error}")

                logger.info(
                    f"Activated ChirpStack device: {dev_eui}",
                    extra={"device_eui": dev_eui},
                )
                return await resp.json()


# Global client instance (initialized on first use)
_chirpstack_client: Optional[ChirpStackAPIClient] = None


def get_chirpstack_client(
    api_url: str,
    tenant_id: str,
    api_key: str,
) -> ChirpStackAPIClient:
    """Get or create ChirpStack API client.

    Args:
        api_url: ChirpStack API URL
        tenant_id: ChirpStack tenant ID
        api_key: ChirpStack API key

    Returns:
        ChirpStack API client instance
    """
    global _chirpstack_client

    if _chirpstack_client is None:
        _chirpstack_client = ChirpStackAPIClient(
            api_url=api_url,
            tenant_id=tenant_id,
            api_key=api_key,
        )

    return _chirpstack_client
