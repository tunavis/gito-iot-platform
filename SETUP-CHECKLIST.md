# ✅ Staging Deployment Setup Checklist

## What We've Created

✅ **Environment Configuration Files**
- `.env.staging.example` - Template for staging environment variables
- `.env.production.example` - Template for production environment variables

✅ **Docker Configuration**
- `docker-compose.staging.yml` - Staging deployment configuration
- Updated `api/Dockerfile` - Production-ready with 4 workers

✅ **CI/CD Pipeline**
- `.github/workflows/staging-deploy.yml` - Automated deployment on push to staging branch

✅ **Documentation**
- `DEPLOYMENT.md` - Complete deployment guide
- Updated `.gitignore` - Ensures secrets aren't committed

---

## 🚀 Next Steps to Deploy to Staging

### Step 1: Prepare Staging Server (Your Team Lead)

```bash
# SSH into staging server
ssh user@staging-server-ip

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create app directory
sudo mkdir -p /opt/gito-iot
sudo chown $USER:$USER /opt/gito-iot
cd /opt/gito-iot

# Clone repository
git clone https://github.com/tunavis/gito-iot-platform.git .
git checkout -b staging origin/main
```

### Step 2: Configure Environment Variables

```bash
# On staging server
cd /opt/gito-iot
cp .env.staging.example .env.staging
nano .env.staging

# Set these values:
# - DATABASE_URL password
# - JWT_SECRET_KEY (generate: openssl rand -hex 32)
# - MQTT_PASSWORD
# - CORS_ORIGINS
```

### Step 3: Set Up GitHub Secrets

**Generate SSH key for deployment:**
```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/gito_deploy

# Copy public key to staging server
ssh-copy-id -i ~/.ssh/gito_deploy.pub user@staging-server-ip

# Copy private key for GitHub secret
cat ~/.ssh/gito_deploy  # Add this to GitHub
```

**Add secrets to GitHub:**
1. Go to: https://github.com/tunavis/gito-iot-platform/settings/secrets/actions
2. Add:
   - `STAGING_HOST` → Your staging server IP/hostname
   - `STAGING_USER` → SSH username (e.g., `deploy`)
   - `STAGING_SSH_KEY` → Private key content from above

### Step 4: Create Staging Branch

```bash
# On your local machine
git checkout -b staging
git push -u origin staging
```

### Step 5: Commit and Push Deployment Files

```bash
git add .
git commit -m "ci: add staging deployment configuration"
git push origin staging
```

This will:
- ✅ Build Docker images
- ✅ Push to GitHub Container Registry
- ✅ Deploy to staging server
- ✅ Run health checks

### Step 6: Monitor Deployment

Watch the deployment:
- GitHub → Actions → "Deploy to Staging" workflow
- Check logs if it fails

### Step 7: Verify Deployment

```bash
# SSH into staging server
ssh user@staging-server-ip
cd /opt/gito-iot

# Check services
docker-compose -f docker-compose.staging.yml ps

# Check logs
docker-compose -f docker-compose.staging.yml logs -f

# Test API
curl http://localhost:8001/api/health
```

---

## 👥 For Other Developers

Once staging is set up, other developers can deploy by simply:

```bash
# 1. Create a feature branch
git checkout -b feature/my-feature

# 2. Make changes and commit
git add .
git commit -m "feat: add new feature"

# 3. Push to GitHub
git push origin feature/my-feature

# 4. Create Pull Request to staging branch
# (Go to GitHub and create PR)

# 5. After PR approval, merge to staging
# (Automatic deployment happens!)
```

---

## 🔒 Security Notes

**NEVER commit these files:**
- ❌ `.env`
- ❌ `.env.staging`
- ❌ `.env.production`
- ❌ `SSH private keys`
- ❌ `Database passwords`

**ALWAYS commit these files:**
- ✅ `.env.staging.example`
- ✅ `.env.production.example`
- ✅ `docker-compose.staging.yml`
- ✅ `Dockerfile`
- ✅ `.github/workflows/*.yml`

---

## 📞 Questions?

Read the full guide: `DEPLOYMENT.md`

Common issues:
1. **SSH connection failed** → Check `STAGING_HOST`, `STAGING_USER`, and `STAGING_SSH_KEY` in GitHub secrets
2. **Docker build failed** → Check Dockerfile and ensure all dependencies are listed
3. **Container won't start** → Check logs: `docker-compose logs -f`
4. **Database connection failed** → Verify `.env.staging` DATABASE_URL

---

## 🎯 Quick Test Deployment

Want to test the deployment process? Make a small change:

```bash
# 1. Edit a file (e.g., add a comment)
echo "// Test deployment" >> web/src/app/page.tsx

# 2. Commit and push to staging
git add .
git commit -m "test: verify deployment pipeline"
git push origin staging

# 3. Watch GitHub Actions
# GitHub → Actions tab → Watch the deployment

# 4. Verify on server
# SSH in and check: docker-compose ps
```

**Estimated setup time:** 30-45 minutes for first-time setup

Good luck! 🚀
