"""Provider-specific LoRaWAN uplink parsers.

Each parser accepts a raw JSON dict from a network server webhook and returns
a NormalizedUplink — a common format consumed by the lorawan_ingest router.

Returns None if the payload is structurally invalid for that provider.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

PROVIDERS = ("chirpstack", "ttn", "helium", "actility", "custom")


@dataclass
class NormalizedUplink:
    dev_eui: str                          # 16-char hex, lower-cased
    metrics: dict[str, Any]              # {"temperature": 25.5, ...}
    dedup_id: str                         # provider-unique string for deduplication
    radio: dict[str, Any] = field(default_factory=dict)  # optional radio metadata
    raw_payload: str | None = None        # base64 raw LoRa payload (for debugging)


def _safe_float(val: Any) -> float | None:
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_int(val: Any) -> int | None:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# ChirpStack v4
# ---------------------------------------------------------------------------

def parse_chirpstack(body: dict) -> NormalizedUplink | None:
    """Parse a ChirpStack v4 uplink webhook payload.

    ChirpStack sends decoded sensor data in body["object"].
    Radio info is in body["rxInfo"][0] (best gateway = first entry).
    """
    device_info = body.get("deviceInfo") or {}
    dev_eui = device_info.get("devEui") or body.get("devEui")
    if not dev_eui:
        logger.warning("chirpstack: missing deviceInfo.devEui")
        return None

    metrics = body.get("object")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("chirpstack: missing or empty 'object' field — configure a codec in ChirpStack")
        return None

    dedup_id = body.get("deduplicationId") or dev_eui + str(body.get("fCnt", ""))

    radio: dict[str, Any] = {}
    rx_info = body.get("rxInfo") or []
    if rx_info:
        best = rx_info[0]
        if (rssi := _safe_float(best.get("rssi"))) is not None:
            radio["rssi"] = rssi
        if (snr := _safe_float(best.get("snr"))) is not None:
            radio["snr"] = snr
        if gw := best.get("gatewayId"):
            radio["gateway_id"] = gw

    tx_info = body.get("txInfo") or {}
    if (freq := _safe_float(tx_info.get("frequency"))) is not None:
        radio["frequency"] = freq
    lora = (tx_info.get("modulation") or {}).get("lora") or {}
    if (sf := _safe_int(lora.get("spreadingFactor"))) is not None:
        radio["spreading_factor"] = sf
    if (fc := _safe_int(body.get("fCnt"))) is not None:
        radio["frame_count"] = fc
    if (dr := _safe_int(body.get("dr"))) is not None:
        radio["data_rate"] = dr

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=body.get("data"),
    )


# ---------------------------------------------------------------------------
# The Things Network v3 (The Things Stack)
# ---------------------------------------------------------------------------

def parse_ttn(body: dict) -> NormalizedUplink | None:
    """Parse a TTN v3 (The Things Stack) uplink webhook payload."""
    ids = body.get("end_device_ids") or {}
    dev_eui = ids.get("dev_eui")
    if not dev_eui:
        logger.warning("ttn: missing end_device_ids.dev_eui")
        return None

    uplink = body.get("uplink_message") or {}
    metrics = uplink.get("decoded_payload")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("ttn: missing or empty uplink_message.decoded_payload — configure a payload formatter in TTN")
        return None

    correlation_ids = body.get("correlation_ids") or []
    dedup_id = correlation_ids[0] if correlation_ids else dev_eui + str(uplink.get("f_cnt", ""))

    radio: dict[str, Any] = {}
    rx_meta = uplink.get("rx_metadata") or []
    if rx_meta:
        best = rx_meta[0]
        if (rssi := _safe_float(best.get("rssi"))) is not None:
            radio["rssi"] = rssi
        if (snr := _safe_float(best.get("snr"))) is not None:
            radio["snr"] = snr
        gw_ids = (best.get("gateway_ids") or {})
        if gw := gw_ids.get("gateway_id"):
            radio["gateway_id"] = gw

    settings = uplink.get("settings") or {}
    if (freq := _safe_float(settings.get("frequency"))) is not None:
        radio["frequency"] = freq
    lora = (settings.get("data_rate") or {}).get("lora") or {}
    if (sf := _safe_int(lora.get("spreading_factor"))) is not None:
        radio["spreading_factor"] = sf
    if (fc := _safe_int(uplink.get("f_cnt"))) is not None:
        radio["frame_count"] = fc

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=uplink.get("frm_payload"),
    )


# ---------------------------------------------------------------------------
# Helium
# ---------------------------------------------------------------------------

def parse_helium(body: dict) -> NormalizedUplink | None:
    """Parse a Helium Console HTTP integration uplink payload."""
    dev_eui = body.get("dev_eui")
    if not dev_eui:
        logger.warning("helium: missing dev_eui")
        return None

    decoded = body.get("decoded") or {}
    metrics = decoded.get("payload")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("helium: missing or empty decoded.payload — configure a function decoder in Helium")
        return None

    dedup_id = body.get("id") or dev_eui + str(body.get("fcnt", ""))

    radio: dict[str, Any] = {}
    hotspots = body.get("hotspots") or []
    if hotspots:
        best = hotspots[0]
        if (rssi := _safe_float(best.get("rssi"))) is not None:
            radio["rssi"] = rssi
        if (snr := _safe_float(best.get("snr"))) is not None:
            radio["snr"] = snr
        if name := best.get("name"):
            radio["gateway_id"] = name
        if (freq := _safe_float(best.get("frequency"))) is not None:
            radio["frequency"] = freq * 1_000_000  # MHz → Hz
        if (sf := _safe_int(best.get("spreading_factor"))) is not None:
            radio["spreading_factor"] = sf

    if (fc := _safe_int(body.get("fcnt"))) is not None:
        radio["frame_count"] = fc

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=body.get("payload"),
    )


# ---------------------------------------------------------------------------
# Actility ThingPark
# ---------------------------------------------------------------------------

def parse_actility(body: dict) -> NormalizedUplink | None:
    """Parse an Actility ThingPark uplink webhook payload."""
    uplink = body.get("DevEUI_uplink") or {}
    dev_eui = uplink.get("DevEUI")
    if not dev_eui:
        logger.warning("actility: missing DevEUI_uplink.DevEUI")
        return None

    # Actility sends hex-encoded payload; decoded metrics come from a custom AS
    # If a decoded 'payload_cleartext' dict is present, use it; else warn.
    metrics = uplink.get("payload_cleartext")
    if not metrics or not isinstance(metrics, dict):
        logger.warning(
            "actility: missing payload_cleartext dict — configure an Application Server decoder in ThingPark"
        )
        return None

    fc = _safe_int(uplink.get("FCntUp"))
    dedup_id = f"{dev_eui}:{fc}" if fc is not None else dev_eui

    radio: dict[str, Any] = {}
    if (rssi := _safe_float(uplink.get("LrrRSSI"))) is not None:
        radio["rssi"] = rssi
    if (snr := _safe_float(uplink.get("LrrSNR"))) is not None:
        radio["snr"] = snr
    if gw := uplink.get("Lrrid"):
        radio["gateway_id"] = gw
    if fc is not None:
        radio["frame_count"] = fc

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio,
        raw_payload=uplink.get("payload_hex"),
    )


# ---------------------------------------------------------------------------
# Custom / Other — escape hatch for any LNS
# ---------------------------------------------------------------------------

def parse_custom(body: dict) -> NormalizedUplink | None:
    """Parse a custom/generic uplink payload.

    Expected format:
        {"dev_eui": "0102030405060708", "metrics": {"temperature": 25.5}}
    Optional:
        {"radio": {"rssi": -90, "snr": 7.5}, "dedup_id": "unique-string"}
    """
    dev_eui = body.get("dev_eui")
    if not dev_eui:
        logger.warning("custom: missing 'dev_eui' field")
        return None

    metrics = body.get("metrics")
    if not metrics or not isinstance(metrics, dict):
        logger.warning("custom: missing or empty 'metrics' dict")
        return None

    radio = body.get("radio") or {}
    dedup_id = body.get("dedup_id") or dev_eui + str(body.get("timestamp", ""))

    return NormalizedUplink(
        dev_eui=dev_eui.lower(),
        metrics=metrics,
        dedup_id=dedup_id,
        radio=radio if isinstance(radio, dict) else {},
    )


# ---------------------------------------------------------------------------
# Parser registry
# ---------------------------------------------------------------------------

PARSERS: dict[str, Any] = {
    "chirpstack": parse_chirpstack,
    "ttn": parse_ttn,
    "helium": parse_helium,
    "actility": parse_actility,
    "custom": parse_custom,
}


def get_parser(provider: str):
    """Return the parser function for a given provider string.

    Raises KeyError if provider is unknown.
    """
    return PARSERS[provider]
