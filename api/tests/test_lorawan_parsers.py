"""Unit tests for LoRaWAN provider parsers."""

import pytest
from app.services.lorawan_parsers import (
    parse_chirpstack, parse_ttn, parse_helium, parse_actility, parse_custom,
    get_parser, PROVIDERS,
)

# --- ChirpStack ---

def test_parse_chirpstack_happy_path():
    body = {
        "deduplicationId": "abc123",
        "deviceInfo": {"devEui": "0102030405060708"},
        "fCnt": 5,
        "dr": 3,
        "object": {"temperature": 24.5, "humidity": 61},
        "rxInfo": [{"rssi": -80, "snr": 9.5, "gatewayId": "gw-001"}],
        "txInfo": {
            "frequency": 868100000,
            "modulation": {"lora": {"spreadingFactor": 7}},
        },
    }
    result = parse_chirpstack(body)
    assert result is not None
    assert result.dev_eui == "0102030405060708"
    assert result.metrics == {"temperature": 24.5, "humidity": 61}
    assert result.dedup_id == "abc123"
    assert result.radio["rssi"] == -80
    assert result.radio["snr"] == 9.5
    assert result.radio["gateway_id"] == "gw-001"
    assert result.radio["frequency"] == 868100000
    assert result.radio["spreading_factor"] == 7
    assert result.radio["frame_count"] == 5
    assert result.radio["data_rate"] == 3


def test_parse_chirpstack_no_deveui_returns_none():
    result = parse_chirpstack({"object": {"temperature": 24.5}})
    assert result is None


def test_parse_chirpstack_no_object_returns_none():
    result = parse_chirpstack({"deviceInfo": {"devEui": "abc123"}})
    assert result is None


def test_parse_chirpstack_empty_rxinfo():
    body = {
        "deviceInfo": {"devEui": "0102030405060708"},
        "object": {"temperature": 24.5},
        "rxInfo": [],
    }
    result = parse_chirpstack(body)
    assert result is not None
    assert result.radio == {}


def test_parse_chirpstack_dev_eui_lowercased():
    body = {
        "deviceInfo": {"devEui": "AABBCCDD11223344"},
        "object": {"temp": 20},
        "rxInfo": [],
    }
    result = parse_chirpstack(body)
    assert result.dev_eui == "aabbccdd11223344"


# --- TTN ---

def test_parse_ttn_happy_path():
    body = {
        "end_device_ids": {"dev_eui": "AABB112233445566"},
        "correlation_ids": ["corr-id-001"],
        "uplink_message": {
            "f_cnt": 10,
            "decoded_payload": {"level": 85.0},
            "rx_metadata": [{
                "rssi": -95,
                "snr": 6.0,
                "gateway_ids": {"gateway_id": "my-gateway"},
            }],
            "settings": {
                "frequency": "868100000",
                "data_rate": {"lora": {"spreading_factor": 9}},
            },
        },
    }
    result = parse_ttn(body)
    assert result is not None
    assert result.dev_eui == "aabb112233445566"
    assert result.metrics == {"level": 85.0}
    assert result.dedup_id == "corr-id-001"
    assert result.radio["rssi"] == -95
    assert result.radio["snr"] == 6.0
    assert result.radio["gateway_id"] == "my-gateway"
    assert result.radio["frame_count"] == 10


def test_parse_ttn_no_decoded_payload_returns_none():
    body = {
        "end_device_ids": {"dev_eui": "AABB112233445566"},
        "uplink_message": {},
    }
    assert parse_ttn(body) is None


# --- Helium ---

def test_parse_helium_happy_path():
    body = {
        "dev_eui": "CCDD556677889900",
        "id": "helium-dedup-001",
        "fcnt": 7,
        "decoded": {"payload": {"flow_rate": 12.3}},
        "hotspots": [{"rssi": -100, "snr": 4.0, "name": "hot-spot-1", "frequency": 868.1, "spreading_factor": 10}],
        "payload": "base64abc",
    }
    result = parse_helium(body)
    assert result is not None
    assert result.dev_eui == "ccdd556677889900"
    assert result.metrics == {"flow_rate": 12.3}
    assert result.dedup_id == "helium-dedup-001"
    assert result.radio["rssi"] == -100
    assert result.radio["frequency"] == pytest.approx(868100000.0)


def test_parse_helium_no_decoded_returns_none():
    body = {"dev_eui": "CCDD556677889900"}
    assert parse_helium(body) is None


# --- Actility ---

def test_parse_actility_happy_path():
    body = {
        "DevEUI_uplink": {
            "DevEUI": "EEFF001122334455",
            "FCntUp": 3,
            "LrrRSSI": -85.0,
            "LrrSNR": 8.0,
            "Lrrid": "actility-gw-01",
            "payload_cleartext": {"pressure": 1013.25},
        }
    }
    result = parse_actility(body)
    assert result is not None
    assert result.dev_eui == "eeff001122334455"
    assert result.metrics == {"pressure": 1013.25}
    assert result.radio["rssi"] == -85.0
    assert result.radio["frame_count"] == 3


def test_parse_actility_no_decoded_returns_none():
    body = {"DevEUI_uplink": {"DevEUI": "EEFF001122334455"}}
    assert parse_actility(body) is None


# --- Custom ---

def test_parse_custom_happy_path():
    body = {
        "dev_eui": "1122334455667788",
        "metrics": {"co2": 420, "voc": 15},
        "radio": {"rssi": -70},
        "dedup_id": "my-dedup",
    }
    result = parse_custom(body)
    assert result is not None
    assert result.dev_eui == "1122334455667788"
    assert result.metrics == {"co2": 420, "voc": 15}
    assert result.dedup_id == "my-dedup"
    assert result.radio["rssi"] == -70


def test_parse_custom_missing_dev_eui_returns_none():
    assert parse_custom({"metrics": {"temp": 20}}) is None


def test_parse_custom_missing_metrics_returns_none():
    assert parse_custom({"dev_eui": "abc"}) is None


# --- Registry ---

def test_get_parser_returns_correct_function():
    assert get_parser("chirpstack") is parse_chirpstack
    assert get_parser("ttn") is parse_ttn
    assert get_parser("helium") is parse_helium
    assert get_parser("actility") is parse_actility
    assert get_parser("custom") is parse_custom


def test_get_parser_unknown_raises_key_error():
    with pytest.raises(KeyError):
        get_parser("unknown_lns")
