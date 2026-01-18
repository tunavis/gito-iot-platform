# ============================================================================
# GITO IoT Platform - Database Seed Script (Windows PowerShell)
# ============================================================================
# Applies seed data to the PostgreSQL database
# This script loads sample notification channels, rules, templates, and preferences
# 
# Usage:
#   .\apply-seed.ps1                    # Uses default connection
#   .\apply-seed.ps1 -Host localhost    # Custom host
#   .\apply-seed.ps1 -Host localhost -Port 5432
# ============================================================================

param(
    [string]$Host = "localhost",
    [int]$Port = 5432,
    [string]$Database = "gito_db",
    [string]$User = "postgres"
)

$ErrorActionPreference = "Stop"

# Color output helper
function Write-Header {
    param([string]$Message)
    Write-Host "======================================" -ForegroundColor Blue
    Write-Host $Message -ForegroundColor Blue
    Write-Host "======================================" -ForegroundColor Blue
    Write-Host ""
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
    exit 1
}

# Start
Write-Header "GITO IoT Platform - Database Seeding"

# Check if psql is available
try {
    $psqlVersion = & psql --version 2>&1
    Write-Host "Found: $psqlVersion" -ForegroundColor Gray
} catch {
    Write-Error-Custom "psql not found. Please install PostgreSQL client."
}

Write-Host ""
Write-Host "Connecting to database:" -ForegroundColor Blue
Write-Host "  Host: $Host`:$Port"
Write-Host "  Database: $Database"
Write-Host "  User: $User"
Write-Host ""

# Verify connection
Write-Host "Verifying database connection..." -ForegroundColor Blue
$connectionString = "postgresql://$User@$Host`:$Port/$Database"

try {
    $env:PGPASSWORD = Read-Host -Prompt "Enter PostgreSQL password" -AsSecureString
    $password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($env:PGPASSWORD))
    
    & psql -h $Host -p $Port -U $User -d $Database -c "SELECT 1;" *>$null
    Write-Success "Database connection successful"
} catch {
    Write-Error-Custom "Cannot connect to database. Check your connection details."
}

Write-Host ""

# Check if notifications tables exist
Write-Host "Checking database schema..." -ForegroundColor Blue
$tableExists = & psql -h $Host -p $Port -U $User -d $Database -c "SELECT to_regclass('public.notification_channels');" 2>&1

if ($tableExists -match "notification_channels") {
    Write-Success "Notifications schema already exists"
} else {
    Write-Host "Applying notifications migration..." -ForegroundColor Blue
    $migrationFile = "./db/migrations/002_phase_3.2e_notifications.sql"
    if (Test-Path $migrationFile) {
        & psql -h $Host -p $Port -U $User -d $Database -f $migrationFile
        Write-Success "Notifications migration applied"
    } else {
        Write-Error-Custom "Migration file not found: $migrationFile"
    }
}

Write-Host ""

# Apply seed data
Write-Host "Applying seed data..." -ForegroundColor Blue
$seedFile = "./db/seeds/04_notifications_and_rules_seed.sql"

if (Test-Path $seedFile) {
    & psql -h $Host -p $Port -U $User -d $Database -f $seedFile
    Write-Host ""
    Write-Header "Seed data applied successfully!"
} else {
    Write-Error-Custom "Seed file not found: $seedFile"
}

Write-Host ""
Write-Host "Created:" -ForegroundColor Blue
Write-Host "  • Notification channels (email, webhook, SMS)"
Write-Host "  • Composite alert rules (6 sample rules)"
Write-Host "  • Notification templates (4 email templates)"
Write-Host "  • Rule-to-channel relationships"
Write-Host "  • User notification preferences"
Write-Host ""
Write-Host "You can now view the seeded data in:" -ForegroundColor Blue
Write-Host "  • Management → Notifications (channels tab)"
Write-Host "  • Management → Composite Alerts"
Write-Host ""
