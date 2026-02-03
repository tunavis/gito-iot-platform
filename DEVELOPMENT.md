# Development Workflow

## 🚀 Recommended Daily Workflow

### **Frontend Development** (Fastest - Use This!)
```powershell
# 1. Start backend infrastructure (once per session)
docker compose up -d postgres api mosquitto processor keydb

# 2. Run frontend in dev mode with hot reload
cd web
npm run dev
# Access: http://localhost:3000
# Changes auto-reload instantly!
```

### **Before Every Commit** ⚠️ IMPORTANT
```powershell
# Run validation from project root
.\validate-before-commit.ps1

# This catches TypeScript/ESLint errors BEFORE pushing to CI/CD
# Saves time by not triggering failed builds!
```

### **Full Docker Build** (Optional - for major changes)
```powershell
# Test the production build locally
docker build -t gito-web-test -f web/Dockerfile web/
```

---

## Quick Start

### Development Mode (Hot Reload - RECOMMENDED)
**Use this for active development** - code changes reflect instantly without rebuilds.

```bash
# Start all services in dev mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Or rebuild web container if dependencies changed
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build web

# Stop services
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

**What you get:**
- ✅ **Instant hot reload** - edit files, see changes in seconds
- ✅ **No rebuilds needed** - source code mounted as volumes
- ✅ **Debug mode** - detailed logs, better error messages
- ✅ **Fast iteration** - change → save → refresh browser

### Production Mode (Optimized Build)
**Use this for testing production configuration** - slower, but exact production behavior.

```bash
# Start all services in production mode
docker compose up

# Rebuild if needed
docker compose up --build

# Stop services
docker compose down
```

**What you get:**
- ✅ **Optimized bundles** - minified, tree-shaken code
- ✅ **Production behavior** - exact same as deployment
- ⚠️ **Slow rebuilds** - every code change requires full rebuild (2-3 minutes)

---

## Development Mode Details

### Services with Hot Reload
- **API (FastAPI)**: Auto-reloads on `.py` file changes
- **Web (Next.js)**: Hot Module Replacement (HMR) on `.tsx`/`.ts`/`.css` changes
- **Processor**: Auto-reloads on `.py` file changes

### Volume Mounts
Your local files are mounted into containers:
```
./api       → /app (API container)
./web/src   → /app/src (Web container)
./processor → /app (Processor container)
```

Any changes to these directories reflect immediately in the running containers.

### When to Rebuild
You only need to rebuild if you:
- Add/remove npm packages (`package.json` changed)
- Add/remove Python packages (`requirements.txt` changed)
- Change Dockerfile or docker-compose configuration

Rebuild single service:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build web
```

---

## Workflow Examples

### Example 1: UI Changes (No Rebuild)
```bash
# 1. Start dev mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# 2. Edit frontend file
# Edit: web/src/app/dashboard/page.tsx

# 3. Save file → Browser auto-refreshes in ~1 second
# No commands needed!
```

### Example 2: API Changes (No Rebuild)
```bash
# 1. Start dev mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# 2. Edit API file
# Edit: api/app/routers/devices.py

# 3. Save file → FastAPI auto-reloads in ~1 second
# No commands needed!
```

### Example 3: Adding npm Package (Rebuild Required)
```bash
# 1. Stop containers
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# 2. Add package to package.json or run npm install locally
cd web
npm install <package-name>

# 3. Rebuild web container
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build web
```

---

## Logs and Debugging

### View Logs
```bash
# All services
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

# Single service
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f web
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api
```

### Attach to Container
```bash
docker exec -it gito-web sh
docker exec -it gito-api bash
```

### Check Service Status
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

---

## Troubleshooting

### "Port already in use"
```bash
# Check what's using the port
netstat -ano | findstr :3000

# Stop all containers
docker compose down
```

### "Module not found" Error
Rebuild the container (dependency missing):
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build web
```

### Changes Not Reflecting
1. Verify volume mounts are working:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml config
   ```
2. Check container logs for errors:
   ```bash
   docker compose logs -f web
   ```
3. Hard refresh browser: `Ctrl+Shift+R` or `Ctrl+F5`

### Slow Performance on Windows
Docker Desktop on Windows can be slow with volume mounts. If performance is an issue:
- Use WSL2 backend (Settings → General → Use WSL2)
- Move project to WSL2 filesystem: `\\wsl$\Ubuntu\home\<user>\projects\`

---

## Quick Commands Cheatsheet

```bash
# Development (hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d  # Detached mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Production (optimized)
docker compose up
docker compose down

# Rebuild single service
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build web

# View logs
docker compose logs -f web
docker compose logs -f api

# Restart single service
docker compose restart web

# Clean everything (nuclear option)
docker compose down -v  # Removes volumes too
docker system prune -a  # Removes all unused images
```

---

## Recommended Workflow

**Daily Development:**
1. Start: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
2. Code in your editor (VSCode, etc.)
3. Save files → Changes reflect automatically
4. Stop when done: `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`

**Before Committing:**
1. Test in production mode: `docker compose up --build`
2. Verify everything works
3. Run tests (if any)
4. Commit changes

**Alias for Convenience (optional):**
Add to your PowerShell profile (`$PROFILE`):
```powershell
function dcdev { docker compose -f docker-compose.yml -f docker-compose.dev.yml $args }
```
Then use: `dcdev up`, `dcdev down`, `dcdev logs -f web`
