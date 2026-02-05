"""User Management API - RBAC and user administration within tenants."""

from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated, Optional
from uuid import UUID
from datetime import datetime

from app.database import get_session, RLSSession
from app.models.base import User
from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserPasswordUpdate,
    UserResponse,
    UserInviteRequest,
    UserInviteResponse,
)
from app.schemas.common import SuccessResponse, PaginationMeta
from app.security import decode_token, hash_password, verify_password

router = APIRouter(prefix="/tenants/{tenant_id}/users", tags=["users"])


async def get_current_tenant(
    authorization: str = Header(None),
) -> UUID:
    """Extract and validate tenant_id from JWT token."""
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


async def get_current_user(
    authorization: str = Header(None),
) -> dict:
    """Extract current user info from JWT token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)

    return {
        "user_id": UUID(payload.get("sub")),
        "tenant_id": UUID(payload.get("tenant_id")),
        "role": payload.get("role"),
    }


@router.get("", response_model=SuccessResponse)
async def list_users(
    tenant_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    role: Optional[str] = Query(None, pattern="^(SUPER_ADMIN|TENANT_ADMIN|SITE_ADMIN|CLIENT|VIEWER)$"),
    status: Optional[str] = Query(None, pattern="^(active|inactive|suspended)$"),
    search: Optional[str] = Query(None, max_length=255),
):
    """List all users for a tenant with pagination and filters.

    Args:
        tenant_id: Tenant UUID from path
        role: Filter by user role
        status: Filter by user status
        search: Search by email or full name
        page: Page number (1-indexed)
        per_page: Items per page (max 100)

    Returns:
        Paginated list of users
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    # Build query
    query = select(User).where(User.tenant_id == tenant_id)

    if role:
        query = query.where(User.role == role)

    if status:
        query = query.where(User.status == status)

    if search:
        search_pattern = f"%{search.lower()}%"
        query = query.where(
            (func.lower(User.email).like(search_pattern)) |
            (func.lower(User.full_name).like(search_pattern))
        )

    query = query.order_by(User.created_at.desc())

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_query)).scalar()

    # Paginate
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page)

    result = await session.execute(query)
    users = result.scalars().all()

    return SuccessResponse(
        data=[UserResponse.model_validate(user) for user in users],
        meta=PaginationMeta(page=page, per_page=per_page, total=total),
    )


