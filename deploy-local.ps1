#Requires -Version 5.0
<#
.SYNOPSIS
    Quick-start deployment script for GITO IoT Platform
    
.DESCRIPTION
    Sets up and deploys the complete IoT platform locally with Docker Compose
    
.EXAMPLE
    .\deploy-local.ps1
    
.NOTES
    Prerequisites: Docker Desktop 4.0+, Git, PowerShell 5.0+
#>

param(
    [switch]$Full = $false,  # Full rebuild with --no-cache
    [switch]$Clean = $false, # Remove all containers and volumes
    [switch]$Logs = $false   # Show logs after startup
)

# Color helper
function Write-ColorOutput([string]$Message, [string]$Color = "Green") {
    Write-Host $Message -ForegroundColor $Color
}

function Write-Header([string]$Title) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

# Check prerequisites
function Check-Prerequisites {
    Write-Header "Checking Prerequisites"
    
    # Check Docker
    try {
        $dockerVersion = docker --version
        Write-ColorOutput "✓ Docker: $dockerVersion"
    } catch {
        Write-ColorOutput "✗ Docker not found or not in PATH" "Red"
        Write-ColorOutput "Install Docker Desktop from https://www.docker.com/products/docker-desktop" "Yellow"
        exit 1
    }
    
    # Check Docker Compose
    try {
        $composeVersion = docker compose version
        Write-ColorOutput "✓ Docker Compose: $composeVersion"
    } catch {
        Write-ColorOutput "✗ Docker Compose not found" "Red"
        exit 1
    }
    
    # Check .env file
    if (-not (Test-Path ".env")) {
        Write-ColorOutput "Creating .env from .env.example..." "Yellow"
        if (Test-Path ".env.example") {
            Copy-Item ".env.example" ".env"
            Write-ColorOutput "✓ .env created. Please review and update passwords!" "Yellow"
        } else {
            Write-ColorOutput "✗ .env.example not found" "Red"
            exit 1
        }
    } else {
        Write-ColorOutput "✓ .env file exists"
    }
}

# Clean up function
function Clean-Environment {
    Write-Header "Cleaning Up"
    Write-ColorOutput "Removing all containers and volumes..." "Yellow"
    docker compose down -v
    Write-ColorOutput "✓ Cleanup complete"
}

# Build function
function Build-Images {
    param([bool]$NoCache = $false)
    
    Write-Header "Building Docker Images"
    
    if ($NoCache) {
        Write-ColorOutput "Building with --no-cache (this may take 5-10 minutes)..."
        docker compose build --no-cache
    } else {
        Write-ColorOutput "Building images..."
        docker compose build
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput "✗ Build failed" "Red"
        exit 1
    }
    Write-ColorOutput "✓ Build complete"
}

# Start services
function Start-Services {
    Write-Header "Starting Services (Phase-by-Phase)"
    
    # Phase 1: Database
    Write-ColorOutput "`n[1/4] Starting PostgreSQL..."
    docker compose up -d postgres
    Start-Sleep -Seconds 15
    
    $pgReady = docker compose exec postgres pg_isready -U gito -d gito 2>$null
    if ($pgReady -like "*accepting*") {
        Write-ColorOutput "✓ PostgreSQL ready"
    } else {
        Write-ColorOutput "⚠ PostgreSQL starting (may take longer)..."
        Start-Sleep -Seconds 10
    }
    
    # Phase 2: Cache & Message Broker
    Write-ColorOutput "`n[2/4] Starting KeyDB and Mosquitto..."
    docker compose up -d keydb mosquitto
    Start-Sleep -Seconds 5
    Write-ColorOutput "✓ KeyDB and Mosquitto started"
    
    # Phase 3: Application Services
    Write-ColorOutput "`n[3/4] Starting Application Services..."
    docker compose up -d processor api web
    Start-Sleep -Seconds 20
    Write-ColorOutput "✓ Application services started"
    
    # Phase 4: Workflow Engine & Proxy
    Write-ColorOutput "`n[4/4] Starting Cadence and Nginx..."
    docker compose up -d cadence cadence-web nginx
    Start-Sleep -Seconds 15
    Write-ColorOutput "✓ Cadence and Nginx started"
}

