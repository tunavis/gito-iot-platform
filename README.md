# Gito IoT Platform

Multi-tenant SaaS IoT monitoring platform with real-time telemetry, alerting, and dashboard builder.

## 🚀 Quick Start (Development)

```bash
# Start all services
docker compose up -d

# Access application
http://localhost
```

**⚠️ IMPORTANT**: Always use **http://localhost** (port 80 via nginx)  
Direct port access (3000, 8000) won't work correctly due to API routing.

---

## 📁 Project Structure

```
├── api/                # FastAPI backend
├── web/                # Next.js frontend
├── db/                 # PostgreSQL + TimescaleDB
├── processor/          # MQTT telemetry processor
├── nginx/              # Reverse proxy config
├── docs/               # Detailed documentation
└── docker-compose.yml  # Development environment
```

---

## 🔥 Hot Reload (Enabled)

All code changes auto-reload:
- **Frontend** (`web/src/`): Save → Reload in < 2s
- **Backend** (`api/app/`): Save → Reload in < 5s
- **Processor** (`processor/`): Save → Auto-reload

---

## 📋 Common Commands

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f
docker compose logs -f web      # Frontend only
docker compose logs -f api      # Backend only

# Restart after config changes
docker compose restart web
docker compose restart api

# Rebuild after dependency changes
docker compose build web && docker compose up -d web

# Stop
docker compose down
```

---

## 🚢 Deployment

**Staging deployment is automated:**

```bash
# Push to staging branch
git push origin staging

# GitHub Actions automatically:
# 1. Builds production images
# 2. Pushes to ghcr.io
# 3. Deploys to staging server
```

---

## 📚 Documentation

- **[Development Workflow](docs/DEVELOPMENT_WORKFLOW.md)** - Complete dev guide
- **[CI/CD Setup](docs/setup/CI-CD-SETUP.md)** - Automated deployment
- **[Migrations](docs/MIGRATIONS.md)** - Database migrations (Alembic)
- **[Dashboard Implementation](docs/implementation/DASHBOARD_README.md)** - Dashboard builder

---

## 🏗️ Architecture

```
http://localhost (nginx:80)
 ├─ /api/*  →  api:8000     (FastAPI + PostgreSQL)
 └─ /*      →  web:3000     (Next.js)
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| **nginx** | 80 | Reverse proxy (gateway) |
| **web** | 3000 | Next.js frontend (dev mode) |
| **api** | 8000 | FastAPI backend |
| **postgres** | 5432 | PostgreSQL + TimescaleDB |
| **keydb** | 6379 | Redis-compatible cache |
| **mosquitto** | 1883 | MQTT broker |
| **processor** | - | Telemetry processor |

---

## 🛠️ Tech Stack

### Backend
- FastAPI (Python 3.11)
- PostgreSQL 15 + TimescaleDB
- SQLAlchemy + Alembic
- KeyDB (Redis)
- MQTT (Mosquitto)

### Frontend
- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS
- React Grid Layout

### DevOps
- Docker + Docker Compose
- GitHub Actions
- nginx
- Self-hosted runner

---

## ⚙️ Environment Configuration

Create `.env` for development:

```bash
DB_PASSWORD=your-db-password
JWT_SECRET_KEY=your-secret-key-min-32-chars
MQTT_USERNAME=admin
MQTT_PASSWORD=mqtt-password
```

**⚠️ Never commit `.env` or `.env.staging` files!**

---

## 🔍 Troubleshooting

### "API calls failing"
→ Use **http://localhost** (port 80), not direct ports

### "Changes not reflecting"
→ Check logs: `docker compose logs -f web`

### "Database connection failed"
→ Check postgres: `docker compose logs postgres`

### "Port 80 already in use"
→ Find conflicting process: `netstat -ano | findstr :80` (Windows)

---

## 📊 Current Status

✅ **Production-Ready Features:**
- Authentication & Authorization (RBAC)
- Multi-tenancy (Row-level security)
- Device Management (with Sites, Groups, Device Types)
- Alert Rules & Alarms (THRESHOLD and COMPOSITE rules)
- Alert rule preview evaluation (historical telemetry matching)
- Notifications (Email) & Notification Rules
- Dashboard Builder — 12 widget types:
  - KPI Card, Gauge, Stat Group
  - Time-Series Chart, Pie/Donut Chart, Scatter Plot
  - Activity Heatmap, Alarm Summary
  - Data Table, Fleet Status Matrix
  - Device Map (GPS), Device Info
- Solution Templates
- Analytics & Fleet Overview
- Audit Logs

⏳ **In Progress / Planned:**
- OTA firmware updates (backend workflow ready; API router + UI page pending)
- User invitation emails (user creation works; email delivery pending)
- Grafana integration
- react-grid-layout upgrade to v2.x+

---

## 🤝 Contributing

1. Work on `main` branch
2. Test locally: `docker compose up`
3. Commit with conventional commits: `feat:`, `fix:`, `docs:`
4. Deploy to staging: `git push origin staging`

---

## 📝 License

Proprietary - All Rights Reserved

---

## 🆘 Help

- [Development Workflow Guide](docs/DEVELOPMENT_WORKFLOW.md)
- [Troubleshooting](docs/DEVELOPMENT_WORKFLOW.md#troubleshooting)
- GitHub Issues: Report bugs/features

---

**Last Updated**: 2025-02-05
