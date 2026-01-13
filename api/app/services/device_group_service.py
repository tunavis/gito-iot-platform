"""Service for device group operations - manage groups and memberships."""

from typing import List, Dict, Optional, Tuple
from uuid import UUID
from sqlalchemy import and_, select, func, delete as sql_delete
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models import DeviceGroup, GroupDevice, Device
from app.schemas.device_group import (
    DeviceGroupCreate, DeviceGroupUpdate, DeviceGroupResponse,
    DeviceGroupDetailResponse, BulkDevicesResponse
)


class DeviceGroupService:
    """Service for device group CRUD and membership operations."""

    def __init__(self, session: Session, tenant_id: UUID):
        """Initialize service with database session and tenant context."""
        self.session = session
        self.tenant_id = tenant_id

    def create_group(self, data: DeviceGroupCreate) -> DeviceGroupResponse:
        """Create a new device group.
        
        Args:
            data: Device group creation data
            
        Returns:
            Created group response
            
        Raises:
            ValueError: If group name already exists for tenant
        """
        # Check if group name already exists
        existing = self.session.execute(
            select(DeviceGroup).where(
                and_(
                    DeviceGroup.tenant_id == self.tenant_id,
                    DeviceGroup.name == data.name
                )
            )
        ).scalar_one_or_none()
        
        if existing:
            raise ValueError(f"Group name '{data.name}' already exists for this tenant")
        
        group = DeviceGroup(
            tenant_id=self.tenant_id,
            name=data.name,
            description=data.description,
            membership_rule=data.membership_rule or {}
        )
        
        self.session.add(group)
        self.session.commit()
        self.session.refresh(group)
        
        return self._to_response(group)

    def get_group(self, group_id: UUID) -> Optional[DeviceGroupResponse]:
        """Get device group by ID.
        
        Args:
            group_id: Group ID
            
        Returns:
            Group response or None if not found
        """
        group = self.session.execute(
            select(DeviceGroup).where(
                and_(
                    DeviceGroup.id == group_id,
                    DeviceGroup.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        return self._to_response(group) if group else None

    def get_group_with_members(self, group_id: UUID) -> Optional[DeviceGroupDetailResponse]:
        """Get device group with all member details.
        
        Args:
            group_id: Group ID
            
        Returns:
            Group with members response or None if not found
        """
        group = self.session.execute(
            select(DeviceGroup).where(
                and_(
                    DeviceGroup.id == group_id,
                    DeviceGroup.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        if not group:
            return None
        
        # Get all member devices
        members = self.session.execute(
            select(Device).join(
                GroupDevice, Device.id == GroupDevice.device_id
            ).where(
                and_(
                    GroupDevice.group_id == group_id,
                    Device.tenant_id == self.tenant_id
                )
            )
        ).scalars().all()
        
        response = self._to_response(group, DeviceGroupDetailResponse)
        response.members = [
            {
                "id": m.id,
                "name": m.name,
                "status": m.status,
                "device_type": m.device_type,
                "last_seen": m.last_seen
            }
            for m in members
        ]
        
        return response

    def list_groups(self, skip: int = 0, limit: int = 100) -> Tuple[List[DeviceGroupResponse], int]:
        """List all device groups for tenant.
        
        Args:
            skip: Number of groups to skip
            limit: Maximum number of groups to return
            
        Returns:
            Tuple of (groups list, total count)
        """
        # Get total count
        total = self.session.execute(
            select(func.count(DeviceGroup.id)).where(
                DeviceGroup.tenant_id == self.tenant_id
            )
        ).scalar()
        
        # Get paginated groups with member counts
        groups = self.session.execute(
            select(DeviceGroup).where(
                DeviceGroup.tenant_id == self.tenant_id
            ).order_by(DeviceGroup.created_at.desc()).offset(skip).limit(limit)
        ).scalars().all()
        
        # Convert to responses with member counts
        responses = []
        for group in groups:
            response = self._to_response(group)
            # Count members
            member_count = self.session.execute(
                select(func.count(GroupDevice.id)).where(
                    GroupDevice.group_id == group.id
                )
            ).scalar() or 0
            response.member_count = member_count
            responses.append(response)
        
        return responses, total

    def update_group(self, group_id: UUID, data: DeviceGroupUpdate) -> Optional[DeviceGroupResponse]:
        """Update device group.
        
        Args:
            group_id: Group ID
            data: Update data
            
        Returns:
            Updated group response or None if not found
        """
        group = self.session.execute(
            select(DeviceGroup).where(
                and_(
                    DeviceGroup.id == group_id,
                    DeviceGroup.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        if not group:
            return None
        
        # Check if new name conflicts with existing group
        if data.name and data.name != group.name:
            existing = self.session.execute(
                select(DeviceGroup).where(
                    and_(
                        DeviceGroup.tenant_id == self.tenant_id,
                        DeviceGroup.name == data.name,
                        DeviceGroup.id != group_id
                    )
                )
            ).scalar_one_or_none()
            
            if existing:
                raise ValueError(f"Group name '{data.name}' already exists for this tenant")
        
        # Update fields
        if data.name is not None:
            group.name = data.name
        if data.description is not None:
            group.description = data.description
        if data.membership_rule is not None:
            group.membership_rule = data.membership_rule
        
        self.session.commit()
        self.session.refresh(group)
        
        return self._to_response(group)

    def delete_group(self, group_id: UUID) -> bool:
        """Delete device group and all memberships.
        
        Args:
            group_id: Group ID
            
        Returns:
            True if deleted, False if not found
        """
        group = self.session.execute(
            select(DeviceGroup).where(
                and_(
                    DeviceGroup.id == group_id,
                    DeviceGroup.tenant_id == self.tenant_id
                )
            )
        ).scalar_one_or_none()
        
        if not group:
            return False
        
        self.session.delete(group)
        self.session.commit()
        
        return True

    def add_devices_to_group(self, group_id: UUID, device_ids: List[UUID]) -> BulkDevicesResponse:
        """Add devices to group.
        
        Args:
            group_id: Group ID
            device_ids: List of device IDs to add
            
        Returns:
            Response with counts of added/failed/skipped
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
        
        added = 0
        failed = 0
        skipped = 0
        errors = []
        
        for device_id in device_ids:
            try:
                # Check if device exists and belongs to tenant
                device = self.session.execute(
                    select(Device).where(
                        and_(
                            Device.id == device_id,
                            Device.tenant_id == self.tenant_id
                        )
                    )
                ).scalar_one_or_none()
                
                if not device:
                    failed += 1
                    errors.append({
                        "device_id": str(device_id),
                        "reason": "Device not found or does not belong to tenant"
                    })
                    continue
                
                # Check if already in group
                existing = self.session.execute(
                    select(GroupDevice).where(
                        and_(
                            GroupDevice.group_id == group_id,
                            GroupDevice.device_id == device_id
                        )
                    )
                ).scalar_one_or_none()
                
                if existing:
                    skipped += 1
                    continue
                
                # Add to group
                membership = GroupDevice(
                    group_id=group_id,
                    device_id=device_id
                )
                self.session.add(membership)
                added += 1
                
            except Exception as e:
                failed += 1
                errors.append({
                    "device_id": str(device_id),
                    "reason": str(e)
                })
        
        self.session.commit()
        
        return BulkDevicesResponse(
            added=added,
            failed=failed,
            skipped=skipped,
            errors=errors if errors else None
        )

    def remove_devices_from_group(self, group_id: UUID, device_ids: List[UUID]) -> BulkDevicesResponse:
        """Remove devices from group.
        
        Args:
            group_id: Group ID
            device_ids: List of device IDs to remove
            
        Returns:
            Response with counts of removed/failed
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
        
        added = 0  # Will store count of removed items
        failed = 0
        errors = []
        
        for device_id in device_ids:
            try:
                # Delete membership
                result = self.session.execute(
                    sql_delete(GroupDevice).where(
                        and_(
                            GroupDevice.group_id == group_id,
                            GroupDevice.device_id == device_id
                        )
                    )
                )
                
                if result.rowcount > 0:
                    added += 1
                
            except Exception as e:
                failed += 1
                errors.append({
                    "device_id": str(device_id),
                    "reason": str(e)
                })
        
        self.session.commit()
        
        return BulkDevicesResponse(
            added=added,  # Reuse field for removed count
            failed=failed,
            skipped=0,
            errors=errors if errors else None
        )

    def get_group_members(self, group_id: UUID, skip: int = 0, limit: int = 100) -> Tuple[List[Dict], int]:
        """Get all members of a group with pagination.
        
        Args:
            group_id: Group ID
            skip: Number of members to skip
            limit: Maximum number of members to return
            
        Returns:
            Tuple of (members list, total count)
        """
        # Verify group exists
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
        
        # Get total count
        total = self.session.execute(
            select(func.count(GroupDevice.id)).where(
                GroupDevice.group_id == group_id
            )
        ).scalar() or 0
        
        # Get members with pagination
        members = self.session.execute(
            select(Device).join(
                GroupDevice, Device.id == GroupDevice.device_id
            ).where(
                and_(
                    GroupDevice.group_id == group_id,
                    Device.tenant_id == self.tenant_id
                )
            ).order_by(Device.created_at.desc()).offset(skip).limit(limit)
        ).scalars().all()
        
        member_dicts = [
            {
                "id": m.id,
                "name": m.name,
                "status": m.status,
                "device_type": m.device_type,
                "last_seen": m.last_seen
            }
            for m in members
        ]
        
        return member_dicts, total

    @staticmethod
    def _to_response(group: DeviceGroup, response_class=DeviceGroupResponse) -> DeviceGroupResponse:
        """Convert ORM model to response schema."""
        return response_class(
            id=group.id,
            name=group.name,
            description=group.description,
            membership_rule=group.membership_rule,
            member_count=0,  # Will be populated separately if needed
            created_at=group.created_at,
            updated_at=group.updated_at
        )
