#!/bin/bash
# ============================================================================
# Deploy to Staging - Safe Deployment Script
#
# This script handles standard staging deployments with proper error handling
# and rollback capability.
#
# Usage:
#   On staging server: ./scripts/deploy_staging.sh
# ============================================================================

set -e  # Exit on any error

echo "🚀 DEPLOYING TO STAGING"
echo "========================================"
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
# STEP 1: Pull latest code
# ============================================================================

echo "📥 Step 1/6: Pulling latest code..."

# Fetch latest changes
git fetch origin

# Show what will change
echo ""
echo "📊 Changes to be deployed:"
git log HEAD..origin/staging --oneline --no-decorate | head -10

echo ""
read -p "Continue with deployment? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

# Reset to latest staging
git reset --hard origin/staging

echo "✅ Code updated"
echo ""

# ============================================================================
# STEP 2: Login to GitHub Container Registry
# ============================================================================

echo "🔐 Step 2/6: Logging into GitHub Container Registry..."

# Use token from environment or prompt
if [ -z "$GITHUB_TOKEN" ]; then
    echo "⚠️  GITHUB_TOKEN not set. You'll need to provide it."
    read -s -p "Enter GitHub PAT token: " GITHUB_TOKEN
    echo ""
fi

echo "$GITHUB_TOKEN" | docker login ghcr.io -u $(git config user.name) --password-stdin

echo "✅ Logged in"
echo ""

# ============================================================================
# STEP 3: Pull latest images
# ============================================================================

echo "📦 Step 3/6: Pulling latest Docker images..."

docker compose -f docker-compose.staging.yml --env-file .env.staging pull

echo "✅ Images pulled"
echo ""

# ============================================================================
# STEP 4: Run database migrations (CHECK FIRST)
# ============================================================================

echo "📋 Step 4/6: Checking database migrations..."

# Start postgres if not running
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d postgres
sleep 5

# Start API temporarily to check migrations
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d api
sleep 10

echo ""
echo "Current migration status:"
docker exec gito-api-staging alembic current || {
    echo "⚠️  Warning: Could not get current migration status"
}

echo ""
echo "Pending migrations:"
docker exec gito-api-staging alembic upgrade head --sql | head -20 || {
    echo "No pending migrations or error checking"
}

echo ""
read -p "Run migrations? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "⚡ Running migrations..."
    docker exec gito-api-staging alembic upgrade head || {
        echo ""
        echo "❌ MIGRATION FAILED!"
        echo ""
        echo "📋 API logs:"
        docker logs gito-api-staging --tail 100
        echo ""
        echo "⚠️  Database may be in inconsistent state."
        echo "    Run ./scripts/reset_staging_database.sh to fix."
        exit 1
    }
    echo "✅ Migrations completed"
else
    echo "⏭️  Skipping migrations"
fi

echo ""

# ============================================================================
# STEP 5: Restart all services
# ============================================================================

echo "🔄 Step 5/6: Restarting all services..."

# Stop everything
docker compose -f docker-compose.staging.yml --env-file .env.staging down --remove-orphans

# Force remove containers if needed
docker rm -f gito-api-staging gito-web-staging gito-nginx-staging 2>/dev/null || true

# Start all services
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d

echo "⏳ Waiting for services to start..."
sleep 20

echo "✅ Services restarted"
echo ""

# ============================================================================
# STEP 6: Health check
# ============================================================================

echo "🏥 Step 6/6: Running health check..."

MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health)

    if [ "$HEALTH_CHECK" == "200" ]; then
        echo "✅ Health check PASSED (HTTP $HEALTH_CHECK)"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "⏳ Health check attempt $RETRY_COUNT/$MAX_RETRIES (HTTP $HEALTH_CHECK)"
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
    echo ""
    echo "📋 Web logs:"
    docker logs gito-web-staging --tail 50
    exit 1
fi

echo ""

# ============================================================================
# CLEANUP
# ============================================================================

echo "🧹 Cleaning up old images..."
docker image prune -af --filter "until=24h"

echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Service Status:"
docker compose -f docker-compose.staging.yml --env-file .env.staging ps

echo ""
echo "🌐 Application URL: https://dev-iot.gito.co.za"
echo "🏥 Health Check: https://dev-iot.gito.co.za/api/health"
echo ""
echo "📋 To view logs:"
echo "  docker logs gito-api-staging -f"
echo "  docker logs gito-web-staging -f"
echo ""
