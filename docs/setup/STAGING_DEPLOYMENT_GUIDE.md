# Staging Deployment Guide

Complete guide for deploying and managing the Gito IoT Platform staging environment.

---

## 🚀 Quick Reference

### Regular Deployment
**Automatic**: Push to `staging` branch
```bash
git push origin staging
```

**Manual**: Run deployment script on staging server
```bash
ssh mark@192.168.0.9
cd /opt/gito-iot
./scripts/deploy_staging.sh
```

### Emergency Database Reset
**When to use**: Database is inconsistent, migrations failing, or after major schema changes

**Option 1: GitHub Actions (Recommended)**
1. Go to: https://github.com/tunavis/gito-iot-platform/actions
2. Select "Reset Staging Database" workflow
3. Click "Run workflow"
4. Type `RESET` to confirm
5. Click "Run workflow" button

**Option 2: Manual Script**
```bash
ssh mark@192.168.0.9
cd /opt/gito-iot
./scripts/reset_staging_database.sh
```

---

## 📋 Deployment Workflows

### 1. Standard Deployment (Automatic)

**Trigger**: Push to `staging` branch

**What it does**:
1. Builds Docker images (API & Web)
2. Pushes images to GitHub Container Registry
3. Pulls latest code on staging server
4. Pulls latest Docker images
5. Stops current services
6. Runs database migrations
7. Starts all services
8. Health check with retries
9. Cleanup old images

**Workflow file**: `.github/workflows/staging-deploy.yml`

**Monitoring**:
- GitHub Actions: https://github.com/tunavis/gito-iot-platform/actions
- Staging URL: https://dev-iot.gito.co.za
- Health endpoint: https://dev-iot.gito.co.za/api/health

**If deployment fails**:
```bash
# SSH into staging
ssh mark@192.168.0.9

# Check service status
cd /opt/gito-iot
docker compose -f docker-compose.staging.yml ps

# Check logs
docker logs gito-api-staging --tail 100
docker logs gito-web-staging --tail 50

# If migrations failed, reset database
./scripts/reset_staging_database.sh
```

### 2. Database Reset (Manual Trigger Only)

**When to use**:
- ❌ Migration errors: `relation "table_name" already exists`
- ❌ Inconsistent schema between dev and staging
- ❌ Column order mismatch errors
- ❌ After manually patching staging database
- ✅ Want clean slate with all migrations applied

**Trigger**: GitHub Actions workflow dispatch

**What it does**:
1. Confirms "RESET" input (safety check)
2. Stops all services
3. Drops `gito_iot_staging` database
4. Creates fresh database
5. Runs ALL Alembic migrations from scratch
6. Restarts services
7. Health check
8. Verifies schema

**Workflow file**: `.github/workflows/staging-reset-database.yml`

**⚠️ WARNING**: This DELETES ALL staging data!

---

## 🛠️ Manual Deployment Scripts

### deploy_staging.sh

Interactive deployment script for staging server.

**Usage**:
```bash
ssh mark@192.168.0.9
cd /opt/gito-iot
./scripts/deploy_staging.sh
```

**Features**:
- Shows pending changes before deploying
- Asks for confirmation
- Interactive migration approval
- Detailed health check with retries
- Full error logging

**When to use**:
- Testing deployment changes before pushing to GitHub
- Deploying hotfixes quickly
- Debugging deployment issues

### reset_staging_database.sh

Nuclear option for database reset.

**Usage**:
```bash
ssh mark@192.168.0.9
cd /opt/gito-iot
./scripts/reset_staging_database.sh
```

**Features**:
- Automated database drop and recreate
- Runs all migrations from scratch
- Service restart
- Health verification
- Schema verification

**When to use**:
- After running this, you'll have a clean database
- Need to manually test migration sequence
- Want to verify all migrations work from scratch

---

## 🔧 Troubleshooting

### Problem: Health check fails with 502

**Symptom**: `curl http://localhost/api/health` returns 502

**Likely cause**: API container failed to start

**Fix**:
```bash
# Check API logs
docker logs gito-api-staging --tail 100

# Common causes:
# 1. Migration failure → Reset database
# 2. Environment variable missing → Check .env.staging
# 3. Database connection failed → Check postgres container
```

### Problem: Migration fails with "already exists"

