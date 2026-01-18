#!/bin/bash

# ============================================================================
# GITO IOT PLATFORM - Database Seed Script
# ============================================================================
# Applies seed data to the PostgreSQL database
# This script loads sample notification channels, rules, templates, and preferences
# 
# Usage:
#   ./apply-seed.sh              # Uses default connection
#   ./apply-seed.sh -h localhost # Custom host
# ============================================================================

set -e

# Database connection details
DB_HOST="${1:-localhost}"
DB_PORT="${2:-5432}"
DB_NAME="${3:-gito_db}"
DB_USER="${4:-postgres}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}GITO IoT Platform - Database Seeding${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}✗ psql not found. Please install PostgreSQL client.${NC}"
    exit 1
fi

echo -e "${BLUE}Connecting to database:${NC}"
echo "  Host: $DB_HOST:$DB_PORT"
echo "  Database: $DB_NAME"
echo ""

# Check connection
echo -e "${BLUE}Verifying database connection...${NC}"
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &> /dev/null; then
    echo -e "${RED}✗ Cannot connect to database. Check your connection details.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Database connection successful${NC}"
echo ""

# Apply migrations if they haven't been applied
echo -e "${BLUE}Checking database schema...${NC}"

# Apply notifications migration if tables don't exist
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT to_regclass('public.notification_channels');" | grep -q notification_channels; then
    echo -e "${BLUE}Applying notifications migration...${NC}"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "./db/migrations/002_phase_3.2e_notifications.sql"
    echo -e "${GREEN}✓ Notifications migration applied${NC}"
else
    echo -e "${GREEN}✓ Notifications schema already exists${NC}"
fi
echo ""

# Apply seed data
echo -e "${BLUE}Applying seed data...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "./db/seeds/04_notifications_and_rules_seed.sql"
echo ""

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Seed data applied successfully!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "${BLUE}Created:${NC}"
echo "  • Notification channels (email, webhook, SMS)"
echo "  • Composite alert rules (6 sample rules)"
echo "  • Notification templates (4 email templates)"
echo "  • Rule-to-channel relationships"
echo "  • User notification preferences"
echo ""
echo -e "${BLUE}You can now view the seeded data in:${NC}"
echo "  • Management → Notifications (channels tab)"
echo "  • Management → Composite Alerts"
echo ""
