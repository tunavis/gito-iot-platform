#!/bin/bash
# ============================================================================
# Reset Staging Database - Nuclear Option
#
# This script completely resets the staging database and runs all Alembic
# migrations from scratch. Use this when staging DB is in an inconsistent state.
#
# Usage:
#   On staging server: ./scripts/reset_staging_database.sh
#   OR from GitHub Actions workflow (manual trigger)
# ============================================================================

set -e  # Exit on any error

echo "🚨 STAGING DATABASE RESET"
echo "========================================"
echo "This will:"
echo "  1. Stop all services"
echo "  2. Drop gito_iot_staging database"
echo "  3. Recreate database from scratch"
echo "  4. Run all Alembic migrations"
echo "  5. Restart services"
echo ""
echo "⚠️  WARNING: This will DELETE ALL staging data!"
echo ""

# Check if running on staging server
if [ ! -d "/opt/gito-iot" ]; then
    echo "❌ Error: /opt/gito-iot not found. Are you on the staging server?"
    exit 1
fi

cd /opt/gito-iot

echo "📍 Working directory: $(pwd)"
echo ""

# ============================================================================
# STEP 1: Stop all services
# ============================================================================

echo "🛑 Step 1/5: Stopping all services..."
docker compose -f docker-compose.staging.yml --env-file .env.staging down --remove-orphans || true

# Force remove containers if they still exist
docker rm -f gito-api-staging gito-web-staging gito-nginx-staging gito-postgres-staging gito-redis-staging 2>/dev/null || true

echo "✅ Services stopped"
echo ""

# ============================================================================
# STEP 2: Drop existing database
# ============================================================================

echo "🗑️  Step 2/5: Dropping existing database..."

# Start only postgres to drop/recreate database
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d postgres

# Wait for postgres to be ready
echo "⏳ Waiting for PostgreSQL to start..."
sleep 10

# Drop database (need to connect to postgres database to drop gito_iot_staging)
docker exec gito-postgres-staging psql -U gito_user -d postgres -c "DROP DATABASE IF EXISTS gito_iot_staging;" || {
    echo "⚠️  Warning: Could not drop database (might not exist yet)"
}

echo "✅ Database dropped"
echo ""

# ============================================================================
# STEP 3: Create fresh database
# ============================================================================

echo "🆕 Step 3/5: Creating fresh database..."

docker exec gito-postgres-staging psql -U gito_user -d postgres -c "CREATE DATABASE gito_iot_staging OWNER gito_user;"

echo "✅ Database created"
echo ""

# ============================================================================
# STEP 4: Run Alembic migrations
# ============================================================================

echo "📦 Step 4/5: Running Alembic migrations..."

# Start redis and API service for migrations
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d redis
sleep 5
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d api

# Wait for API to initialize
echo "⏳ Waiting for API container to start..."
sleep 15

# Check migration status
echo ""
echo "📋 Current Alembic status:"
docker exec gito-api-staging alembic current || echo "No migrations applied yet"

# Run migrations
echo ""
echo "⚡ Running alembic upgrade head..."
docker exec gito-api-staging alembic upgrade head

# Verify migrations
echo ""
echo "📋 Final Alembic status:"
docker exec gito-api-staging alembic current

echo ""
echo "✅ Migrations completed"
echo ""

# ============================================================================
# STEP 5: Restart all services
# ============================================================================

echo "🚀 Step 5/5: Starting all services..."

# Stop API (we'll start everything together)
docker compose -f docker-compose.staging.yml --env-file .env.staging down

# Start all services
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d

echo "⏳ Waiting for services to start..."
sleep 20

# ============================================================================
# HEALTH CHECK
# ============================================================================

echo ""
echo "🏥 Running health check..."

MAX_RETRIES=6
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health)

    if [ "$HEALTH_CHECK" == "200" ]; then
        echo "✅ Health check PASSED (HTTP $HEALTH_CHECK)"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "⏳ Attempt $RETRY_COUNT/$MAX_RETRIES (HTTP $HEALTH_CHECK)"
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            sleep 10
        fi
    fi
done

if [ "$HEALTH_CHECK" != "200" ]; then
    echo "❌ Health check FAILED after $MAX_RETRIES attempts"
    echo ""
    echo "📋 API logs:"
    docker logs gito-api-staging --tail 100
    exit 1
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ STAGING DATABASE RESET COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Service Status:"
docker compose -f docker-compose.staging.yml --env-file .env.staging ps

echo ""
echo "📋 Database Tables:"
docker exec gito-postgres-staging psql -U gito_user -d gito_iot_staging -c "\\dt"

echo ""
echo "🎯 Next Steps:"
echo "  1. ✅ Database is clean with all migrations applied"
echo "  2. 🔐 Create a tenant admin user (or import test data)"
echo "  3. 🧪 Test login at https://dev-iot.gito.co.za"
echo "  4. 📊 Import test data if needed: ./scripts/import_to_staging.sh"
echo ""
