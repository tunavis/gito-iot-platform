"""add_device_type_foreign_key_relationship

Revision ID: d0ee0e8c590a
Revises: d30e253293e6
Create Date: 2026-02-06 15:55:03.247349

This migration adds proper foreign key relationship between devices and device_types.

Changes:
1. Add device_type_id UUID column to devices (foreign key to device_types.id)
2. Migrate existing devices to link to proper device types
3. Add database triggers to auto-update device_count
4. Make device_type string nullable (deprecated, kept for backward compatibility)
5. Add indexes for performance

Benefits:
- Enforces referential integrity (can't delete device type if devices exist)
- Auto-updates device_count via triggers
- Enables efficient JOIN queries
- Follows industry standard IoT platform architecture
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd0ee0e8c590a'
down_revision: Union[str, None] = 'd30e253293e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add device_type_id foreign key and migrate existing data."""

    # Step 1: Add device_type_id column (nullable initially for data migration)
    op.execute("""
        ALTER TABLE devices
        ADD COLUMN device_type_id UUID;
    """)

    op.execute("""
        COMMENT ON COLUMN devices.device_type_id IS
        'Foreign key to device_types table. Replaces device_type string for proper referential integrity.';
    """)

    # Step 2: Create default device types for existing device slugs
    # This ensures all existing devices can be migrated
    op.execute("""
        -- Create device types for existing device slugs if they don't exist
        INSERT INTO device_types (tenant_id, name, description, category, icon, color, connectivity, metadata, is_active)
        SELECT DISTINCT
            d.tenant_id,
            -- Convert slug to human-readable name
            CASE d.device_type
                WHEN 'temperature_sensor' THEN 'Temperature Sensor'
                WHEN 'humidity_sensor' THEN 'Humidity Sensor'
                WHEN 'water_flow_sensor' THEN 'Water Flow Sensor'
                WHEN 'energy_meter' THEN 'Energy Meter'
                WHEN 'pressure_sensor' THEN 'Pressure Sensor'
                WHEN 'air_quality_sensor' THEN 'Air Quality Sensor'
                WHEN 'motion_detector' THEN 'Motion Detector'
                WHEN 'door_sensor' THEN 'Door Sensor'
                ELSE INITCAP(REPLACE(d.device_type, '_', ' '))
            END as name,
            'Migrated from legacy device_type slug: ' || d.device_type as description,
            -- Categorize based on slug
            CASE
                WHEN d.device_type LIKE '%sensor%' THEN 'sensor'
                WHEN d.device_type LIKE '%meter%' THEN 'meter'
                WHEN d.device_type LIKE '%gateway%' THEN 'gateway'
                WHEN d.device_type LIKE '%actuator%' THEN 'actuator'
                WHEN d.device_type LIKE '%tracker%' THEN 'tracker'
                ELSE 'other'
            END as category,
            'thermometer' as icon,
            '#10b981' as color,
            -- Default MQTT connectivity
            jsonb_build_object(
                'protocol', 'mqtt',
                'mqtt', jsonb_build_object(
                    'topic_pattern', '{{tenant_id}}/devices/{{device_id}}/telemetry',
                    'qos', 1,
                    'retain', false
                )
            ) as connectivity,
            jsonb_build_object('legacy_slug', d.device_type, 'migrated', true) as metadata,
            true as is_active
        FROM devices d
        WHERE d.device_type IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM device_types dt
              WHERE dt.tenant_id = d.tenant_id
              AND dt.metadata->>'legacy_slug' = d.device_type
          )
        GROUP BY d.tenant_id, d.device_type
        ON CONFLICT DO NOTHING;
    """)

    # Step 3: Migrate existing devices to use device_type_id
    op.execute("""
        -- Link devices to their device types via the legacy slug
        UPDATE devices d
        SET device_type_id = dt.id
        FROM device_types dt
        WHERE dt.tenant_id = d.tenant_id
          AND dt.metadata->>'legacy_slug' = d.device_type
          AND d.device_type_id IS NULL;
    """)

    # Step 4: Handle any devices that couldn't be migrated (create default type)
    op.execute("""
        -- For any remaining unmigrated devices, create a generic device type
        INSERT INTO device_types (tenant_id, name, description, category, icon, color, connectivity, metadata, is_active)
        SELECT DISTINCT
            d.tenant_id,
            'Unknown Device Type' as name,
            'Generic device type for unmigrated devices' as description,
            'other' as category,
            'cpu' as icon,
            '#6366f1' as color,
            jsonb_build_object(
                'protocol', 'mqtt',
                'mqtt', jsonb_build_object(
                    'topic_pattern', '{{tenant_id}}/devices/{{device_id}}/telemetry',
                    'qos', 1,
                    'retain', false
                )
            ) as connectivity,
            jsonb_build_object('default_fallback', true) as metadata,
            true as is_active
        FROM devices d
        WHERE d.device_type_id IS NULL
        ON CONFLICT DO NOTHING;

        -- Link remaining devices to the generic type
        UPDATE devices d
        SET device_type_id = dt.id
        FROM device_types dt
        WHERE dt.tenant_id = d.tenant_id
          AND dt.metadata->>'default_fallback' = 'true'
          AND d.device_type_id IS NULL;
    """)

    # Step 5: Add NOT NULL constraint after migration
    op.execute("""
        ALTER TABLE devices
        ALTER COLUMN device_type_id SET NOT NULL;
    """)

    # Step 6: Add foreign key constraint
    op.execute("""
        ALTER TABLE devices
        ADD CONSTRAINT fk_devices_device_type_id
        FOREIGN KEY (device_type_id)
        REFERENCES device_types(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
    """)

    op.execute("""
        COMMENT ON CONSTRAINT fk_devices_device_type_id ON devices IS
        'Enforces referential integrity. Cannot delete device type if devices exist. Use ON DELETE RESTRICT for data safety.';
    """)

    # Step 7: Create index for foreign key (performance)
    op.execute("""
        CREATE INDEX idx_devices_device_type_id ON devices(device_type_id);
    """)

    # Step 8: Make device_type string nullable (deprecated but kept for compatibility)
    op.execute("""
        ALTER TABLE devices
        ALTER COLUMN device_type DROP NOT NULL;
    """)

    op.execute("""
        COMMENT ON COLUMN devices.device_type IS
        'DEPRECATED: Legacy string-based device type. Use device_type_id instead. Kept for backward compatibility during transition period.';
    """)

    # Step 9: Initialize device_count for all device types
    op.execute("""
        -- Update device_count to reflect actual counts
        UPDATE device_types dt
        SET device_count = (
            SELECT COUNT(*)
            FROM devices d
            WHERE d.device_type_id = dt.id
        );
    """)

    # Step 10: Create trigger function to auto-update device_count
    op.execute("""
        CREATE OR REPLACE FUNCTION update_device_type_count()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Handle INSERT
            IF (TG_OP = 'INSERT') THEN
                UPDATE device_types
                SET device_count = device_count + 1
                WHERE id = NEW.device_type_id;
                RETURN NEW;
            END IF;

            -- Handle DELETE
            IF (TG_OP = 'DELETE') THEN
                UPDATE device_types
                SET device_count = device_count - 1
                WHERE id = OLD.device_type_id;
                RETURN OLD;
            END IF;

            -- Handle UPDATE (device moved to different type)
            IF (TG_OP = 'UPDATE') THEN
                IF OLD.device_type_id IS DISTINCT FROM NEW.device_type_id THEN
                    -- Decrement old device type
                    UPDATE device_types
                    SET device_count = device_count - 1
                    WHERE id = OLD.device_type_id;

                    -- Increment new device type
                    UPDATE device_types
                    SET device_count = device_count + 1
                    WHERE id = NEW.device_type_id;
                END IF;
                RETURN NEW;
            END IF;

            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        COMMENT ON FUNCTION update_device_type_count() IS
        'Automatically maintains device_count on device_types table. Triggered on INSERT, UPDATE, DELETE of devices.';
    """)

    # Step 11: Create triggers on devices table
    op.execute("""
        CREATE TRIGGER trigger_device_type_count_insert
        AFTER INSERT ON devices
        FOR EACH ROW
        EXECUTE FUNCTION update_device_type_count();
    """)

    op.execute("""
        CREATE TRIGGER trigger_device_type_count_update
        AFTER UPDATE OF device_type_id ON devices
        FOR EACH ROW
        EXECUTE FUNCTION update_device_type_count();
    """)

    op.execute("""
        CREATE TRIGGER trigger_device_type_count_delete
        AFTER DELETE ON devices
        FOR EACH ROW
        EXECUTE FUNCTION update_device_type_count();
    """)

    # Step 12: Add composite index for tenant + device_type queries
    op.execute("""
        CREATE INDEX idx_devices_tenant_device_type ON devices(tenant_id, device_type_id);
    """)

    op.execute("""
        COMMENT ON INDEX idx_devices_tenant_device_type IS
        'Performance optimization for queries filtering by tenant and device type.';
    """)


