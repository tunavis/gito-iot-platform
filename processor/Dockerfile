# Build context is the REPO ROOT (see docker-compose.yml) so shared/ is visible.
FROM python:3.11-slim

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

# Copy application code
COPY processor/mqtt_processor.py .

# Health check: verify MQTT broker is reachable using configured env vars
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import socket,os; socket.create_connection((os.getenv('MQTT_BROKER','mosquitto'),int(os.getenv('MQTT_PORT',1883))),timeout=5)" || exit 1

# Run the processor
CMD ["python", "mqtt_processor.py"]