**Symptom**: `relation "table_name" already exists`

**Cause**: Database has tables but Alembic thinks they don't exist

**Fix**:
```bash
# Option 1: Reset database (recommended)
./scripts/reset_staging_database.sh

# Option 2: Stamp current migration (advanced)
docker exec gito-api-staging alembic stamp head
```

### Problem: Deployment stuck on "Waiting for services"

**Symptom**: Health check times out after 6 retries

**Debug**:
```bash
# Check all container status
docker compose -f docker-compose.staging.yml ps

# Check which service is failing
docker logs gito-api-staging
docker logs gito-web-staging
docker logs gito-nginx-staging

# Check if postgres is running
docker exec gito-postgres psql -U gito -d gito_iot_staging -c "SELECT 1;"
```

### Problem: Column order mismatch in exports

**Symptom**: `pg_dump` exports have wrong column order

**Cause**: Staging database created from manual SQL, not migrations

**Fix**:
```bash
# Reset database to match dev exactly
./scripts/reset_staging_database.sh

# After reset, column order will match dev
```

---

## 📊 Environment Comparison

| Aspect | Development | Staging |
|--------|-------------|---------|
| **Location** | Local (Docker) | 192.168.0.9 (on-prem) |
| **Database** | `gito` | `gito_iot_staging` |
| **URL** | http://localhost:3000 | https://dev-iot.gito.co.za |
| **HTTPS** | No | Yes (external nginx proxy) |
| **Cookies** | `secure=false` | `secure=true` |
| **Deployment** | Manual (`docker-compose up`) | GitHub Actions + Scripts |
| **Migrations** | Manual (`alembic upgrade head`) | Automatic in deployment |
| **Data** | Test data via SQL | Synced from dev or fresh |

---

## 🔐 Access Information

### Staging Server SSH
- **Host**: 192.168.0.9
- **User**: mark
- **Password**: 5480477Tuna
- **Working Directory**: `/opt/gito-iot`

### Database
- **Container**: gito-postgres
- **Database**: gito_iot_staging
- **User**: gito
- **Password**: (in .env.staging)

### GitHub Container Registry
- **Registry**: ghcr.io
- **Images**:
  - `ghcr.io/tunavis/gito-iot-platform-api:staging`
  - `ghcr.io/tunavis/gito-iot-platform-web:staging`

---

## 📝 Best Practices

### Before Deploying
1. ✅ Test changes locally first
2. ✅ Ensure all tests pass
3. ✅ Check if schema changes require migration
4. ✅ If adding migration, ensure it's idempotent (IF NOT EXISTS)
5. ✅ Review changes: `git diff main..staging`

### During Deployment
1. ✅ Monitor GitHub Actions progress
2. ✅ Watch for migration errors
3. ✅ Verify health check passes
4. ✅ Check application in browser

### After Deployment
1. ✅ Test login flow
2. ✅ Verify critical features work
3. ✅ Check logs for errors
4. ✅ Monitor for a few minutes

### Database Migrations
1. ✅ Always use `IF NOT EXISTS` for CREATE TABLE
2. ✅ Always use `IF EXISTS` for DROP/ALTER
3. ✅ Test migrations on fresh database locally first
4. ✅ Never skip migrations in deployment
5. ✅ If migration fails, reset database and retry

---

## 🚨 Emergency Procedures

### Complete System Down
```bash
# SSH into staging
ssh mark@192.168.0.9
cd /opt/gito-iot

# Check what's running
docker ps -a

# Nuclear option: restart everything
docker compose -f docker-compose.staging.yml down
docker compose -f docker-compose.staging.yml up -d

# Wait and check health
sleep 30
curl http://localhost/api/health
```

### Database Corrupted
```bash
# Reset to clean state
./scripts/reset_staging_database.sh

# Import fresh test data (optional)
./scripts/import_to_staging.sh
```

### Rollback Deployment
```bash
# Find previous working commit
git log origin/staging --oneline

# Reset to previous commit
git reset --hard <commit-sha>

# Force push (USE WITH CAUTION)
git push --force origin staging

# This will trigger automatic redeployment
```

---

## 📞 Support

**Issues**: https://github.com/tunavis/gito-iot-platform/issues

**Documentation**: `/docs/setup/`

**Server Access**: Contact mark@gito.co.za
