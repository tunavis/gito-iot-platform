# 🚀 Deployment Guide - Gito IoT Platform

**Staging URL:** https://dev-iot.gito.co.za
**Health Check:** https://dev-iot.gito.co.za/api/health

---

## 📋 Branch Strategy

```
feature/* ──► main ──► staging ──► (production)
                         ▲
                    auto-deploys to
                  dev-iot.gito.co.za
```

| Branch | Purpose | Auto-Deploy |
|--------|---------|-------------|
| `feature/*` | Development work | No |
| `main` | Stable baseline | No |
| `staging` | Staging environment | ✅ Yes → dev-iot.gito.co.za |

---

## 🚢 Deploying to Staging

### Step 1 — Merge your feature branch into staging

```bash
# Make sure your feature branch is committed and pushed
git status
git add .
git commit -m "feat: describe your change"
git push origin feature/your-branch-name

# Switch to staging and merge
git checkout staging
git pull origin staging          # Get latest staging first
git merge feature/your-branch-name

# Push — this triggers GitHub Actions deployment automatically
git push origin staging
```

### Step 2 — Watch the deployment

1. Go to **GitHub → Actions** tab
2. Find the **"Deploy to Staging"** workflow run
3. Watch it progress through:
   - `Build and Push Docker Images` (builds api + web)
   - `Deploy to Staging Server` (pulls, restarts, migrates, health checks)

**Deployment takes ~3-5 minutes total.**

### Step 3 — Verify

```bash
# Quick health check
curl https://dev-iot.gito.co.za/api/health

# Expected response:
# {"status":"ok","service":"Gito IoT API"}
```

---

## ⚠️ What Staging Deploy Does

The GitHub Actions workflow (`staging-deploy.yml`) runs on a **self-hosted runner** (the staging server itself):

1. **Builds** Docker images for `api` and `web`
2. **Pushes** images to GitHub Container Registry (ghcr.io)
3. **Tears down** all services INCLUDING database volume (`down --volumes`)
4. **Starts fresh** with new images
5. **Runs Alembic migrations** automatically (`alembic upgrade head`)
6. **Health checks** the API until it responds 200

> ⚠️ **Database is wiped on every staging deploy.** Staging re-seeds from migrations. Do NOT store important test data on staging between deploys.

---

## 🗄️ Database Migrations

**Every model change MUST have a migration in the same commit.**

Staging runs `alembic upgrade head` automatically on every deploy. A broken migration = API crash-loop = site down.

```bash
# Create a new migration after changing SQLAlchemy models
docker exec gito-api alembic revision --autogenerate -m "describe your change"

# Review the generated file in api/alembic/versions/
# ALWAYS add IF NOT EXISTS / IF EXISTS guards for idempotency

# Test it locally before pushing
docker exec gito-api alembic upgrade head
```

**Migration rules:**
- ✅ Use `IF NOT EXISTS` / `IF EXISTS` guards on all DDL
- ✅ Drop old tables/columns in the same migration (no leftovers)
- ✅ Test locally with `alembic upgrade head` before pushing
- ❌ Never reference tables that don't exist yet
- ❌ Never leave old code/columns/tables behind "for backwards compatibility"

---

## 🔍 Troubleshooting Staging

### Check service status
```bash
# SSH into staging server
ssh user@staging-server
cd /opt/gito-iot

docker compose -f docker-compose.staging.yml ps
```

### View logs
```bash
# API logs (most important for errors)
docker logs gito-api-staging --tail 100 -f

# Web logs
docker logs gito-web-staging --tail 50 -f

# Nginx logs
docker logs gito-nginx-staging --tail 50 -f
```

### API crash-loop (most common cause: failed migration)
```bash
# 1. Check the migration error
docker logs gito-api-staging --tail 50

# 2. If phantom revision error, fix alembic_version manually
docker exec gito-postgres-staging psql -U gito -d gito \
  -c "UPDATE alembic_version SET version_num = 'correct_revision_id';"

# 3. Restart API
docker compose -f docker-compose.staging.yml restart api
```

### 502 Bad Gateway
Nginx lost its upstream connection after containers were recreated.

```bash
# Restart nginx to reconnect
docker compose -f docker-compose.staging.yml restart nginx
```

> ⚠️ **Known issue:** When containers are recreated (`down` + `up`), nginx must be restarted separately even if it's still running. Always use `docker compose restart <service>` for individual service restarts — never `docker compose rm -f` on a single service.

### Login / cookie issues on staging
```bash
# Verify env_file is set on ALL services in docker-compose.staging.yml
# EVERY service must have:
#   env_file:
#     - .env.staging

# Check COOKIE_SECURE and TRUST_PROXY are set in .env.staging
grep -E "COOKIE_SECURE|TRUST_PROXY" /opt/gito-iot/.env.staging
```

### Force re-deploy without code change
```bash
# Trigger workflow manually:
# GitHub → Actions → "Deploy to Staging" → Run workflow
# OR push an empty commit:
git commit --allow-empty -m "chore: trigger staging deploy"
git push origin staging
```

---

## 🔐 Required Secrets (GitHub)

Go to: **GitHub → Settings → Secrets and variables → Actions**

| Secret | Description |
|--------|-------------|
| `GHCR_TOKEN` | GitHub token with `packages:write` for container registry |

The workflow uses a **self-hosted runner** on the staging server — no SSH key injection needed.

---

## 📦 Docker Compose Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Local development |
| `docker-compose.staging.yml` | Staging environment |

> Always use `docker compose` (v2 plugin syntax), not `docker-compose` (old standalone binary).

---

## 🌐 Environments

| Env | URL | Branch | Database |
|-----|-----|--------|----------|
| Local Dev | http://localhost | any | Persistent local volume |
| Staging | https://dev-iot.gito.co.za | `staging` | Reset on every deploy |
| Production | TBD | tagged release | Persistent |

---

## 📋 Quick Reference

```bash
# Deploy to staging
git checkout staging
git pull origin staging
git merge feature/your-branch-name
git push origin staging

# Check staging health
curl https://dev-iot.gito.co.za/api/health

# Watch deployment logs (on staging server)
docker logs gito-api-staging --tail 100 -f

# Fix 502 Bad Gateway
docker compose -f docker-compose.staging.yml restart nginx

# Fix crash-loop — check migration error first
docker logs gito-api-staging --tail 50

# Fix divergent git branch on staging server
git fetch origin && git reset --hard origin/staging
```

---

**Last Updated:** 2026-02-17
