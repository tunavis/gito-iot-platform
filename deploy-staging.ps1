# Deploy to Staging Server
# Run this from your local machine

Write-Host "🚀 Deploying to Staging Server..." -ForegroundColor Cyan

# SSH into server and run deployment commands
ssh mark@192.168.0.9 @'
cd /opt/gito-iot
sudo chown -R mark:mark /opt/gito-iot
git config --global --add safe.directory /opt/gito-iot
git pull origin staging
ls -la .env.staging
docker compose -f docker-compose.staging.yml down
docker compose -f docker-compose.staging.yml pull
docker compose -f docker-compose.staging.yml up -d
docker compose -f docker-compose.staging.yml ps
'@

Write-Host "✅ Deployment complete!" -ForegroundColor Green
