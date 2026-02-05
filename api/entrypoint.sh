#!/bin/bash
set -e

echo "🚀 Starting Gito IoT API..."

# Run Alembic migrations
echo "🔧 Running database migrations..."
alembic upgrade head

# Start API
echo "🌐 Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --log-level info
