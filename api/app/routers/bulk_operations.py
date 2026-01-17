"""Bulk operations API endpoints - manage group-level OTA and command operations."""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_session
from app.middleware.auth import get_current_user
from app.schemas.bulk_operations import (
    BulkOTARequest, BulkCommandRequest, BulkOperationResponse,
    BulkOperationStartResponse, BulkOperationListResponse
)
from app.services.bulk_operations_service import BulkOperationsService
from app.services.ota_workflow import get_ota_workflow_client

router = APIRouter(prefix="/api/v1", tags=["bulk-operations"])


@router.post(
    "/tenants/{tenant_id}/device-groups/{group_id}/bulk-ota",
    response_model=BulkOperationStartResponse,
    summary="Start bulk OTA update",
    responses={
        200: {"description": "Bulk OTA operation started"},
        400: {"description": "Invalid request"},
        403: {"description": "Not authorized"},
        404: {"description": "Group or firmware not found"}
    }
)
async def start_bulk_ota(
    tenant_id: UUID,
    group_id: UUID,
    request: BulkOTARequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start bulk firmware OTA update for all devices in group.
    
    Creates a bulk operation and submits it to Cadence for parallel processing.
    Each device receives its own OTA workflow that monitors progress independently.
    """
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = BulkOperationsService(db, tenant_id)
        
        # Create bulk operation record first to get operation_id
        result = service.start_bulk_ota(group_id, request, workflow_id=None)
        operation_id = result.operation_id
        
        # Get workflow client (may fail gracefully if Cadence unavailable)
        try:
            workflow_client = get_ota_workflow_client()
            if workflow_client and workflow_client.client:  # Check if connected
                device_ids = service.get_group_devices_for_bulk_op(group_id)
                
                # Submit Cadence workflow for bulk OTA
                # Workflow will iterate devices and call individual OTA_UPDATE_DEVICE workflows
                workflow_id = await workflow_client.start_ota_bulk_workflow(
                    tenant_id=tenant_id,
                    group_id=group_id,
                    operation_id=operation_id,
                    firmware_version_id=request.firmware_version_id,
                    device_ids=device_ids,
                )
                
                # Update operation with workflow ID
                if workflow_id:
                    service.update_operation_status(
                        operation_id=operation_id,
                        status="queued",
                    )
        except Exception as e:
            # If Cadence unavailable, operation still created but without workflow
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"bulk_ota_workflow_submission_failed: {e}")
        
        return result
    
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start bulk OTA: {str(e)}")


@router.post(
    "/tenants/{tenant_id}/device-groups/{group_id}/bulk-command",
    response_model=BulkOperationStartResponse,
    summary="Send bulk command",
    responses={
        200: {"description": "Bulk command operation started"},
        400: {"description": "Invalid request"},
        403: {"description": "Not authorized"},
        404: {"description": "Group not found"}
    }
)
async def start_bulk_command(
    tenant_id: UUID,
    group_id: UUID,
    request: BulkCommandRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send command to all devices in group.
    
    Creates a bulk operation and submits it to Cadence for parallel execution.
    Commands are sent via MQTT with QoS 1 (at-least-once delivery).
    """
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = BulkOperationsService(db, tenant_id)
        
        # Create bulk operation record first to get operation_id
        result = service.start_bulk_command(group_id, request, workflow_id=None)
        operation_id = result.operation_id
        
        # Get workflow client (may fail gracefully if Cadence unavailable)
        try:
            workflow_client = get_ota_workflow_client()
            if workflow_client and workflow_client.client:  # Check if connected
                device_ids = service.get_group_devices_for_bulk_op(group_id)
                
                # Submit Cadence workflow for bulk command
                workflow_id = await workflow_client.start_bulk_command_workflow(
                    tenant_id=tenant_id,
                    group_id=group_id,
                    operation_id=operation_id,
                    command=request.command,
                    payload=request.payload or {},
                    device_ids=device_ids,
                )
                
                # Update operation with workflow ID
                if workflow_id:
                    service.update_operation_status(
                        operation_id=operation_id,
                        status="queued",
                    )
        except Exception as e:
            # If Cadence unavailable, operation still created but without workflow
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"bulk_command_workflow_submission_failed: {e}")
        
        return result
    
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start bulk command: {str(e)}")


@router.get(
    "/tenants/{tenant_id}/bulk-operations/{operation_id}",
    response_model=BulkOperationResponse,
    summary="Get bulk operation details",
    responses={
        200: {"description": "Operation details"},
        403: {"description": "Not authorized"},
        404: {"description": "Operation not found"}
    }
)
async def get_bulk_operation(
    tenant_id: UUID,
    operation_id: UUID,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get details and status of a bulk operation."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = BulkOperationsService(db, tenant_id)
        operation = service.get_operation(operation_id)
        
        if not operation:
            raise HTTPException(status_code=404, detail="Operation not found")
        
        return operation
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get operation: {str(e)}")


@router.get(
    "/tenants/{tenant_id}/device-groups/{group_id}/bulk-operations",
    response_model=dict,
    summary="List bulk operations for group",
    responses={
        200: {"description": "List of operations"},
        403: {"description": "Not authorized"}
    }
)
async def list_group_bulk_operations(
    tenant_id: UUID,
    group_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all bulk operations for a device group."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = BulkOperationsService(db, tenant_id)
        operations, total = service.list_operations(group_id=group_id, skip=skip, limit=limit)
        
        return {
            "data": operations,
            "meta": {
                "skip": skip,
                "limit": limit,
                "total": total
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list operations: {str(e)}")


@router.get(
    "/tenants/{tenant_id}/bulk-operations",
    response_model=dict,
    summary="List all bulk operations",
    responses={
        200: {"description": "List of operations"},
        403: {"description": "Not authorized"}
    }
)
async def list_bulk_operations(
    tenant_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    status: str = Query(None, description="Filter by status (queued, running, completed, failed)"),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all bulk operations for tenant with optional status filter."""
    # Verify tenant authorization
    if str(current_user.get("tenant_id")) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    try:
        service = BulkOperationsService(db, tenant_id)
        operations, total = service.list_operations(skip=skip, limit=limit)
        
        # Filter by status if specified
        if status:
            operations = [op for op in operations if op.status == status]
            total = len(operations)
        
        return {
            "data": operations,
            "meta": {
                "skip": skip,
                "limit": limit,
                "total": total,
                "status_filter": status
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list operations: {str(e)}")
