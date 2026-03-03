FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY mqtt_processor.py .

# Health check: verify MQTT broker is reachable using configured env vars
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import socket,os; socket.create_connection((os.getenv('MQTT_BROKER','mosquitto'),int(os.getenv('MQTT_PORT',1883))),timeout=5)" || exit 1

# Run the processor
CMD ["python", "mqtt_processor.py"]
