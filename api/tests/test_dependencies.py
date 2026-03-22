"""Tests for centralized auth dependency functions in app.dependencies."""

import pytest
from unittest.mock import patch
from uuid import UUID
from fastapi import HTTPException

from app.dependencies import (
    get_current_tenant,
    get_current_user,
    get_current_user_id,
    get_current_user_info,
    get_management_tenant,
)

TENANT_ID = "12345678-1234-5678-1234-567812345678"
USER_ID = "87654321-4321-8765-4321-876543218765"

VALID_PAYLOAD = {
    "tenant_id": TENANT_ID,
    "sub": USER_ID,
    "role": "TENANT_ADMIN",
    "tenant_type": "client",
}

MANAGEMENT_PAYLOAD = {
    "tenant_id": TENANT_ID,
    "sub": USER_ID,
    "role": "SUPER_ADMIN",
    "tenant_type": "management",
}


# ---------------------------------------------------------------------------
# get_current_tenant
# ---------------------------------------------------------------------------

class TestGetCurrentTenant:
    @pytest.mark.asyncio
    async def test_valid_token_returns_tenant_uuid(self):
        with patch("app.dependencies.decode_token", return_value=VALID_PAYLOAD):
            result = await get_current_tenant(authorization="Bearer valid.token.here")
        assert result == UUID(TENANT_ID)

    @pytest.mark.asyncio
    async def test_missing_authorization_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_tenant(authorization=None)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_non_bearer_prefix_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_tenant(authorization="Basic sometoken")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_tenant_id_in_token_raises_401(self):
        payload_no_tenant = {"sub": USER_ID, "role": "TENANT_ADMIN"}
        with patch("app.dependencies.decode_token", return_value=payload_no_tenant):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_tenant(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# get_current_user
# ---------------------------------------------------------------------------

class TestGetCurrentUser:
    @pytest.mark.asyncio
    async def test_valid_token_returns_tuple(self):
        with patch("app.dependencies.decode_token", return_value=VALID_PAYLOAD):
            result = await get_current_user(authorization="Bearer valid.token.here")
        assert result == (UUID(TENANT_ID), UUID(USER_ID))

    @pytest.mark.asyncio
    async def test_missing_authorization_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(authorization=None)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_non_bearer_prefix_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(authorization="Token sometoken")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_tenant_id_raises_401(self):
        payload_no_tenant = {"sub": USER_ID}
        with patch("app.dependencies.decode_token", return_value=payload_no_tenant):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_user_id_raises_401(self):
        payload_no_user = {"tenant_id": TENANT_ID}
        with patch("app.dependencies.decode_token", return_value=payload_no_user):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# get_current_user_id
# ---------------------------------------------------------------------------

class TestGetCurrentUserId:
    @pytest.mark.asyncio
    async def test_valid_token_returns_user_uuid(self):
        with patch("app.dependencies.decode_token", return_value=VALID_PAYLOAD):
            result = await get_current_user_id(authorization="Bearer valid.token.here")
        assert result == UUID(USER_ID)

    @pytest.mark.asyncio
    async def test_missing_authorization_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user_id(authorization=None)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_non_bearer_prefix_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user_id(authorization="Basic sometoken")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_user_id_raises_401(self):
        payload_no_user = {"tenant_id": TENANT_ID}
        with patch("app.dependencies.decode_token", return_value=payload_no_user):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user_id(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# get_current_user_info
# ---------------------------------------------------------------------------

class TestGetCurrentUserInfo:
    @pytest.mark.asyncio
    async def test_valid_token_returns_dict(self):
        with patch("app.dependencies.decode_token", return_value=VALID_PAYLOAD):
            result = await get_current_user_info(authorization="Bearer valid.token.here")
        assert result["user_id"] == UUID(USER_ID)
        assert result["tenant_id"] == UUID(TENANT_ID)
        assert result["role"] == "TENANT_ADMIN"

    @pytest.mark.asyncio
    async def test_missing_authorization_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user_info(authorization=None)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_non_bearer_prefix_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_current_user_info(authorization="Basic sometoken")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_user_id_raises_401(self):
        payload_no_user = {"tenant_id": TENANT_ID}
        with patch("app.dependencies.decode_token", return_value=payload_no_user):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user_info(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_tenant_id_raises_401(self):
        payload_no_tenant = {"sub": USER_ID}
        with patch("app.dependencies.decode_token", return_value=payload_no_tenant):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user_info(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# get_management_tenant
# ---------------------------------------------------------------------------

class TestGetManagementTenant:
    @pytest.mark.asyncio
    async def test_valid_management_token_returns_tuple(self):
        with patch("app.dependencies.decode_token", return_value=MANAGEMENT_PAYLOAD):
            result = await get_management_tenant(authorization="Bearer valid.token.here")
        assert result == (UUID(TENANT_ID), UUID(USER_ID))

    @pytest.mark.asyncio
    async def test_missing_authorization_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_management_tenant(authorization=None)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_non_bearer_prefix_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_management_tenant(authorization="Basic sometoken")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_tenant_id_raises_401(self):
        payload_no_tenant = {"sub": USER_ID, "tenant_type": "management"}
        with patch("app.dependencies.decode_token", return_value=payload_no_tenant):
            with pytest.raises(HTTPException) as exc_info:
                await get_management_tenant(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_non_management_tenant_raises_403(self):
        with patch("app.dependencies.decode_token", return_value=VALID_PAYLOAD):
            with pytest.raises(HTTPException) as exc_info:
                await get_management_tenant(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_client_tenant_type_raises_403(self):
        client_payload = {**MANAGEMENT_PAYLOAD, "tenant_type": "client"}
        with patch("app.dependencies.decode_token", return_value=client_payload):
            with pytest.raises(HTTPException) as exc_info:
                await get_management_tenant(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_missing_user_id_raises_401(self):
        payload_no_user = {"tenant_id": TENANT_ID, "tenant_type": "management"}
        with patch("app.dependencies.decode_token", return_value=payload_no_user):
            with pytest.raises(HTTPException) as exc_info:
                await get_management_tenant(authorization="Bearer valid.token.here")
        assert exc_info.value.status_code == 401
