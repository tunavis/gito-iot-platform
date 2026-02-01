# Phase 3 Deferred Items - Implementation Backlog

**Status**: Deferred for later implementation (Phase 3.2+)  
**Last Updated**: January 13, 2026

## 📋 Deferred Items (Nice-to-Have Features)

These items are valuable but NOT on the critical path for Phase 3. They will be implemented after the core OTA and ChirpStack integration are production-ready.

### 1. Advanced Alert Rules ⏳
**Priority**: Medium  
**Effort**: 4-5 hours  
**Business Value**: Enhanced alert flexibility

**Description**:
- Support composite conditions (AND/OR logic)
- Time-based alerts (business hours only, maintenance windows)
- Aggregate alerts (alert if 3+ devices breach threshold)
- Alert escalation workflows (SMS after 2 emails, PagerDuty)
- Alert suppression during maintenance

**Why Deferred**:
- Basic threshold alerts work for MVP
- Can be added after core features stabilize
- Requires complex rule engine design

**Implementation Notes**:
- Extend `alert_rules` table with rule_expression JSONB column
- Create rule evaluation engine in processor
- Add rule builder UI to dashboard

**Files to Create**:
- `api/app/services/alert_rules_engine.py` - Complex rule evaluation
- `api/app/routers/advanced_alerts.py` - Advanced rule API endpoints
- `web/src/components/AlertRuleBuilder.tsx` - UI for building rules

---

### 2. Multi-Channel Notifications 📱
**Priority**: Medium  
**Effort**: 3-5 hours  
**Business Value**: Customer choice in alert delivery

**Description**:
- SMS via Twilio (Apache 2.0 licensed)
- Slack integration (workspace notifications)
- Custom webhooks (POST to user-defined endpoints)
- PagerDuty integration (incident creation)
- Per-user notification preferences

**Why Deferred**:
- Email notifications are sufficient for MVP
- SMS/Slack are "polish" features
- Can integrate after core alerting works

**Implementation Notes**:
- Extend `notification_settings` table (already in schema)
- Create notification dispatcher service
- Add channel-specific adapters (EmailAdapter, SMSAdapter, SlackAdapter)
- Implement notification queue with retries

**Dependencies**:
- Twilio API key for SMS
- Slack workspace webhook URL
- PagerDuty API token

**Files to Create**:
- `api/app/services/notification_dispatcher.py` - Central notification system
- `api/app/services/channels/sms_channel.py` - Twilio integration
- `api/app/services/channels/slack_channel.py` - Slack webhook handler
- `api/app/services/channels/webhook_channel.py` - Custom webhook dispatcher
- `web/src/pages/notifications/preferences.tsx` - User notification settings UI

---

### 3. Grafana Dashboards 📊
**Priority**: Low  
**Effort**: 2-3 hours  
**Business Value**: Executive dashboards, 3rd-party analytics

**Description**:
- Deploy Grafana container in docker-compose
- Pre-built dashboards (device status, alert frequency, telemetry trends, SLA tracking)
- TimescaleDB data source integration
- Alert rule visualization
- Custom metric definitions

**Why Deferred**:
- Gito's native charts are sufficient for customers
- Grafana is "nice-to-have" for advanced users
- Can be added as optional deployment

**Implementation Notes**:
- Add `grafana` service to docker-compose
- Create Prometheus data source config
- Pre-build JSON dashboard files
- Create setup/provisioning scripts

**Files to Create**:
- `grafana/provisioning/datasources/prometheus.yml`
- `grafana/dashboards/device_status.json`
- `grafana/dashboards/alert_frequency.json`
- `grafana/dashboards/telemetry_trends.json`
- Documentation in `GRAFANA_SETUP.md`

---

### 4. Audit Logging System 📝
**Priority**: Low  
**Effort**: 3-4 hours  
**Business Value**: Compliance, security, troubleshooting

