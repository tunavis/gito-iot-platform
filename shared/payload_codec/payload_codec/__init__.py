"""payload_codec — declarative LoRaWAN payload decoder for the Gito platform.

Pure Python, no code execution. Used by both the API and the ingest processor
when a device's network server hasn't decoded the uplink itself (no NS
`object`). Phase 1 of the platform-side decoding plan — see
docs/superpowers/plans/2026-07-07-payload-decoding.md.
"""

from .engine import decode, encode

__all__ = ["decode", "encode"]
