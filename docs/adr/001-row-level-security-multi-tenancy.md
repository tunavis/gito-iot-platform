# ADR-001: Row-Level Security for Multi-Tenancy

**Last Updated: 2026-01-31**

---

## Status

**Accepted** ✅

## Context

Gito IoT is a **multi-tenant SaaS platform** where multiple organizations share the same database instance. We need to ensure:

1. **Data Isolation:** Tenant A cannot access Tenant B's data
2. **Security:** Protection at the database level (not just application level)
3. **Performance:** Minimal overhead for tenant filtering
4. **Developer Experience:** Simple to implement and hard to get wrong

### Current Situation
- Single PostgreSQL database for all tenants
- Every table has `tenant_id` column
- Need automatic, foolproof tenant isolation

### Requirements
- Zero chance of cross-tenant data leaks
- Transparent to application code (no manual WHERE clauses)
- Works with existing PostgreSQL infrastructure
- Supports future scaling (read replicas, etc.)

## Decision

Implement **PostgreSQL Row-Level Security (RLS)** for all tenant-scoped tables.

**Key Implementation:**
```sql
-- Enable RLS on table
ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY tenant_isolation_dashboards ON dashboards
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Set context per request
await session.set_tenant_context(tenant_id);
```

**Application pattern:**
```python
# Extract tenant_id from JWT
tenant_id = payload.get("tenant_id")

# Set PostgreSQL session variable
await session.set_tenant_context(tenant_id)

# All queries automatically filtered by RLS
result = await session.execute(select(Dashboard))
# Only returns dashboards where tenant_id matches
```

## Consequences

### Positive Consequences ✅
- **Database-level enforcement:** Even if application code is buggy, DB blocks cross-tenant access
- **Automatic filtering:** No need to add `WHERE tenant_id = ?` to every query
- **Fail-safe:** Forgetting to filter = empty result set (safe default)
- **Audit-friendly:** DB logs show tenant context for all queries
- **Future-proof:** Works with read replicas, connection pooling, etc.
- **Performance:** PostgreSQL optimizes RLS policies efficiently

### Negative Consequences / Trade-offs ⚠️
- **Session state required:** Must call `set_tenant_context()` before queries
- **Debugging complexity:** Need to check RLS policies when troubleshooting
- **Migration effort:** All existing tables need RLS enabled
- **Policy maintenance:** Each table needs its own policy
- **Context management:** Errors if context not set properly

### Neutral / Unknown 📝
- Performance impact minimal but needs monitoring at scale
- Interaction with complex joins requires careful policy design

## Alternatives Considered

### Alternative 1: Application-Level Filtering
**Description:** Add `WHERE tenant_id = ?` to every query in application code

**Pros:**
- Simple to understand
- No database-level features needed
- Easy to debug

**Cons:**
- Error-prone (easy to forget filter)
- No safety net if developer makes mistake
- Code duplication across all queries
- **Single bug = data breach**

**Why not chosen:** Too risky for SaaS platform. One forgotten WHERE clause = security incident.

### Alternative 2: Separate Database Per Tenant
**Description:** Each tenant gets their own PostgreSQL database

**Pros:**
- Perfect isolation (physically separate)
- Easy to backup/restore per tenant
- Can scale individual tenants independently

**Cons:**
- Operational nightmare (100s of databases)
- High infrastructure cost
- Schema migrations across all DBs
- Cannot do cross-tenant analytics
- Violates SaaS best practices

**Why not chosen:** Doesn't scale operationally for multi-tenant SaaS.

### Alternative 3: Schema-Based Multi-Tenancy
**Description:** Each tenant gets their own PostgreSQL schema (not database)

**Pros:**
- Good isolation
- Single database instance
- Can use search_path for tenant routing

**Cons:**
- Schema migrations still complex
- Connection pooling per-schema needed
- Harder to manage than RLS
- Less flexible for shared data

**Why not chosen:** RLS provides same isolation with less complexity.

## Implementation Notes

### Tables with RLS Enabled
All tables with `tenant_id` column:
- ✅ `dashboards`
- ✅ `dashboard_widgets`
- ✅ `devices`
- ✅ `alert_events`
- ✅ `alert_rules`
- ✅ `audit_logs`
- ✅ Users, organizations, sites, etc.

### Setting Context Pattern
```python
# In every API route
async def route_handler(
    tenant_id: UUID,
    session: RLSSession = Depends(get_session),
):
    # Extract from JWT
    current_tenant_id = get_current_tenant()

    # Validate match
    if tenant_id != current_tenant_id:
        raise HTTPException(403, "Tenant mismatch")

    # Set RLS context
    await session.set_tenant_context(tenant_id)

    # Now all queries are tenant-filtered
    result = await session.execute(select(Dashboard))
```

### Testing RLS
```sql
-- Test as Tenant A
SET app.current_tenant_id = '00000000-0000-0000-0000-000000000001';
SELECT * FROM dashboards;  -- Only Tenant A's data

-- Test as Tenant B
SET app.current_tenant_id = '00000000-0000-0000-0000-000000000002';
SELECT * FROM dashboards;  -- Only Tenant B's data
```

## References

- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- Migration: `db/migrations/010_dashboard_system.sql`
- Implementation: `api/app/database.py` (RLSSession class)
- Related: Dashboard builder implements RLS from day 1

---

## Changelog

- 2026-01-31: Initial draft (Accepted)
- 2026-01-31: Implemented in dashboard system
