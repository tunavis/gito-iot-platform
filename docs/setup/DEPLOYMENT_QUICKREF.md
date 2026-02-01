# GITO IoT Platform - Deployment Quick Reference

## 🚀 Fastest Start (One Command)

**Windows PowerShell:**
```powershell
cd C:\Users\mmarais\Documents\Personal\project\IOT
.\deploy-local.ps1
```

**Windows CMD:**
```cmd
cd C:\Users\mmarais\Documents\Personal\project\IOT
docker-compose up -d
docker-compose logs -f
```

**Result**: All 9 services running in ~2 minutes

---

## 📱 Access Services

| Service | URL | Username | Password |
|---------|-----|----------|----------|
| Frontend | http://localhost:3000 | — | — |
| API Docs | http://localhost:8000/api/docs | — | — |
| API Health | http://localhost:8000/api/health | — | — |
| Cadence Web | http://localhost:8088 | — | — |
| MQTT Broker | localhost:1883 | admin | (from .env) |

---

## 📋 Pre-Deployment Checklist

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Edit .env (important values)
# - DB_PASSWORD: Change to random password
# - JWT_SECRET_KEY: 32+ character random string
# - MQTT_PASSWORD: Random password
# - SMTP_* settings: Configure for email (optional)

# 3. Verify Docker
docker --version          # Should be 20.10+
docker-compose --version  # Should be 2.0+

# 4. Check available resources
docker info | grep "Memory"  # Should have 4GB+ available
```

---

## 🔧 Deployment Commands

### Phase-by-Phase Start (Recommended for first time)
```bash
# Phase 1: Database
docker-compose up -d postgres
docker-compose exec postgres pg_isready -U gito -d gito

# Phase 2: Cache & Message Broker
docker-compose up -d keydb mosquitto

# Phase 3: Applications
docker-compose up -d processor api web

# Phase 4: Workflows & Proxy
docker-compose up -d cadence cadence-web nginx
```

### One-Command Deploy
```bash
docker-compose up -d
```

### Full Rebuild (if code changed)
```bash
docker-compose build --no-cache
docker-compose up -d
```

### Check Status
```bash
docker-compose ps

# Detailed status
docker-compose ps -a
docker stats
```

---

## 📊 Verify Services

```bash
# All services
docker-compose ps

# Individual services
docker-compose exec postgres pg_isready -U gito -d gito
docker-compose exec keydb keydb-cli ping
curl http://localhost:8000/api/health
curl -I http://localhost:3000
curl http://localhost:7933/api/v1/domain

# Check logs
docker-compose logs -f                    # All
docker-compose logs -f api                # API only
docker-compose logs -f processor          # MQTT Processor
docker-compose logs -f web                # Frontend
docker-compose logs postgres | tail -20   # Last 20 lines

# Resource usage
docker stats
docker stats gito-api gito-postgres
```

---

## 🧪 Test Core Functionality

### 1. Create a Tenant
```bash
curl -X POST http://localhost:8000/api/v1/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Tenant",
    "description": "For testing"
  }'

# Save the returned tenant_id
```

### 2. Create a Device
```bash
curl -X POST http://localhost:8000/api/v1/tenants/{tenant_id}/devices \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Device",
    "device_type": "sensor",
    "location": "Office"
  }'

# Save the returned device_id
```

### 3. Publish MQTT Telemetry
```bash
docker-compose exec mosquitto mosquitto_pub \
  -h mosquitto \
  -u admin \
  -P $(grep "MQTT_PASSWORD=" .env | cut -d= -f2) \
  -t "tenant_id/devices/device_id/telemetry" \
  -m '{"temperature": 22.5, "humidity": 65, "pressure": 1013}'
```

### 4. Query Telemetry
```bash
curl "http://localhost:8000/api/v1/tenants/tenant_id/devices/device_id/telemetry?start_time=2026-01-01T00:00:00Z"
```

### 5. Create Alert Rule
```bash
curl -X POST http://localhost:8000/api/v1/alert-rules \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "device_id",
    "metric": "temperature",
    "operator": ">",
    "threshold": 25,
    "cooldown_minutes": 5,
    "active": true
  }'
```

---

## 🛑 Stop & Cleanup

```bash
# Stop all services (keep data)
docker-compose down

