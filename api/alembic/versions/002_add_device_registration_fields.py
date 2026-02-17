"""Add device registration fields: device_type_id, description, serial_number, tags

Revision ID: 002_device_fields
Revises: 001_initial
Create Date: 2026-02-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '002_device_fields'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add device_type_id FK, description, serial_number, and tags to devices table."""
    # Add device_type_id column (FK to device_types)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'device_type_id'
            ) THEN
                ALTER TABLE devices ADD COLUMN device_type_id UUID REFERENCES device_types(id) ON DELETE SET NULL;
                CREATE INDEX IF NOT EXISTS idx_devices_device_type_id ON devices(device_type_id);
            END IF;
        END $$;
    """)

    # Add description column
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'description'
            ) THEN
                ALTER TABLE devices ADD COLUMN description TEXT;
            END IF;
        END $$;
    """)

    # Add serial_number column
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'serial_number'
            ) THEN
                ALTER TABLE devices ADD COLUMN serial_number VARCHAR(255);
            END IF;
        END $$;
    """)

    # Add tags column (JSONB array)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'devices' AND column_name = 'tags'
            ) THEN
                ALTER TABLE devices ADD COLUMN tags JSONB DEFAULT '[]';
            END IF;
        END $$;
    """)

    # Create or replace the sync trigger for device_type from device_types.name
    op.execute("""
        CREATE OR REPLACE FUNCTION sync_device_type()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.device_type_id IS NOT NULL THEN
                SELECT name INTO NEW.device_type
                FROM device_types WHERE id = NEW.device_type_id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        DROP TRIGGER IF EXISTS trigger_sync_device_type ON devices;
        CREATE TRIGGER trigger_sync_device_type
            BEFORE INSERT OR UPDATE OF device_type_id ON devices
            FOR EACH ROW EXECUTE FUNCTION sync_device_type();
    """)

    # Backfill: sync device_type for existing devices that have device_type_id set
    op.execute("""
        UPDATE devices d SET device_type = dt.name
        FROM device_types dt
        WHERE d.device_type_id = dt.id
        AND d.device_type_id IS NOT NULL;
    """)


def downgrade() -> None:
    """Remove device registration fields."""
    op.execute("DROP TRIGGER IF EXISTS trigger_sync_device_type ON devices;")
    op.execute("DROP FUNCTION IF EXISTS sync_device_type();")
    op.execute("DROP INDEX IF EXISTS idx_devices_device_type_id;")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS device_type_id;")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS description;")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS serial_number;")
    op.execute("ALTER TABLE devices DROP COLUMN IF EXISTS tags;")
