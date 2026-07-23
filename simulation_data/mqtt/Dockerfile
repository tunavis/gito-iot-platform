FROM python:3.10-slim

WORKDIR /app

# Shared library (same one api/processor install) — for the LoRaWAN
# publisher's encode() call. Build context is the repo root so this path
# resolves; requirements.txt's own editable reference only works when run
# from the host (simulation_data/mqtt as cwd), not inside the image.
COPY shared/payload_codec /opt/payload_codec
RUN pip install --no-cache-dir /opt/payload_codec

COPY simulation_data/mqtt/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY simulation_data/mqtt/. .

EXPOSE 5555

CMD ["python", "bridge_ui.py"]