# Verify services
function Verify-Services {
    Write-Header "Verifying Services"
    
    $allHealthy = $true
    
    # Check PostgreSQL
    $pgStatus = docker compose ps postgres --no-trunc 2>$null | Select-String "Up"
    if ($pgStatus) {
        Write-ColorOutput "✓ PostgreSQL: Running"
    } else {
        Write-ColorOutput "✗ PostgreSQL: Not healthy" "Red"
        $allHealthy = $false
    }
    
    # Check KeyDB
    $keydbStatus = docker compose exec keydb keydb-cli ping 2>$null
    if ($keydbStatus -like "*PONG*") {
        Write-ColorOutput "✓ KeyDB: Responding"
    } else {
        Write-ColorOutput "⚠ KeyDB: Not responding yet" "Yellow"
    }
    
    # Check Mosquitto
    $mqttStatus = docker compose ps mosquitto --no-trunc 2>$null | Select-String "Up"
    if ($mqttStatus) {
        Write-ColorOutput "✓ Mosquitto: Running"
    } else {
        Write-ColorOutput "✗ Mosquitto: Not running" "Red"
        $allHealthy = $false
    }
    
    # Check API
    $apiStatus = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -ErrorAction SilentlyContinue
    if ($apiStatus.StatusCode -eq 200) {
        Write-ColorOutput "✓ FastAPI: Responding (200)"
    } else {
        Write-ColorOutput "⚠ FastAPI: Starting up..." "Yellow"
    }
    
    # Check Frontend
    $webStatus = Invoke-WebRequest -Uri "http://localhost:3000" -ErrorAction SilentlyContinue
    if ($webStatus.StatusCode -eq 200) {
        Write-ColorOutput "✓ Next.js: Responding (200)"
    } else {
        Write-ColorOutput "⚠ Next.js: Starting up..." "Yellow"
    }
    
    # Check Cadence
    $cadenceStatus = docker compose ps cadence --no-trunc 2>$null | Select-String "Up"
    if ($cadenceStatus) {
        Write-ColorOutput "✓ Cadence: Running"
    } else {
        Write-ColorOutput "✗ Cadence: Not running" "Red"
    }
    
    # Summary
    Write-ColorOutput "`n------ Container Status ------"
    docker compose ps
    
    return $allHealthy
}

# Print access info
function Print-AccessInfo {
    Write-Header "Deployment Complete!"
    
    Write-ColorOutput "`n📱 Access Your Applications:`n" "Cyan"
    Write-ColorOutput "  Main App:           http://localhost:3000" "Green"
    Write-ColorOutput "  API Docs:           http://localhost:8000/api/docs" "Green"
    Write-ColorOutput "  API Health:         http://localhost:8000/api/health" "Green"
    Write-ColorOutput "  Cadence Web:        http://localhost:8088" "Green"
    Write-ColorOutput "  Mosquitto MQTT:     localhost:1883 (user: admin)" "Green"
    
    Write-ColorOutput "`n🔐 Important Configuration:`n" "Cyan"
    Write-ColorOutput "  • Edit .env file to configure passwords" "Yellow"
    Write-ColorOutput "  • Configure SMTP for email notifications" "Yellow"
    Write-ColorOutput "  • Update JWT_SECRET_KEY for production" "Yellow"
    
    Write-ColorOutput "`n📊 Monitor Services:`n" "Cyan"
    Write-ColorOutput "  docker compose logs -f              (All logs)" "White"
    Write-ColorOutput "  docker compose logs -f api          (API only)" "White"
    Write-ColorOutput "  docker stats                        (Resource usage)" "White"
    
    Write-ColorOutput "`n✅ Next Steps:`n" "Cyan"
    Write-ColorOutput "  1. Create a tenant via API" "White"
    Write-ColorOutput "  2. Register a device" "White"
    Write-ColorOutput "  3. Publish MQTT telemetry" "White"
    Write-ColorOutput "  4. View in dashboard" "White"
    
    Write-ColorOutput "`n🛑 Stop Services:`n" "Cyan"
    Write-ColorOutput "  docker compose down" "White"
}

# Main execution
function Main {
    Write-Host "`n" -ForegroundColor Cyan
    Write-ColorOutput "  ╔══════════════════════════════════════╗" "Cyan"
    Write-ColorOutput "  ║   GITO IoT Platform Deployment      ║" "Cyan"
    Write-ColorOutput "  ║   Local Development Environment     ║" "Cyan"
    Write-ColorOutput "  ╚══════════════════════════════════════╝" "Cyan"
    
    # Change to script directory
    $scriptPath = if ($PSScriptRoot) { $PSScriptRoot } else { $MyInvocation.MyCommand.Path }
    if ($scriptPath) {
        $scriptDir = if (Test-Path -Path $scriptPath -PathType Container) { $scriptPath } else { Split-Path -Parent $scriptPath }
        Set-Location $scriptDir
    }
    
    # Clean if requested
    if ($Clean) {
        Clean-Environment
        return
    }
    
    # Check prerequisites
    Check-Prerequisites
    
    # Build images
    Build-Images -NoCache:$Full
    
    # Start services
    Start-Services
    
    # Verify
    $healthy = Verify-Services
    
    if ($Logs) {
        Write-ColorOutput "`nStreaming logs (Ctrl+C to exit)..."
        docker compose logs -f
    }
    
    # Print access info
    Print-AccessInfo
    
    if (-not $healthy) {
        Write-ColorOutput "`n⚠ Some services may still be starting. Wait 30 seconds and check again." "Yellow"
        Write-ColorOutput "Run: docker compose logs -f" "Yellow"
    }
}

# Run main
Main
