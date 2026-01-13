FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY pyproject.toml .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir fastapi uvicorn sqlalchemy asyncpg psycopg pydantic pydantic-settings pyjwt passlib python-multipart python-dotenv redis tenacity paho-mqtt httpx pydantic-extra-types python-jose email-validator

# Copy application code
COPY app ./app

# Create non-root user
RUN useradd -m -u 1000 gito && chown -R gito:gito /app
USER gito

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Start application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