# Stop and remove volumes (wipe data)
docker-compose down -v

# Stop specific service
docker-compose stop api

# Restart specific service
docker-compose restart api

# Full reset (remove everything)
docker-compose down -v && docker-compose build --no-cache && docker-compose up -d
```

---

## 🐛 Troubleshooting

### Service Won't Start
```bash
# Check logs
docker-compose logs service-name

# Check if ports are available
netstat -ano | findstr :8000
netstat -ano | findstr :3000

# Rebuild service
docker-compose build --no-cache service-name
docker-compose up -d service-name
```

### Database Connection Failed
```bash
# Check database is ready
docker-compose exec postgres pg_isready -U gito

# Check password in .env
grep "DB_PASSWORD=" .env

# Restart database
docker-compose restart postgres
docker-compose up -d api processor
```

### API/Frontend Not Responding
```bash
# Test connectivity
curl http://localhost:8000/api/health -v
curl http://localhost:3000 -v

# Check health
docker-compose ps api web

# Restart services
docker-compose restart api web
```

### MQTT Not Accepting Messages
```bash
# Test connection
docker-compose exec mosquitto mosquitto_sub -h mosquitto -u admin -P admin-password -t "test"

# Check broker logs
docker-compose logs mosquitto

# Verify credentials
grep "MQTT_" .env
```

### High Memory Usage
```bash
# Check which container uses most memory
docker stats --no-stream

# Restart everything
docker-compose down && docker-compose up -d

# Or stop memory-hungry service
docker-compose stop api
docker-compose stop web
```

---

## 📈 Performance Checks

```bash
# Response time (API should be <200ms)
for i in {1..5}; do time curl -s http://localhost:8000/api/health > /dev/null; done

# Database query speed
docker-compose exec postgres psql -U gito -d gito -c "EXPLAIN ANALYZE SELECT * FROM devices LIMIT 1;"

# MQTT message throughput
docker-compose logs processor | grep "Telemetry processed" | wc -l

# Memory usage (should be <3GB total)
docker stats --no-stream | tail -10
```

---

## 🔐 Security Checklist

```bash
# ✓ Change database password
sed -i 's/dev-password/YourSecurePassword/g' .env

# ✓ Change MQTT password
sed -i 's/admin-password/MqttSecurePassword/g' .env

# ✓ Generate strong JWT secret
# Windows PowerShell:
[System.Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))

# ✓ Enable MQTT TLS (production)
# Edit mosquitto/mosquitto.conf and mount certificates

# ✓ Don't commit .env
echo ".env" >> .gitignore

# ✓ Verify database isolation
docker-compose exec postgres psql -U gito -d gito -c "SELECT * FROM pg_policies;"
```

---

## 📝 Log Files & Debugging

```bash
# Real-time logs
docker-compose logs -f

# Last N lines
docker-compose logs api --tail 50

# Since specific time
docker-compose logs --since 2m api

# Save logs to file
docker-compose logs > deployment.log 2>&1

# Search logs
docker-compose logs | grep "error"
docker-compose logs | grep "temperature"
```

---

## 🚀 Next After Deployment

1. **Load Test**: Publish 100+ messages/sec
2. **Create Backup**: `docker-compose exec postgres pg_dump -U gito gito > backup.sql`
3. **Monitor**: `docker stats` in separate terminal
4. **Test OTA**: Upload firmware and test Cadence workflow
5. **Production Deploy**: Follow PRODUCTION_DEPLOYMENT guide

---

## 🆘 Getting Help

**Check logs first:**
```bash
docker-compose logs service-name
```

**Common error patterns:**
- `Connection refused` → Service not started, wait longer
- `Database connection failed` → Check .env password
- `Port already in use` → Change port in docker-compose.yml
- `Out of memory` → Increase Docker Desktop memory limit

**Verify all prerequisites:**
```bash
docker --version
docker-compose --version
docker images | grep gito
docker-compose config --services
```

---

## 📞 Support Resources

- **API Docs**: http://localhost:8000/api/docs (Swagger)
- **Cadence Workflows**: http://localhost:8088
- **Database Admin**: `docker-compose exec postgres psql -U gito -d gito`
- **MQTT Logs**: `docker-compose logs mosquitto`

---

**Last Updated**: January 14, 2026  
**Status**: Production Ready
