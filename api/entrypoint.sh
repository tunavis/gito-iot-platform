#!/bin/bash
set -e

echo "🚀 Starting Gito IoT API..."

# Run migrations from SQL on first start
if [ -f "/app/db/init.sql" ]; then
    echo "🔧 Initializing database..."
    python /app/db/init_db.py || echo "Database already initialized"
fi

# Start API
echo "🌐 Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --log-level info
