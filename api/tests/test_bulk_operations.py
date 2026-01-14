"""Integration tests for bulk operations API."""

import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import create_app
from app.database import get_db
from app.models import Tenant, User, Device, DeviceGroup, GroupDevice, FirmwareVersion
from app.security import hash_password


@pytest.fixture
def app():
    """Create test app."""
    return create_app()


@pytest.fixture
def client(app, db_session):
    """Create test client."""
    def override_get_db():
        return db_session
    
    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


@pytest.fixture
def test_tenant(db_session):
    """Create test tenant."""
    tenant = Tenant(
        id=uuid4(),
        name="Test Tenant",
        slug="test-tenant",
        status="active"
    )
    db_session.add(tenant)
    db_session.commit()
    return tenant


@pytest.fixture
def test_user(db_session, test_tenant):
    """Create test user."""
    user = User(
        id=uuid4(),
        tenant_id=test_tenant.id,
        email="test@example.com",
        password_hash=hash_password("password123"),
        full_name="Test User",
        role="TENANT_ADMIN"
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def test_firmware(db_session, test_tenant):
    """Create test firmware version."""
    firmware = FirmwareVersion(
        id=uuid4(),
        tenant_id=test_tenant.id,
        name="Test Firmware",
        version="1.0.0",
        url="https://example.com/firmware.bin",
        size_bytes=1024000,
        hash="abc123",
        release_type="production"
    )
    db_session.add(firmware)
    db_session.commit()
    return firmware


@pytest.fixture
def test_device_group(db_session, test_tenant, test_devices):
    """Create test device group with members."""
    group = DeviceGroup(
        id=uuid4(),
        tenant_id=test_tenant.id,
        name="Test Group",
        description="Test device group"
    )
    db_session.add(group)
    db_session.flush()
    
    # Add devices to group
    for device in test_devices:
        membership = GroupDevice(
            group_id=group.id,
            device_id=device.id
        )
        db_session.add(membership)
    
    db_session.commit()
    return group


@pytest.fixture
def test_devices(db_session, test_tenant):
    """Create test devices."""
    devices = []
    for i in range(5):
        device = Device(
            id=uuid4(),
            tenant_id=test_tenant.id,
            name=f"Device {i}",
            device_type="sensor",
            status="online"
        )
        db_session.add(device)
        devices.append(device)
    
    db_session.commit()
    return devices


@pytest.fixture
def auth_headers(client, test_user):
    """Get authentication headers."""
    response = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "password123"}
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestBulkOTAOperations:
    """Test bulk OTA operations."""

    def test_start_bulk_ota(self, client, test_tenant, test_device_group, test_firmware, auth_headers):
        """Test starting bulk OTA update."""
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-ota",
            json={"firmware_version_id": str(test_firmware.id)},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["operation_id"]
        assert data["status"] == "queued"
        assert data["devices_total"] == 5
        assert "started for 5 devices" in data["message"]

    def test_start_bulk_ota_nonexistent_group(self, client, test_tenant, test_firmware, auth_headers):
        """Test starting bulk OTA with nonexistent group."""
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{uuid4()}/bulk-ota",
            json={"firmware_version_id": str(test_firmware.id)},
            headers=auth_headers
        )
        
        assert response.status_code == 404

    def test_start_bulk_ota_nonexistent_firmware(self, client, test_tenant, test_device_group, auth_headers):
        """Test starting bulk OTA with nonexistent firmware."""
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-ota",
            json={"firmware_version_id": str(uuid4())},
            headers=auth_headers
        )
        
        assert response.status_code == 404

    def test_start_bulk_ota_empty_group(self, client, test_tenant, test_firmware, auth_headers, db_session):
        """Test starting bulk OTA with empty group."""
        empty_group = DeviceGroup(
            id=uuid4(),
            tenant_id=test_tenant.id,
            name="Empty Group",
            description="Group with no devices"
        )
        db_session.add(empty_group)
        db_session.commit()
        
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{empty_group.id}/bulk-ota",
            json={"firmware_version_id": str(test_firmware.id)},
            headers=auth_headers
        )
        
        assert response.status_code == 404