**Description**:
- Enhanced audit_log table (already created in schema)
- Track all user actions (create/update/delete device, change settings, etc.)
- GDPR compliance features (data export, right-to-deletion)
- SOC 2 readiness documentation
- Audit log search and filtering UI

**Why Deferred**:
- Basic operation logging is sufficient for MVP
- GDPR/SOC2 can be addressed when needed
- Not critical for core functionality

**Implementation Notes**:
- Create audit middleware in FastAPI
- Log all POST/PUT/DELETE operations automatically
- Implement data export service for GDPR compliance
- Create audit dashboard UI

**Files to Create**:
- `api/app/middleware/audit_middleware.py` - Automatic audit logging
- `api/app/services/gdpr_service.py` - Data export and deletion
- `api/app/routers/audit.py` - Audit log API endpoints
- `web/src/pages/audit-logs.tsx` - Audit log viewer UI

---

### 5. Performance Optimization 🚀
**Priority**: Low  
**Effort**: 4-6 hours  
**Business Value**: Scale to 100K+ devices

**Description**:
- Database query optimization and profiling
- Caching strategy (Redis for alert rules, device status)
- MQTT connection pooling
- API response compression
- WebSocket connection pool optimization
- Database time-series partitioning (monthly)

**Why Deferred**:
- Not needed until you hit scaling bottlenecks
- Premature optimization wastes effort
- Wait for real performance data from production

**Implementation Notes**:
- Use pg_stat_statements to identify slow queries
- Implement Redis caching layer
- Profile with Prometheus metrics
- Load test before/after optimization

**Files to Modify**:
- `api/app/config.py` - Performance settings
- `processor/mqtt_processor.py` - Connection pooling
- `api/app/database.py` - Query optimization
- Database migration for partitioning

---

## 📊 Implementation Sequence

### Phase 3.1 (Current) - CORE PATH
✅ OTA database schema
✅ OTA API models
✅ ChirpStack API client
✅ Firmware management service
⏳ Device API wiring
⏳ Cadence workflow engine
⏳ ChirpStack webhook handler

### Phase 3.2 (Next Sprint)
After Phase 3.1 is production-ready:
1. Advanced alert rules
2. Multi-channel notifications
3. Performance optimization for 10K+ devices

### Phase 3.3 (Polish)
After core features are stable:
1. Grafana dashboards
2. Audit logging system
3. Additional performance optimization

---

## ✅ Checklist for Later Implementation

When you're ready to tackle these items:

### Advanced Alert Rules
- [ ] Design rule expression JSON format
- [ ] Create rule evaluation engine
- [ ] Add rule builder UI
- [ ] Test complex rule scenarios
- [ ] Add rule testing/preview feature

### Multi-Channel Notifications
- [ ] Set up Twilio account
- [ ] Set up Slack workspace webhook
- [ ] Implement notification dispatcher
- [ ] Create notification preferences UI
- [ ] Test delivery across all channels

### Grafana Dashboards
- [ ] Add Grafana to docker-compose
- [ ] Configure TimescaleDB data source
- [ ] Build pre-configured dashboards
- [ ] Create provisioning setup
- [ ] Document Grafana deployment

### Audit Logging
- [ ] Implement audit middleware
- [ ] Create audit log viewer UI
- [ ] Build GDPR data export
- [ ] Create audit search/filtering
- [ ] Test compliance requirements

### Performance Optimization
- [ ] Profile database queries
- [ ] Implement caching strategy
- [ ] Load test infrastructure
- [ ] Optimize based on metrics
- [ ] Document optimization decisions

---

## 📞 Notes

- These items are fully designed but intentionally deferred
- Each item is independent and can be implemented in any order
- Keep this file updated as you complete items
- Move completed items to their respective phase files
- Use this as a backlog reference for future sprints

---

**Next Review Date**: After Phase 3 core features are production-ready  
**Status**: Backlog ready for future implementation
