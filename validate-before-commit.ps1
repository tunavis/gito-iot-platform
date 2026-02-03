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
$typeCheck = npm run type-check 2>&1
$typeCheckExit = $LASTEXITCODE

Write-Host ""
Write-Host "🔎 ESLint checking..." -ForegroundColor Yellow
$lint = npm run lint 2>&1
$lintExit = $LASTEXITCODE

Set-Location ..

# Report results
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($typeCheckExit -eq 0 -and $lintExit -eq 0) {
    Write-Host "✅ All checks passed! Safe to commit." -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "❌ Validation failed!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Fix the errors above before committing." -ForegroundColor Yellow
    Write-Host "This saves CI/CD build time and catches issues early." -ForegroundColor Yellow
    exit 1
}
