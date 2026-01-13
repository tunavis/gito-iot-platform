"""Device group API endpoints - manage logical device groupings for bulk operations."""

from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.schemas.device_group import (
    DeviceGroupCreate, DeviceGroupUpdate, DeviceGroupResponse,
    DeviceGroupDetailResponse, BulkDevicesRequest, BulkDevicesResponse
)
from app.services.device_group_service import DeviceGroupService

router = APIRouter(prefix="/api/v1", tags=["device-groups"])


@router.post(
    "/tenants/{tenant_id}/device-groups",
    response_model=DeviceGroupResponse,
    summary="Create device group",
    responses={
        201: {"description": "Group created successfully"},
        400: {"description": "Invalid group data"},
        403: {"description": "Not authorized to create group"},
        409: {"description": "Group name already exists"}
    }
)
async def create_device_group(
    tenant_id: UUID,
    group_data: DeviceGroupCreate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new device group.
    
    Device groups allow organizing devices for bulk operations like firmware updates.
    """
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        group = service.create_group(group_data)
        return group
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create group: {str(e)}")


@router.get(
    "/tenants/{tenant_id}/device-groups",
    response_model=dict,
    summary="List device groups",
    responses={
        200: {"description": "List of groups"},
        403: {"description": "Not authorized"}
    }
)
async def list_device_groups(
    tenant_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all device groups for the tenant with pagination."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        groups, total = service.list_groups(skip=skip, limit=limit)
        
        return {
            "data": groups,
            "meta": {
                "skip": skip,
                "limit": limit,
                "total": total
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list groups: {str(e)}")


@router.get(
    "/tenants/{tenant_id}/device-groups/{group_id}",
    response_model=DeviceGroupDetailResponse,
    summary="Get device group",
    responses={
        200: {"description": "Group details with members"},
        403: {"description": "Not authorized"},
        404: {"description": "Group not found"}
    }
)
async def get_device_group(
    tenant_id: UUID,
    group_id: UUID,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get device group with all member details."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        group = service.get_group_with_members(group_id)
        
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        return group
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get group: {str(e)}")


@router.patch(
    "/tenants/{tenant_id}/device-groups/{group_id}",
    response_model=DeviceGroupResponse,
    summary="Update device group",
    responses={
        200: {"description": "Group updated"},
        400: {"description": "Invalid update data"},
        403: {"description": "Not authorized"},
        404: {"description": "Group not found"},
        409: {"description": "Group name already exists"}
    }
)
async def update_device_group(
    tenant_id: UUID,
    group_id: UUID,
    group_data: DeviceGroupUpdate,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update device group details."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        group = service.update_group(group_id, group_data)
        
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        return group
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update group: {str(e)}")


@router.delete(
    "/tenants/{tenant_id}/device-groups/{group_id}",
    summary="Delete device group",
    responses={
        204: {"description": "Group deleted"},
        403: {"description": "Not authorized"},
        404: {"description": "Group not found"}
    }
)
async def delete_device_group(
    tenant_id: UUID,
    group_id: UUID,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete device group and all memberships."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        deleted = service.delete_group(group_id)
        
        if not deleted:
            raise HTTPException(status_code=404, detail="Group not found")
        
        return {"message": "Group deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete group: {str(e)}")


@router.get(
    "/tenants/{tenant_id}/device-groups/{group_id}/members",
    response_model=dict,
    summary="List group members",
    responses={
        200: {"description": "List of group members"},
        403: {"description": "Not authorized"},
        404: {"description": "Group not found"}
    }
)
async def get_group_members(
    tenant_id: UUID,
    group_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all devices in group with pagination."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        members, total = service.get_group_members(group_id, skip=skip, limit=limit)
        
        return {
            "data": members,
            "meta": {
                "skip": skip,
                "limit": limit,
                "total": total
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get members: {str(e)}")


@router.post(
    "/tenants/{tenant_id}/device-groups/{group_id}/members/add",
    response_model=BulkDevicesResponse,
    summary="Add devices to group",
    responses={
        200: {"description": "Devices added/processed"},
        400: {"description": "Invalid device IDs"},
        403: {"description": "Not authorized"},
        404: {"description": "Group not found"}
    }
)
async def add_devices_to_group(
    tenant_id: UUID,
    group_id: UUID,
    request: BulkDevicesRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add one or more devices to a group."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        result = service.add_devices_to_group(group_id, request.device_ids)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add devices: {str(e)}")


@router.post(
    "/tenants/{tenant_id}/device-groups/{group_id}/members/remove",
    response_model=BulkDevicesResponse,
    summary="Remove devices from group",
    responses={
        200: {"description": "Devices removed/processed"},
        400: {"description": "Invalid device IDs"},
        403: {"description": "Not authorized"},
        404: {"description": "Group not found"}
    }
)
async def remove_devices_from_group(
    tenant_id: UUID,
    group_id: UUID,
    request: BulkDevicesRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove one or more devices from a group."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = DeviceGroupService(db, tenant_id)
        result = service.remove_devices_from_group(group_id, request.device_ids)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove devices: {str(e)}")
