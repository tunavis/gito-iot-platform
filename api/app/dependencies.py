"""Centralized FastAPI auth dependencies for JWT-based authentication.

All routers should import from here instead of defining local auth functions.
"""

from uuid import UUID

from fastapi import Header, HTTPException, status

from app.security import decode_token


async def get_current_tenant(authorization: str = Header(None)) -> UUID:
    """Extract tenant_id from JWT Bearer token.

    Returns the tenant_id UUID from the token payload.
    Raises 401 if the header is missing, malformed, or the token is invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")

    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )

    return UUID(tenant_id)


async def get_current_user(authorization: str = Header(None)) -> tuple[UUID, UUID]:
    """Extract (tenant_id, user_id) from JWT Bearer token.

    Returns a tuple of (tenant_id, user_id) UUIDs.
    Raises 401 if the header is missing, malformed, or the token is invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    user_id = payload.get("sub")

    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing user_id",
        )

    return UUID(tenant_id), UUID(user_id)


async def get_current_user_id(authorization: str = Header(None)) -> UUID:
    """Extract user_id from JWT Bearer token.

    Returns the user_id UUID from the token payload.
    Raises 401 if the header is missing, malformed, or the token is invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing user_id",
        )

    return UUID(user_id)


async def get_current_user_info(authorization: str = Header(None)) -> dict:
    """Extract user info dict from JWT Bearer token.

    Returns a dict with keys: user_id (UUID), tenant_id (UUID), role (str).
    Raises 401 if the header is missing, malformed, or the token is invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)

    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing user_id",
        )

    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing tenant_id",
        )

    return {
        "user_id": UUID(user_id),
        "tenant_id": UUID(tenant_id),
        "role": payload.get("role"),
    }


async def get_management_tenant(authorization: str = Header(None)) -> tuple[UUID, UUID]:
    """Extract (tenant_id, user_id) and validate management tenant access.

    Returns a tuple of (tenant_id, user_id) UUIDs.
    Raises 401 if the header is missing, malformed, or the token is invalid.
    Raises 403 if the caller's tenant_type is not 'management'.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    tenant_id = payload.get("tenant_id")
    user_id = payload.get("sub")
    tenant_type = payload.get("tenant_type", "client")

    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    if tenant_type != "management":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Management tenant access required",
        )

    return UUID(tenant_id), UUID(user_id)
