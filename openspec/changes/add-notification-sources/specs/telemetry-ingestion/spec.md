## MODIFIED Requirements

### Requirement: A detected ingestion stall is delivered, not only logged
When fleet-wide ingestion transitions into or out of a stalled state, the
platform SHALL raise a notification for that transition in addition to logging
it.

Stall detection already works and already sees what per-device offline detection
structurally cannot — the ingest path itself dying, where every device goes
offline correctly and no single device looks wrong. Its entire output was a log
line, marked in the source as a known ceiling. A dropped MQTT subscription ate
43 hours of telemetry across all 68 devices unnoticed, and an 11-hour outage
repeated it. The detector was never the missing piece; delivery was.

#### Scenario: The fleet goes silent
- **WHEN** ingestion transitions from receiving to stalled
- **THEN** one notification is raised describing the stall

#### Scenario: Ingestion recovers
- **WHEN** ingestion transitions from stalled back to receiving
- **THEN** one notification is raised saying so

A stall reported with no matching recovery teaches the reader to ignore the
channel, because a live incident and an old one look identical.

#### Scenario: A stall persists across many checks
- **WHEN** the stall check runs repeatedly while the fleet stays silent
- **THEN** no further notification is raised, because the state has not changed

#### Scenario: A fresh deployment
- **WHEN** no device has ever reported
- **THEN** no stall notification is raised — that is an idle platform, not a
  fault

#### Scenario: Detection survives a failure to notify
- **WHEN** raising the notification fails
- **THEN** the stall is still detected, recorded and reflected in health output