class TestBulkCommandOperations:
    """Test bulk command operations."""

    def test_start_bulk_command(self, client, test_tenant, test_device_group, auth_headers):
        """Test sending bulk command."""
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-command",
            json={
                "command": "reboot",
                "payload": {"delay_seconds": 30}
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["operation_id"]
        assert data["status"] == "queued"
        assert data["devices_total"] == 5
        assert "reboot" in data["message"]

    def test_start_bulk_command_no_payload(self, client, test_tenant, test_device_group, auth_headers):
        """Test bulk command without payload."""
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-command",
            json={"command": "reboot"},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["devices_total"] == 5


class TestBulkOperationStatus:
    """Test bulk operation status tracking."""

    def test_get_bulk_operation(self, client, test_tenant, test_device_group, test_firmware, auth_headers):
        """Test retrieving bulk operation details."""
        # Start operation
        start_response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-ota",
            json={"firmware_version_id": str(test_firmware.id)},
            headers=auth_headers
        )
        operation_id = start_response.json()["operation_id"]
        
        # Get operation
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/bulk-operations/{operation_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == operation_id
        assert data["status"] == "queued"
        assert data["devices_total"] == 5
        assert data["devices_completed"] == 0

    def test_list_group_bulk_operations(self, client, test_tenant, test_device_group, test_firmware, auth_headers):
        """Test listing bulk operations for a group."""
        # Start operation
        client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-ota",
            json={"firmware_version_id": str(test_firmware.id)},
            headers=auth_headers
        )
        
        # List operations
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-operations",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["meta"]["total"] == 1
        assert len(data["data"]) == 1

    def test_list_bulk_operations(self, client, test_tenant, test_device_group, test_firmware, auth_headers):
        """Test listing all bulk operations for tenant."""
        # Start operations
        for _ in range(3):
            client.post(
                f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-ota",
                json={"firmware_version_id": str(test_firmware.id)},
                headers=auth_headers
            )
        
        # List operations
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/bulk-operations",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["meta"]["total"] == 3
        assert len(data["data"]) == 3

    def test_list_operations_with_status_filter(self, client, test_tenant, test_device_group, test_firmware, auth_headers):
        """Test listing operations with status filter."""
        # Start operations
        client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-ota",
            json={"firmware_version_id": str(test_firmware.id)},
            headers=auth_headers
        )
        
        # Filter by status
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/bulk-operations?status=queued",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["meta"]["total"] == 1
        assert data["meta"]["status_filter"] == "queued"

    def test_get_nonexistent_operation(self, client, test_tenant, auth_headers):
        """Test getting nonexistent operation."""
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/bulk-operations/{uuid4()}",
            headers=auth_headers
        )
        
        assert response.status_code == 404


class TestBulkOperationsTenantIsolation:
    """Test tenant isolation for bulk operations."""

    def test_cross_tenant_operation_isolation(self, client, test_tenant, test_device_group, test_firmware, auth_headers, db_session):
        """Test that operations from other tenants are not accessible."""
        # Create other tenant
        other_tenant = Tenant(
            id=uuid4(),
            name="Other Tenant",
            slug="other-tenant",
            status="active"
        )
        db_session.add(other_tenant)
        db_session.commit()
        
        # Start operation in test_tenant
        start_response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{test_device_group.id}/bulk-ota",
            json={"firmware_version_id": str(test_firmware.id)},
            headers=auth_headers
        )
        operation_id = start_response.json()["operation_id"]
        
        # Try to access from other_tenant (should fail due to authorization check)
        response = client.get(
            f"/api/v1/tenants/{other_tenant.id}/bulk-operations/{operation_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 403
