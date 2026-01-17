.PHONY: dev prod stop logs clean

# Development mode - with hot reload
dev:
	@echo "🚀 Starting DEVELOPMENT mode..."
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
	@echo "✅ Services starting..."
	@echo "   Web:  http://localhost:3000"
	@echo "   API:  http://localhost:8000/api/docs"
	@echo ""
	@echo "📝 Logs: make logs"

# Production mode - optimized builds
prod:
	@echo "🚀 Starting PRODUCTION mode..."
	docker compose up -d --build
	@echo "✅ Services starting..."

# Stop all services
stop:
	@echo "⏹️  Stopping services..."
	docker compose down

# View logs
logs:
	docker compose logs -f api web

# Clean restart (remove volumes)
clean:
	@echo "🧹 Cleaning up..."
	docker compose down -v
	@echo "✅ Clean complete"

# Rebuild API only (for quick fixes)
rebuild-api:
	@echo "🔨 Rebuilding API..."
	docker compose build api
	docker compose up -d api
	@echo "✅ API rebuilt"

# Check status
status:
	docker compose ps
