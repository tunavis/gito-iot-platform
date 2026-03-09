#!/bin/bash
set -e

echo "🚀 Starting Gito IoT API..."

# Run Alembic migrations with retry (TimescaleDB restarts Postgres on first boot)
echo "🔧 Running database migrations..."
MAX_RETRIES=5
RETRY=0
until alembic upgrade head; do
    RETRY=$((RETRY + 1))
    if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
        echo "❌ Migration failed after $MAX_RETRIES attempts"
        exit 1
    fi
    echo "⏳ Migration failed (attempt $RETRY/$MAX_RETRIES) — retrying in 10s..."
    sleep 10
done
echo "✅ Migrations complete"

# Start API
echo "🌐 Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --log-level info