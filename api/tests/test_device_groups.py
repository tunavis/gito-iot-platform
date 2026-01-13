"""Integration tests for device group management API."""

import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import create_app
from app.database import get_db
from app.models import Tenant, User, Device, DeviceGroup, GroupDevice
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
def other_tenant(db_session):
    """Create another tenant for isolation testing."""
    tenant = Tenant(
        id=uuid4(),
        name="Other Tenant",
        slug="other-tenant",
        status="active"
    )
    db_session.add(tenant)
    db_session.commit()
    return tenant


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


class TestDeviceGroupCRUD:
    """Test device group CRUD operations."""

    def test_create_group(self, client, test_tenant, auth_headers):
        """Test creating a device group."""
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={
                "name": "Lab Sensors",
                "description": "Temperature sensors in lab",
                "membership_rule": {"tags": ["location:lab"]}
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Lab Sensors"
        assert data["description"] == "Temperature sensors in lab"
        assert data["member_count"] == 0

    def test_create_group_duplicate_name(self, client, test_tenant, auth_headers, db_session):
        """Test that duplicate group names are rejected."""
        # Create first group
        client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        
        # Try to create group with same name
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        
        assert response.status_code == 409

    def test_get_group(self, client, test_tenant, auth_headers, db_session):
        """Test getting a device group."""
        # Create group
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Get group
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        assert response.json()["name"] == "Lab Sensors"

    def test_list_groups(self, client, test_tenant, auth_headers):
        """Test listing device groups."""
        # Create multiple groups
        for i in range(3):
            client.post(
                f"/api/v1/tenants/{test_tenant.id}/device-groups",
                json={"name": f"Group {i}"},
                headers=auth_headers
            )
        
        # List groups
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["meta"]["total"] == 3
        assert len(data["data"]) == 3

    def test_update_group(self, client, test_tenant, auth_headers, db_session):
        """Test updating a device group."""
        # Create group
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Update group
        response = client.patch(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}",
            json={
                "name": "Updated Lab Sensors",
                "description": "Updated description"
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Lab Sensors"
        assert response.json()["description"] == "Updated description"

    def test_delete_group(self, client, test_tenant, auth_headers, db_session):
        """Test deleting a device group."""
        # Create group
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Delete group
        response = client.delete(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        
        # Verify it's deleted
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}",
            headers=auth_headers
        )
        assert response.status_code == 404


class TestDeviceGroupMembership:
    """Test device group membership operations."""

    def test_add_devices_to_group(self, client, test_tenant, test_devices, auth_headers, db_session):
        """Test adding devices to group."""
        # Create group
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Add devices
        device_ids = [str(d.id) for d in test_devices[:3]]
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/add",
            json={"device_ids": device_ids},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["added"] == 3
        assert data["failed"] == 0

    def test_add_duplicate_devices(self, client, test_tenant, test_devices, auth_headers, db_session):
        """Test adding devices that are already in group."""
        # Create group
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Add devices first time
        device_ids = [str(test_devices[0].id)]
        client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/add",
            json={"device_ids": device_ids},
            headers=auth_headers
        )
        
        # Try to add same device again
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/add",
            json={"device_ids": device_ids},
            headers=auth_headers
        )
        
        data = response.json()
        assert data["added"] == 0
        assert data["skipped"] == 1

    def test_get_group_members(self, client, test_tenant, test_devices, auth_headers):
        """Test listing group members."""
        # Create group
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Add devices
        device_ids = [str(d.id) for d in test_devices[:3]]
        client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/add",
            json={"device_ids": device_ids},
            headers=auth_headers
        )
        
        # Get members
        response = client.get(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["meta"]["total"] == 3
        assert len(data["data"]) == 3

    def test_remove_devices_from_group(self, client, test_tenant, test_devices, auth_headers):
        """Test removing devices from group."""
        # Create group and add devices
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        device_ids = [str(d.id) for d in test_devices[:3]]
        client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/add",
            json={"device_ids": device_ids},
            headers=auth_headers
        )
        
        # Remove devices
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/remove",
            json={"device_ids": device_ids[:2]},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["added"] == 2  # "added" field reused for removed count

    def test_add_nonexistent_device(self, client, test_tenant, auth_headers):
        """Test adding nonexistent device to group."""
        # Create group
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Lab Sensors"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Try to add nonexistent device
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/add",
            json={"device_ids": [str(uuid4())]},
            headers=auth_headers
        )
        
        data = response.json()
        assert data["failed"] == 1
        assert data["added"] == 0


class TestTenantIsolation:
    """Test tenant isolation for device groups."""

    def test_cross_tenant_group_isolation(self, client, test_tenant, other_tenant, auth_headers, db_session):
        """Test that users can't access other tenant's groups."""
        # Create group in test_tenant
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Test Group"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Try to access group from other_tenant (should fail)
        response = client.get(
            f"/api/v1/tenants/{other_tenant.id}/device-groups/{group_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 403

    def test_cross_tenant_device_isolation(self, client, test_tenant, other_tenant, test_devices, auth_headers, db_session):
        """Test that users can't add other tenant's devices to their groups."""
        # Create device in other_tenant
        other_device = Device(
            id=uuid4(),
            tenant_id=other_tenant.id,
            name="Other Device",
            device_type="sensor"
        )
        db_session.add(other_device)
        db_session.commit()
        
        # Create group in test_tenant
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups",
            json={"name": "Test Group"},
            headers=auth_headers
        )
        group_id = response.json()["id"]
        
        # Try to add other tenant's device (should fail)
        response = client.post(
            f"/api/v1/tenants/{test_tenant.id}/device-groups/{group_id}/members/add",
            json={"device_ids": [str(other_device.id)]},
            headers=auth_headers
        )
        
        data = response.json()
        assert data["failed"] == 1
        assert data["added"] == 0
