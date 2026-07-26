# Build context is the REPO ROOT (see docker-compose.yml) so shared/ is visible.
FROM python:3.11-slim

# Unbuffered stdout — without this, logging is block-buffered and `docker logs`
# ran up to 3 days behind, so the crash that killed ingestion was invisible.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY processor/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Shared alarm evaluation library (same engine as the API — never diverge)
COPY shared/alarm_core /opt/alarm_core
RUN pip install --no-cache-dir /opt/alarm_core

# Shared payload decoder library (same declarative decoder as the API — never diverge)
COPY shared/payload_codec /opt/payload_codec
RUN pip install --no-cache-dir /opt/payload_codec

# Copy application code
COPY processor/mqtt_processor.py .

# Health check: verify THIS process still holds a live MQTT subscription.
# It used to TCP-connect to the broker instead, which reports the broker's
# health, not the processor's — it stayed green through a 43h ingestion outage.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import os,sys,time; f=os.getenv('MQTT_HEARTBEAT_FILE','/tmp/mqtt_alive'); sys.exit(0 if os.path.exists(f) and time.time()-os.path.getmtime(f) < 60 else 1)"

# Run the processor
CMD ["python", "mqtt_processor.py"]
