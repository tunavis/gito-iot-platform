# 🚀 Deployment Guide - Gito IoT Platform

Industry-standard deployment process for staging and production environments.

## 📋 Prerequisites

- Linux staging/production servers with Docker installed
- GitHub repository access
- SSH access to servers
- Domain names configured (optional but recommended)

---

## 🏗️ Architecture Overview

```
Developer PC → Git Push → GitHub Actions → Docker Registry → Linux Servers
```

### Environments:
- **Development**: Local machine (Windows/Mac/Linux)
- **Staging**: Linux server for team testing
- **Production**: Linux server for end users

---

## 🔧 Initial Setup (One-Time)

### 1. Server Preparation

SSH into your staging server:

```bash
ssh user@staging-server

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login again for group changes to take effect
exit
```

### 2. Create Application Directory

```bash
ssh user@staging-server

# Create app directory
sudo mkdir -p /opt/gito-iot
sudo chown $USER:$USER /opt/gito-iot
cd /opt/gito-iot

# Clone repository
git clone https://github.com/tunavis/gito-iot-platform.git .
git checkout -b staging origin/main  # Create staging branch
```

### 3. Configure Environment Variables

```bash
# Copy and edit staging environment file
cp .env.staging.example .env.staging
nano .env.staging

# Set secure values for:
# - DATABASE_URL password
# - JWT_SECRET_KEY (generate with: openssl rand -hex 32)
# - MQTT_PASSWORD
# - CORS_ORIGINS (your staging domain)
```

### 4. Set Up GitHub Secrets

Go to GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:

| Secret Name | Description | Example |
|------------|-------------|---------|
| `STAGING_HOST` | Staging server IP/hostname | `staging.yourdomain.com` |
| `STAGING_USER` | SSH username | `deploy` |
| `STAGING_SSH_KEY` | Private SSH key for deployment | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

#### Generate SSH Key for Deployment:

On your local machine:
```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/gito_deploy
cat ~/.ssh/gito_deploy.pub  # Copy this to server's ~/.ssh/authorized_keys
cat ~/.ssh/gito_deploy      # Copy this to GitHub secret STAGING_SSH_KEY
```

On staging server:
```bash
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys  # Paste the public key here
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

---

## 📦 Deployment Process

### Method 1: Automatic Deployment (Recommended)

#### For Staging:

```bash
# On your local machine

# 1. Commit your changes
git add .
git commit -m "feat: add new dashboard features"

# 2. Push to staging branch (triggers automatic deployment)
git push origin staging
```

**What happens automatically:**
1. ✅ GitHub Actions builds Docker images
2. ✅ Pushes images to GitHub Container Registry
3. ✅ SSH into staging server
4. ✅ Pulls latest images
5. ✅ Restarts services with zero downtime
6. ✅ Runs health checks

**Monitor deployment:**
- Go to GitHub → Actions tab → Watch the deployment progress
- Check logs if deployment fails

#### For Production:

```bash
# Create a release tag
git checkout main
git merge staging  # Merge tested staging code
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin main --tags
```

### Method 2: Manual Deployment

If you need to deploy manually:

```bash
ssh user@staging-server
cd /opt/gito-iot

# Pull latest code
git pull origin staging

# Pull latest Docker images
docker-compose -f docker-compose.staging.yml pull

# Restart services
docker-compose -f docker-compose.staging.yml up -d

# Check logs
docker-compose -f docker-compose.staging.yml logs -f
```

---

## 🔍 Monitoring & Troubleshooting

### View Logs

```bash
# All services
docker-compose -f docker-compose.staging.yml logs -f

# Specific service
docker-compose -f docker-compose.staging.yml logs -f api
docker-compose -f docker-compose.staging.yml logs -f web
```

### Check Service Health

```bash
# Check running containers
docker-compose -f docker-compose.staging.yml ps

# API health check
curl http://localhost:8001/api/health

# Check database
docker-compose -f docker-compose.staging.yml exec postgres psql -U gito_user -d gito_iot_staging -c "SELECT COUNT(*) FROM devices;"
```

### Restart a Specific Service

```bash
docker-compose -f docker-compose.staging.yml restart api
docker-compose -f docker-compose.staging.yml restart web
```

### View Resource Usage

```bash
docker stats
```

---

## 🌐 Nginx Configuration (Recommended)

Set up Nginx as reverse proxy for SSL and domain access:

```nginx
# /etc/nginx/sites-available/gito-staging

upstream gito_api {
    server localhost:8001;
}

upstream gito_web {
    server localhost:3001;
}

server {
    listen 80;
    server_name staging.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name staging.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/staging.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.yourdomain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://gito_web;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API
    location /api/ {
        proxy_pass http://gito_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /ws/ {
        proxy_pass http://gito_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/gito-staging /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Set up SSL with Let's Encrypt
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d staging.yourdomain.com
```

---

## 🔐 Security Best Practices

### 1. Environment Variables
- ✅ Never commit `.env` files to Git
- ✅ Use strong random secrets (32+ characters)
- ✅ Rotate secrets regularly

### 2. Database
- ✅ Use strong database passwords
- ✅ Restrict database ports (don't expose to public)
- ✅ Regular backups

### 3. Docker
- ✅ Run containers as non-root users (already configured)
- ✅ Use specific image tags (not `latest`)
- ✅ Regularly update base images

### 4. Server
- ✅ Enable firewall (UFW)
- ✅ SSH key authentication only (disable password)
- ✅ Keep system updated

```bash
# Enable firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 📊 Database Migrations

### Run Migrations on Staging

```bash
ssh user@staging-server
cd /opt/gito-iot

# Run migrations
docker-compose -f docker-compose.staging.yml exec api python -m alembic upgrade head
```

---

## 🔄 Rollback Process

### Rollback to Previous Version

```bash
ssh user@staging-server
cd /opt/gito-iot

# Option 1: Git rollback
git checkout <previous-commit-hash>
docker-compose -f docker-compose.staging.yml up -d

# Option 2: Docker image rollback
docker-compose -f docker-compose.staging.yml pull ghcr.io/tunavis/gito-iot-api:staging-<previous-sha>
docker-compose -f docker-compose.staging.yml up -d
```

---

## 📝 Team Workflow

### Developer Workflow

1. **Create feature branch**
   ```bash
   git checkout -b feature/new-dashboard
   ```

2. **Develop locally**
   ```bash
   npm run dev  # Frontend
   docker-compose up  # Backend services
   ```

3. **Commit and push**
   ```bash
   git add .
   git commit -m "feat: add new dashboard"
   git push origin feature/new-dashboard
   ```

4. **Create Pull Request**
   - GitHub → Pull Requests → New PR
   - Request code review from team

5. **Merge to Staging**
   - After PR approval, merge to `staging` branch
   - Automatic deployment to staging server

6. **Test on Staging**
   - https://staging.yourdomain.com
   - Verify features work correctly

7. **Merge to Production**
   - Merge `staging` → `main`
   - Create release tag
   - Deploy to production

---

## 📞 Support

- **Documentation**: Check `docs/` folder
- **Issues**: GitHub Issues
- **Team Chat**: [Your team chat]

---

## ✅ Quick Command Reference

```bash
# Deploy to staging (automatic)
git push origin staging

# View logs
docker-compose -f docker-compose.staging.yml logs -f

# Restart services
docker-compose -f docker-compose.staging.yml restart

# Update and deploy
git pull && docker-compose -f docker-compose.staging.yml up -d

# Database backup
docker-compose -f docker-compose.staging.yml exec postgres pg_dump -U gito_user gito_iot_staging > backup.sql

# Check health
curl http://localhost:8001/api/health
```
