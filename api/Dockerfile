FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY api/pyproject.toml .
COPY api/app ./app
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# Copy Alembic migrations
COPY api/alembic ./alembic
COPY api/alembic.ini ./alembic.ini

# Copy entrypoint script
COPY api/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create non-root user
RUN useradd -m -u 1000 gito && chown -R gito:gito /app
USER gito

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Start application with migration entrypoint
CMD ["./entrypoint.sh"]
