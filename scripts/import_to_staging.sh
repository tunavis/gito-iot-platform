#!/bin/bash
# ============================================================================
# Import local development data to staging
# Usage: ./scripts/import_to_staging.sh
# ============================================================================

set -e  # Exit on error

echo "🚀 Starting data import to staging..."
echo ""

# Check if staging_data_export.sql exists
if [ ! -f "staging_data_export.sql" ]; then
    echo "❌ Error: staging_data_export.sql not found!"
    echo "Run this first: docker exec gito-postgres pg_dump -U gito -d gito --data-only --inserts ..."
    exit 1
fi

# Variables
STAGING_HOST="${STAGING_HOST:-192.168.0.9}"
STAGING_USER="${STAGING_USER:-mark}"
EXPORT_FILE="staging_data_complete.sql"

echo "📦 Copying export file to staging ($STAGING_HOST)..."
scp "$EXPORT_FILE" "$STAGING_USER@$STAGING_HOST:/tmp/"

echo ""
echo "📥 Importing data to staging database..."
ssh "$STAGING_USER@$STAGING_HOST" << 'EOF'
cd /opt/gito-iot
docker exec -i gito-postgres psql -U gito -d gito_iot_staging < /tmp/$EXPORT_FILE

echo ""
echo "✅ Verifying import..."
docker exec gito-postgres psql -U gito -d gito_iot_staging -c "
SELECT 'organizations' as table, COUNT(*) as count FROM organizations
UNION ALL SELECT 'sites', COUNT(*) FROM sites
UNION ALL SELECT 'device_groups', COUNT(*) FROM device_groups
UNION ALL SELECT 'devices', COUNT(*) FROM devices
UNION ALL SELECT 'device_types', COUNT(*) FROM device_types
UNION ALL SELECT 'telemetry_hot', COUNT(*) FROM telemetry_hot
ORDER BY table;
"

echo ""
echo "🧹 Cleaning up temp files..."
rm /tmp/staging_data_export.sql
EOF

echo ""
echo "✅ Data successfully imported to staging!"
echo ""
echo "Next steps:"
echo "1. Test the staging environment at https://your-staging-url"
echo "2. Verify devices appear in dashboard"
echo "3. Check telemetry data is visible in widgets"
