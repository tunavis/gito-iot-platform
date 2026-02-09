"""add_multi_protocol_support

Revision ID: d30e253293e6
Revises: fc1c13362cbc
Create Date: 2026-02-06 16:54:38.118844

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd30e253293e6'
down_revision: Union[str, None] = 'fc1c13362cbc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add device_types table and multi-protocol support."""

    # Create device_types table (was missing from initial schema)
    op.execute("""
        CREATE TABLE IF NOT EXISTS device_types (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            manufacturer VARCHAR(100),
            model VARCHAR(100),
            category VARCHAR(50) DEFAULT 'other',
            icon VARCHAR(50) DEFAULT 'cpu',
            color VARCHAR(20) DEFAULT '#6366f1',
            data_model JSONB DEFAULT '[]'::jsonb,
            capabilities JSONB DEFAULT '[]'::jsonb,
            default_settings JSONB DEFAULT '{}'::jsonb,
            connectivity JSONB DEFAULT '{}'::jsonb,
            metadata JSONB DEFAULT '{}'::jsonb,
            is_active BOOLEAN DEFAULT true,
            device_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            CONSTRAINT device_types_name_tenant_unique UNIQUE (tenant_id, name)
        );

        CREATE INDEX IF NOT EXISTS idx_device_types_tenant_id ON device_types(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_device_types_category ON device_types(category);
        CREATE INDEX IF NOT EXISTS idx_device_types_is_active ON device_types(is_active);
    """)

    # Add index on connectivity->protocol for faster protocol-based queries
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_device_types_protocol
        ON device_types ((connectivity->>'protocol'))
    """)

    # Add CHECK constraint to validate protocol types
    op.execute("""
        ALTER TABLE device_types
        ADD CONSTRAINT valid_protocol_type
        CHECK (
            connectivity->>'protocol' IS NULL OR
            connectivity->>'protocol' IN (
                'mqtt', 'lorawan', 'http', 'modbus', 'opcua',
                'coap', 'websocket', 'custom'
            )
        )
    """)

    # Add table comment documenting protocol structure
    op.execute("""
        COMMENT ON COLUMN device_types.connectivity IS
        'Protocol configuration (JSONB): {
            "protocol": "mqtt"|"lorawan"|"http"|"modbus"|"opcua"|"coap"|"websocket"|"custom",
            "mqtt": {"topic_pattern": "...", "qos": 1, "retain": false},
            "lorawan": {"dev_eui": "...", "app_key": "...", "lorawan_class": "A|B|C"},
            "http": {"webhook_url": "...", "method": "POST", "headers": {}},
            "modbus": {"connection_type": "tcp|rtu", "host": "...", "port": 502, "slave_id": 1},
            "opcua": {"endpoint_url": "...", "security_mode": "...", "auth": {}},
            "coap": {"endpoint": "...", "observe": true},
            "websocket": {"url": "...", "protocols": []},
            "custom": {"parser": "...", "config": {}}
        }'
    """)

    # Update existing NULL connectivity to default MQTT structure
    op.execute("""
        UPDATE device_types
        SET connectivity = '{"protocol": "mqtt", "mqtt": {"topic_pattern": "{{tenant_id}}/devices/{{device_id}}/telemetry", "qos": 1, "retain": false}}'::jsonb
        WHERE connectivity IS NULL OR connectivity = '{}'::jsonb
    """)


def downgrade() -> None:
    """Remove multi-protocol support."""

    # Drop index
    op.execute("DROP INDEX IF EXISTS idx_device_types_protocol")

    # Drop CHECK constraint
    op.execute("ALTER TABLE device_types DROP CONSTRAINT IF EXISTS valid_protocol_type")

    # Remove comment
    op.execute("COMMENT ON COLUMN device_types.connectivity IS NULL")
