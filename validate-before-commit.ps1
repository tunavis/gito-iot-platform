#!/usr/bin/env pwsh
# Validate code before committing - catches errors before CI/CD
# Run this before: git commit

Write-Host "🔍 Running pre-commit validation..." -ForegroundColor Cyan
Write-Host ""

# Check if in web directory
$currentDir = Get-Location
if (-not (Test-Path "web/package.json")) {
    Write-Host "❌ Must run from project root directory" -ForegroundColor Red
    exit 1
}

# Run validation
Write-Host "📝 TypeScript type checking..." -ForegroundColor Yellow
Set-Location web
npm run type-check *>&1 | Tee-Object -Variable typeCheckOutput | Out-Null
$typeCheckExit = $LASTEXITCODE

Write-Host ""
Write-Host "🔎 ESLint checking..." -ForegroundColor Yellow
npm run lint *>&1 | Tee-Object -Variable lintOutput | Out-Null
$lintExit = $LASTEXITCODE

Set-Location ..

# Check for actual ERRORS (not warnings)
$hasTypeErrors = $typeCheckOutput | Select-String "error TS"
$hasLintErrors = $lintOutput | Select-String "Error:"

# Report results
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($hasTypeErrors -or $hasLintErrors) {
    Write-Host "❌ Validation failed with ERRORS!" -ForegroundColor Red
    if ($hasTypeErrors) {
        Write-Host ""
        Write-Host "TypeScript Errors:" -ForegroundColor Red
        $typeCheckOutput | Select-String "error TS" | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    }
    if ($hasLintErrors) {
        Write-Host ""
        Write-Host "ESLint Errors:" -ForegroundColor Red
        $lintOutput | Select-String "Error:" | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    }
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Fix the errors above before committing." -ForegroundColor Yellow
    exit 1
} elseif ($typeCheckExit -ne 0 -or $lintExit -ne 0) {
    Write-Host "⚠️  Warnings found (non-blocking)" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Build will proceed with warnings." -ForegroundColor Yellow
    Write-Host "Consider fixing warnings for best practices." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "✅ All checks passed! Safe to commit." -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    exit 0
}
