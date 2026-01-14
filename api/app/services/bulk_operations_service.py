"""Service for bulk operations - manage group-level OTA and command operations."""

from typing import List, Tuple, Optional
from uuid import UUID
from sqlalchemy import and_, select, func
from sqlalchemy.orm import Session
from datetime import datetime

from app.models import BulkOperation, DeviceGroup, GroupDevice, FirmwareVersion
from app.schemas.bulk_operations import (
    BulkOTARequest, BulkCommandRequest, BulkOperationResponse,
    BulkOperationStartResponse, BulkOperationListResponse
)


class BulkOperationsService:
    """Service for bulk operations on device groups."""

    def __init__(self, session: Session, tenant_id: UUID):
        """Initialize service with database session and tenant context."""
        self.session = session
        self.tenant_id = tenant_id

    def start_bulk_ota(
        self,
        group_id: UUID,
        request: BulkOTARequest,
        workflow_id: Optional[str] = None
    ) -> BulkOperationStartResponse:
        """Start bulk OTA update for device group.
        
        Args:
            group_id: Device group ID
            request: Bulk OTA request with firmware_version_id
            workflow_id: Cadence workflow ID (set after workflow submission)
            
        Returns:
            Operation start response with operation_id and workflow_id
            
        Raises:
            ValueError: If group or firmware version not found
        """
        # Verify group exists and belongs to tenant
        group = self.session.execute(
            select(DeviceGroup).where(
                and_(
                    DeviceGroup.id == group_id,
                    DeviceGroup.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        if not group:
            raise ValueError("Group not found")
        
        # Verify firmware version exists and belongs to tenant
        firmware = self.session.execute(
            select(FirmwareVersion).where(
                and_(
                    FirmwareVersion.id == request.firmware_version_id,
                    FirmwareVersion.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        if not firmware:
            raise ValueError("Firmware version not found")
        
        # Count devices in group
        devices_count = self.session.execute(
            select(func.count(GroupDevice.id)).where(
                GroupDevice.group_id == group_id
            )
        ).scalar() or 0
        
        if devices_count == 0:
            raise ValueError("Group has no devices")
        
        # Create bulk operation record
        operation = BulkOperation(
            tenant_id=self.tenant_id,
            group_id=group_id,
            operation_type="bulk_ota",
            status="queued",
            cadence_workflow_id=workflow_id,
            devices_total=devices_count,
            metadata={
                "firmware_version_id": str(request.firmware_version_id),
                "firmware_version": firmware.version,
                "firmware_name": firmware.name
            }
        )
        
        self.session.add(operation)
        self.session.commit()
        self.session.refresh(operation)
        
        return BulkOperationStartResponse(
            operation_id=operation.id,
            workflow_id=workflow_id,
            status=operation.status,
            devices_total=devices_count,
            message=f"Bulk OTA operation started for {devices_count} devices"
        )

    def start_bulk_command(
        self,
        group_id: UUID,
        request: BulkCommandRequest,
        workflow_id: Optional[str] = None
    ) -> BulkOperationStartResponse:
        """Start bulk command send for device group.
        
        Args:
            group_id: Device group ID
            request: Bulk command request
            workflow_id: Cadence workflow ID (set after workflow submission)
            
        Returns:
            Operation start response
            
        Raises:
            ValueError: If group not found
        """
        # Verify group exists and belongs to tenant
        group = self.session.execute(
            select(DeviceGroup).where(
                and_(
                    DeviceGroup.id == group_id,
                    DeviceGroup.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        if not group:
            raise ValueError("Group not found")
        
        # Count devices in group
        devices_count = self.session.execute(
            select(func.count(GroupDevice.id)).where(
                GroupDevice.group_id == group_id
            )
        ).scalar() or 0
        
        if devices_count == 0:
            raise ValueError("Group has no devices")
        
        # Create bulk operation record
        operation = BulkOperation(
            tenant_id=self.tenant_id,
            group_id=group_id,
            operation_type="bulk_command",
            status="queued",
            cadence_workflow_id=workflow_id,
            devices_total=devices_count,
            metadata={
                "command": request.command,
                "payload": request.payload or {}
            }
        )
        
        self.session.add(operation)
        self.session.commit()
        self.session.refresh(operation)
        
        return BulkOperationStartResponse(
            operation_id=operation.id,
            workflow_id=workflow_id,
            status=operation.status,
            devices_total=devices_count,
            message=f"Bulk command '{request.command}' queued for {devices_count} devices"
        )

    def get_operation(self, operation_id: UUID) -> Optional[BulkOperationResponse]:
        """Get bulk operation details.
        
        Args:
            operation_id: Operation ID
            
        Returns:
            Operation response or None if not found
        """
        operation = self.session.execute(
            select(BulkOperation).where(
                and_(
                    BulkOperation.id == operation_id,
                    BulkOperation.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        return self._to_response(operation) if operation else None

    def list_operations(
        self,
        group_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[BulkOperationResponse], int]:
        """List bulk operations with optional group filter.
        
        Args:
            group_id: Filter by group ID (optional)
            skip: Number to skip
            limit: Maximum to return
            
        Returns:
            Tuple of (operations list, total count)
        """
        # Build query
        query = select(BulkOperation).where(
            BulkOperation.tenant_id == self.tenant_id
        )
        
        if group_id:
            query = query.where(BulkOperation.group_id == group_id)
        
        # Get total count
        count_query = select(func.count(BulkOperation.id)).where(
            BulkOperation.tenant_id == self.tenant_id
        )
        if group_id:
            count_query = count_query.where(BulkOperation.group_id == group_id)
        
        total = self.session.execute(count_query).scalar() or 0
        
        # Get paginated results
        operations = self.session.execute(
            query.order_by(BulkOperation.created_at.desc()).offset(skip).limit(limit)
        ).scalars().all()
        
        responses = [self._to_response(op) for op in operations]
        
        return responses, total

    def update_operation_status(
        self,
        operation_id: UUID,
        status: str,
        progress_percent: int = None,
        devices_completed: int = None,
        devices_failed: int = None,
        error_message: str = None
    ) -> Optional[BulkOperationResponse]:
        """Update bulk operation status (called by Cadence workflows).
        
        Args:
            operation_id: Operation ID
            status: New status
            progress_percent: Progress percentage
            devices_completed: Number of completed devices
            devices_failed: Number of failed devices
            error_message: Error message if any
            
        Returns:
            Updated operation response or None if not found
        """
        operation = self.session.execute(
            select(BulkOperation).where(
                and_(
                    BulkOperation.id == operation_id,
                    BulkOperation.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        if not operation:
            return None
        
        # Update fields
        operation.status = status
        if progress_percent is not None:
            operation.progress_percent = progress_percent
        if devices_completed is not None:
            operation.devices_completed = devices_completed
        if devices_failed is not None:
            operation.devices_failed = devices_failed
        if error_message is not None:
            operation.error_message = error_message
        
        # Set timestamps
        if status == "running" and not operation.started_at:
            operation.started_at = datetime.utcnow()
        elif status in ("completed", "failed") and not operation.completed_at:
            operation.completed_at = datetime.utcnow()
        
        operation.updated_at = datetime.utcnow()
        
        self.session.commit()
        self.session.refresh(operation)
        
        return self._to_response(operation)

    def get_group_devices_for_bulk_op(self, group_id: UUID) -> List[UUID]:
        """Get all device IDs in a group for bulk operation.
        
        Args:
            group_id: Group ID
            
        Returns:
            List of device UUIDs
        """
        from app.models import Device
        
        devices = self.session.execute(
            select(Device.id).join(
                GroupDevice, Device.id == GroupDevice.device_id
            ).where(
                and_(
                    GroupDevice.group_id == group_id,
                    Device.tenant_id == self.tenant_id
                )
            )
        ).scalars().all()
        
        return list(devices)

    @staticmethod
    def _to_response(operation: BulkOperation) -> BulkOperationResponse:
        """Convert ORM model to response schema."""
        return BulkOperationResponse(
            id=operation.id,
            operation_type=operation.operation_type,
            status=operation.status,
            cadence_workflow_id=operation.cadence_workflow_id,
            devices_total=operation.devices_total,
            devices_completed=operation.devices_completed,
            devices_failed=operation.devices_failed,
            progress_percent=operation.progress_percent,
            error_message=operation.error_message,
            metadata=operation.metadata,
            started_at=operation.started_at,
            completed_at=operation.completed_at,
            created_at=operation.created_at,
            updated_at=operation.updated_at
        )