def downgrade() -> None:
    """Rollback changes - restore original schema."""

    # Drop triggers
    op.execute("DROP TRIGGER IF EXISTS trigger_device_type_count_insert ON devices;")
    op.execute("DROP TRIGGER IF EXISTS trigger_device_type_count_update ON devices;")
    op.execute("DROP TRIGGER IF EXISTS trigger_device_type_count_delete ON devices;")

    # Drop trigger function
    op.execute("DROP FUNCTION IF EXISTS update_device_type_count();")

    # Drop indexes
    op.execute("DROP INDEX IF EXISTS idx_devices_tenant_device_type;")
    op.execute("DROP INDEX IF EXISTS idx_devices_device_type_id;")

    # Restore device_type from device_type_id (best effort)
    op.execute("""
        UPDATE devices d
        SET device_type = LOWER(REPLACE(dt.name, ' ', '_'))
        FROM device_types dt
        WHERE d.device_type_id = dt.id
          AND d.device_type IS NULL;
    """)

    # Make device_type NOT NULL again
    op.execute("""
        ALTER TABLE devices
        ALTER COLUMN device_type SET NOT NULL;
    """)

    # Drop foreign key constraint
    op.execute("ALTER TABLE devices DROP CONSTRAINT IF EXISTS fk_devices_device_type_id;")

    # Drop device_type_id column
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS device_type_id;")

    # Reset device_count to 0
    op.execute("UPDATE device_types SET device_count = 0;")

    # Note: We don't delete the migrated device_types as they may have been manually edited
    # Users can manually clean up if needed