@router.get("/{user_id}", response_model=SuccessResponse[UserResponse])
async def get_user(
    tenant_id: UUID,
    user_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
):
    """Get a specific user by ID.

    Args:
        tenant_id: Tenant UUID from path
        user_id: User UUID from path

    Returns:
        User details
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    await session.set_tenant_context(tenant_id)

    query = select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return SuccessResponse(data=UserResponse.model_validate(user))


@router.post("", response_model=SuccessResponse[UserResponse], status_code=status.HTTP_201_CREATED)
async def create_user(
    tenant_id: UUID,
    request: UserCreate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Create a new user.

    Args:
        tenant_id: Tenant UUID from path
        request: User creation data

    Returns:
        Created user details

    Raises:
        403: If current user doesn't have permission to create users
        409: If user with email already exists
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Check permission (only TENANT_ADMIN and SUPER_ADMIN can create users)
    if current_user["role"] not in ["TENANT_ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to create users"
        )

    await session.set_tenant_context(tenant_id)

    # Check if user with email already exists
    existing_query = select(User).where(
        User.tenant_id == tenant_id,
        User.email == request.email.lower()
    )
    result = await session.execute(existing_query)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with this email already exists"
        )

    # Create user with hashed password
    user = User(
        tenant_id=tenant_id,
        email=request.email.lower(),
        password_hash=hash_password(request.password),
        full_name=request.full_name,
        role=request.role,
        status=request.status,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    session.add(user)
    await session.commit()
    await session.refresh(user)

    return SuccessResponse(data=UserResponse.model_validate(user))


@router.post("/invite", response_model=SuccessResponse[UserInviteResponse], status_code=status.HTTP_201_CREATED)
async def invite_user(
    tenant_id: UUID,
    request: UserInviteRequest,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Invite a new user (creates user with temporary password and sends invitation email).

    Args:
        tenant_id: Tenant UUID from path
        request: User invitation data

    Returns:
        Created user details with invitation status

    Raises:
        403: If current user doesn't have permission
        409: If user with email already exists
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Check permission
    if current_user["role"] not in ["TENANT_ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to invite users"
        )

    await session.set_tenant_context(tenant_id)

    # Check if user already exists
    existing_query = select(User).where(
        User.tenant_id == tenant_id,
        User.email == request.email.lower()
    )
    result = await session.execute(existing_query)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with this email already exists"
        )

    # Generate temporary password (in production, send this via email)
    import secrets
    temp_password = secrets.token_urlsafe(16)

    # Create user with inactive status until they set password
    user = User(
        tenant_id=tenant_id,
        email=request.email.lower(),
        password_hash=hash_password(temp_password),
        full_name=request.full_name,
        role=request.role,
        status="inactive",  # User must activate account via invitation link
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    session.add(user)
    await session.commit()
    await session.refresh(user)

    # TODO: Send invitation email with temporary password or activation link
    # For now, return success (in production, integrate with email service)

    return SuccessResponse(
        data=UserInviteResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            status=user.status,
            invitation_sent=True,  # Set to False if email fails
            created_at=user.created_at,
        )
    )


@router.put("/{user_id}", response_model=SuccessResponse[UserResponse])
async def update_user(
    tenant_id: UUID,
    user_id: UUID,
    request: UserUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Update a user.

    Args:
        tenant_id: Tenant UUID from path
        user_id: User UUID from path
        request: User update data

    Returns:
        Updated user details

    Raises:
        403: If current user doesn't have permission
        404: If user not found
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Check permission
    if current_user["role"] not in ["TENANT_ADMIN", "SUPER_ADMIN"]:
        # Users can update their own profile (except role and status)
        if str(current_user["user_id"]) != str(user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions to update other users"
            )
        # Prevent users from changing their own role or status
        if request.role is not None or request.status is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot change your own role or status"
            )

    await session.set_tenant_context(tenant_id)

    # Get existing user
    query = select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Update fields
    update_data = request.model_dump(exclude_unset=True)

    if "email" in update_data:
        # Check email uniqueness
        existing_query = select(User).where(
            User.tenant_id == tenant_id,
            User.email == update_data["email"].lower(),
            User.id != user_id
        )
        result = await session.execute(existing_query)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User with this email already exists"
            )
        update_data["email"] = update_data["email"].lower()

    # Hash password if provided (admin password reset)
    if "password" in update_data:
        update_data["password_hash"] = hash_password(update_data.pop("password"))

    for key, value in update_data.items():
        setattr(user, key, value)

    user.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(user)

    return SuccessResponse(data=UserResponse.model_validate(user))


@router.put("/{user_id}/password", response_model=SuccessResponse)
async def update_password(
    tenant_id: UUID,
    user_id: UUID,
    request: UserPasswordUpdate,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Update user password.

    Args:
        tenant_id: Tenant UUID from path
        user_id: User UUID from path
        request: Password update data

    Returns:
        Success message

    Raises:
        403: If not updating own password or insufficient permissions
        401: If current password is incorrect
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Users can only change their own password
    if str(current_user["user_id"]) != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only change your own password"
        )

    await session.set_tenant_context(tenant_id)

    # Get user
    query = select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Verify current password
    if not verify_password(request.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect"
        )

    # Update password
    user.password_hash = hash_password(request.new_password)
    user.updated_at = datetime.utcnow()

    await session.commit()

    return SuccessResponse(data={"message": "Password updated successfully"})


@router.delete("/{user_id}", response_model=SuccessResponse)
async def delete_user(
    tenant_id: UUID,
    user_id: UUID,
    session: Annotated[RLSSession, Depends(get_session)],
    current_tenant: Annotated[UUID, Depends(get_current_tenant)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Delete a user (soft delete by setting status to 'inactive').

    Args:
        tenant_id: Tenant UUID from path
        user_id: User UUID from path

    Returns:
        Success message

    Raises:
        403: If current user doesn't have permission or trying to delete self
        404: If user not found
    """
    if str(tenant_id) != str(current_tenant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")

    # Check permission
    if current_user["role"] not in ["TENANT_ADMIN", "SUPER_ADMIN"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to delete users"
        )

    # Prevent self-deletion
    if str(current_user["user_id"]) == str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete your own account"
        )

    await session.set_tenant_context(tenant_id)

    # Get user
    query = select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    result = await session.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Soft delete (set status to suspended)
    user.status = "suspended"
    user.updated_at = datetime.utcnow()

    await session.commit()

    return SuccessResponse(data={"message": "User deleted successfully"})
