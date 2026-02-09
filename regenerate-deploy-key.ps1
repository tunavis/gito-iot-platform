#!/usr/bin/env pwsh
# Regenerate deployment SSH key without passphrase

$keyName = "gito_staging_deploy_new"
$serverUser = "gito"
$serverHost = "192.168.0.9"

Write-Host "🔑 Generating new SSH key WITHOUT passphrase..." -ForegroundColor Cyan

# Generate new key without passphrase
ssh-keygen -t ed25519 -f $keyName -N "" -C "github-actions-deploy"

Write-Host ""
Write-Host "✅ Key generated: $keyName" -ForegroundColor Green
Write-Host ""
Write-Host "📋 NEXT STEPS:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Copy public key to staging server:" -ForegroundColor Cyan
Write-Host "   scp ${keyName}.pub ${serverUser}@${serverHost}:~/" -ForegroundColor White
Write-Host "   ssh ${serverUser}@${serverHost}" -ForegroundColor White
Write-Host "   cat ~/${keyName}.pub >> ~/.ssh/authorized_keys" -ForegroundColor White
Write-Host "   rm ~/${keyName}.pub" -ForegroundColor White
Write-Host ""
Write-Host "2. Update GitHub Secret STAGING_SSH_KEY:" -ForegroundColor Cyan
Write-Host "   https://github.com/tunavis/gito-iot-platform/settings/secrets/actions" -ForegroundColor White
Write-Host ""
Write-Host "   Copy this private key (INCLUDING headers):" -ForegroundColor Yellow
Write-Host ""
Get-Content $keyName | Write-Host -ForegroundColor Gray
Write-Host ""
Write-Host "3. Test connection:" -ForegroundColor Cyan
Write-Host "   ssh -i $keyName ${serverUser}@${serverHost}" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  Keep the private key file secure until you've updated GitHub!" -ForegroundColor Red
