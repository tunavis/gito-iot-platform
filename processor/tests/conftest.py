"""
Stub out heavy dependencies before any test module imports mqtt_processor.
aiomqtt, redis, psycopg etc. are not installed in the test environment — only
the pure-Python classes (TelemetryValidator, AlertEvaluator) are tested here.
"""
import sys
from unittest.mock import MagicMock

# Stub every external dependency the module imports at the top level.
for mod in [
    "aiomqtt",
    "redis",
    "redis.asyncio",
    "psycopg",
    "psycopg.rows",
    "psycopg_pool",
]:
    sys.modules.setdefault(mod, MagicMock())