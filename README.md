# Gito IoT Platform

**A production-grade, multi-tenant IoT monitoring platform - Built as a Cumulocity competitor.**

## Quick Start (Phase 1)

### Prerequisites
- Docker & Docker Compose
- Python 3.11+
- Node.js 20+
- Git

### Setup

1. **Clone and navigate**
   ```bash
   cd gito-iot-platform
   ```

2. **Create environment**
   ```bash
   cp .env.example .env
   # Edit .env with your values (for dev, defaults are fine)
   ```

3. **Start services**
   ```bash
   docker-compose up -d
   ```

4. **Initialize database** (runs automatically on first startup)
   - Database: http://localhost:5432
   - Demo credentials: `admin@demo.gito.local` / `admin123` (in init.sql)

5. **Access services**
   - API Docs: http://localhost:8000/api/docs
   - API Health: http://localhost:8000/api/health
   - Frontend: http://localhost:3000 (coming next)

## Architecture

```
Browser/Client
    │
    ├─ Next.js (Port 3000)
    │   ├─ Server-side rendering
    │   ├─ API routes (proxy to FastAPI)
    │   └─ JWT middleware
    │
    ├─ FastAPI Backend (Port 8000)
    │   ├─ REST API
    │   ├─ JWT authentication
    │   └─ RLS enforcement
    │
    ├─ PostgreSQL + TimescaleDB (Port 5432)
    │   ├─ Multi-tenancy
    │   ├─ Row-Level Security
    │   └─ Time-series telemetry
    │
    ├─ Mosquitto MQTT (Port 1883)
    │   └─ Device communication
    │
    ├─ KeyDB Cache (Port 6379)
    │   └─ Rate limiting, sessions
    │
    └─ Nginx Reverse Proxy (Port 80/443)
        └─ Request routing
```

## Project Structure

```
gito-iot-platform/
├── api/                       # FastAPI backend
│   ├── app/
│   │   ├── main.py           # App factory
│   │   ├── config.py         # Settings
│   │   ├── security.py       # JWT & password
│   │   ├── database.py       # SQLAlchemy setup
│   │   ├── models/           # ORM models
│   │   ├── schemas/          # Pydantic validation
│   │   └── routers/          # API endpoints
│   ├── Dockerfile
│   └── pyproject.toml
│
├── web/                       # Next.js frontend (Phase 1.5)
│   ├── src/
│   │   ├── app/              # Pages & routes
│   │   ├── components/       # React components
│   │   ├── lib/              # Utilities
│   │   └── styles/
│   └── package.json
│
├── processor/                 # MQTT → Database worker (Phase 1.5)
│   └── app/
│
├── db/                        # Database setup
│   ├── init.sql              # Schema + RLS
│   └── migrations/           # Alembic (future)
│
├── docker-compose.yml        # All services
├── .env                      # Configuration (gitignored)
└── .env.example              # Template
```

## API Endpoints (Phase 1)

### Authentication
```
POST   /api/v1/auth/login      # Login with email/password
POST   /api/v1/auth/refresh    # Refresh JWT token
POST   /api/v1/auth/logout     # Logout
```

### Devices
```
GET    /api/v1/tenants/{tenant_id}/devices              # List devices
POST   /api/v1/tenants/{tenant_id}/devices              # Create device
GET    /api/v1/tenants/{tenant_id}/devices/{device_id}  # Get device
PUT    /api/v1/tenants/{tenant_id}/devices/{device_id}  # Update device
DELETE /api/v1/tenants/{tenant_id}/devices/{device_id}  # Delete device
```

## Development

### Backend (FastAPI)

```bash
# Install dependencies
cd api
pip install -e ".[dev]"

# Run tests
pytest

# Lint & format
black app/
ruff check app/
mypy app/
```

### Frontend (Next.js - Phase 1.5)

```bash
# Install dependencies
cd web
npm install

# Run dev server
npm run dev

# Build
npm run build
```

## Database

### Reset Database (Development Only)
```bash
docker-compose down -v  # Remove volumes
docker-compose up       # Recreates from init.sql
```

### Connect to Database
```bash
psql postgresql://gito:dev-password@localhost:5432/gito
```

## Configuration

Edit `.env` for:
- Database credentials
- JWT secret key (change in production!)
- MQTT broker settings
- ChirpStack integration (Phase 3)
- Email SMTP (Phase 2)

## Security Checklist

- ✅ All dependencies MIT/Apache/BSD licensed
- ✅ JWT tokens in HTTP-only cookies (client-side: Next.js)
- ✅ Database RLS enforced on all tenant data
- ✅ Password hashing with bcrypt (12 rounds)
- ✅ Tenant validation on every API request
- ✅ No secrets in code (use .env)
- ⚠️ Generate strong JWT_SECRET_KEY for production
- ⚠️ Use HTTPS in production
- ⚠️ Configure CORS correctly in production

## Phase Progress

### ✅ Phase 1: Foundation (Current)
- [x] Monorepo structure
- [x] Docker Compose setup
- [x] PostgreSQL schema with RLS
- [x] FastAPI app factory
- [x] JWT authentication
- [x] Device CRUD API
- [ ] Next.js frontend (Phase 1.5)
- [ ] MQTT processor (Phase 1.5)

### ⏳ Phase 2: Core Features (Weeks 3-4)
- Real-time telemetry (WebSocket)
- Time-series charts
- Device health scoring
- Email alerts

### ⏳ Phase 3: Advanced (Weeks 5-6)
- ChirpStack integration
- OTA firmware updates
- Alert rules engine
- Tenant management UI

### ⏳ Phase 4: Production (Weeks 7-8)
- Monitoring dashboards (Grafana)
- Backup/restore procedures
- Docker Swarm deployment
- Customer onboarding

## Troubleshooting

### Database Connection Error
```
docker-compose logs postgres
# Check if postgres is healthy: docker-compose ps
```

### API Not Starting
```
docker-compose logs api
# Check .env file has DATABASE_URL
```

### Port Already in Use
```
# Find what's using port
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows

# Kill process
kill -9 <PID>
```

## Contributing

1. Create feature branch: `git checkout -b feature/xxx`
2. Commit changes: `git commit -m "Add xxx"`
3. Push: `git push origin feature/xxx`
4. Create pull request

## License

Apache 2.0 - See LICENSE file

## Support

For issues, check:
1. `.env` configuration
2. Docker logs: `docker-compose logs <service>`
3. Database health: `docker exec gito-postgres pg_isready -U gito`
4. API docs: http://localhost:8000/api/docs

---

**Built with:** FastAPI, Next.js, PostgreSQL, TimescaleDB, Mosquitto, Docker

**Status:** Phase 1 - Foundation Complete ✅
