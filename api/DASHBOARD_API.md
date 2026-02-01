# Dashboard System API Documentation

## Overview

Production-grade dashboard builder API for the enterprise IoT SaaS platform. Provides complete CRUD operations for dashboards, widgets, and solution templates with multi-tenant isolation and user-level access control.

## Architecture

### Multi-Tenant Security
- **Row-Level Security (RLS)**: PostgreSQL RLS policies enforce tenant isolation
- **User-Level Access**: Dashboards are user-scoped within each tenant
- **JWT Authentication**: All endpoints require valid JWT tokens with tenant_id and user_id
- **Automatic Context Setting**: Session context (`app.current_tenant_id`, `app.current_user_id`) is set on every request

### Database Schema
- **dashboards**: User-created dashboards with layout and theme configuration
- **dashboard_widgets**: Individual widgets with position, size, and data bindings
- **solution_templates**: Pre-built industry-specific dashboard templates

## API Endpoints

### Dashboards API

#### List Dashboards
```
GET /api/v1/tenants/{tenant_id}/dashboards
```
Returns all dashboards for the authenticated user with widget counts.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "My Dashboard",
    "description": "Dashboard description",
    "is_default": false,
    "solution_type": "water_flow_monitoring",
    "widget_count": 5,
    "created_at": "2026-01-31T10:00:00Z",
    "updated_at": "2026-01-31T10:00:00Z"
  }
]
```

#### Create Dashboard
```
POST /api/v1/tenants/{tenant_id}/dashboards
```

**Request:**
```json
{
  "name": "Water Flow Dashboard",
  "description": "Real-time water flow monitoring",
  "is_default": false,
  "layout_config": {
    "cols": 12,
    "rowHeight": 30,
    "breakpoints": {"lg": 1200, "md": 996, "sm": 768, "xs": 480}
  },
  "theme": {
    "primary_color": "#0ea5e9",
    "background": "#ffffff"
  },
  "solution_type": "water_flow_monitoring",
  "extra_data": {}
}
```

**Response:** DashboardResponse object

#### Get Dashboard with Widgets
```
GET /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}
```

Returns complete dashboard with all widgets.

**Response:**
```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "user_id": "uuid",
  "name": "Water Flow Dashboard",
  "description": "Real-time monitoring",
  "is_default": false,
  "layout_config": {...},
  "theme": {...},
  "solution_type": "water_flow_monitoring",
  "extra_data": {},
  "widgets": [
    {
      "id": "uuid",
      "dashboard_id": "uuid",
      "widget_type": "kpi_card",
      "title": "Flow Rate",
      "position_x": 0,
      "position_y": 0,
      "width": 3,
      "height": 2,
      "configuration": {
        "metric": "flow_rate",
        "unit": "m³/hr",
        "decimal_places": 2
      },
      "data_sources": [
        {
          "device_id": "uuid",
          "metric": "flow_rate",
          "alias": "Main Flow Meter"
        }
      ],
      "refresh_interval": 30,
      "created_at": "2026-01-31T10:00:00Z",
      "updated_at": "2026-01-31T10:00:00Z"
    }
  ],
  "created_at": "2026-01-31T10:00:00Z",
  "updated_at": "2026-01-31T10:00:00Z"
}
```

#### Update Dashboard
```
PUT /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}
```

**Request:** Partial update (only include fields to update)
```json
{
  "name": "Updated Dashboard Name",
  "is_default": true
}
```

#### Delete Dashboard
```
DELETE /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}
```

Deletes dashboard and all associated widgets (cascade delete).

#### Update Dashboard Layout
```
PUT /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/layout
```

Batch update widget positions and sizes (for drag-and-drop operations).

**Request:**
```json
{
  "widgets": [
    {
      "id": "widget-uuid-1",
      "x": 0,
      "y": 0,
      "w": 3,
      "h": 2
    },
    {
      "id": "widget-uuid-2",
      "x": 3,
      "y": 0,
      "w": 3,
      "h": 2
    }
  ]
}
```

### Dashboard Widgets API

#### Add Widget to Dashboard
```
POST /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/widgets
```

**Request:**
```json
{
  "widget_type": "kpi_card",
  "title": "Flow Rate",
  "position_x": 0,
  "position_y": 0,
  "width": 3,
  "height": 2,
  "configuration": {
    "metric": "flow_rate",
    "unit": "m³/hr",
    "decimal_places": 2,
    "show_trend": true,
    "icon": "droplet",
    "color": "#10b981"
  },
  "data_sources": [],
  "refresh_interval": 30
}
```

**Supported Widget Types:**
- `kpi_card`: KPI metric card with trend
- `chart`: Time-series chart (line, area, bar)
- `gauge`: Circular or linear gauge
- `map`: Device location map
- `table`: Data table
- `device_info`: Device information card

#### Update Widget
```
PUT /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/widgets/{widget_id}
```

**Request:** Partial update
```json
{
  "title": "Updated Title",
  "configuration": {
    "color": "#3b82f6"
  }
}
```

#### Delete Widget
```
DELETE /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/widgets/{widget_id}
```

#### Bind Device to Widget
```
POST /api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/widgets/{widget_id}/bind-device
```

**Request:**
```json
{
  "device_id": "uuid",
  "metric": "flow_rate",
  "alias": "Main Flow Meter"
}
```

Adds or updates device binding in the widget's `data_sources` array.

### Solution Templates API

#### List Solution Templates
```
GET /api/v1/tenants/{tenant_id}/solution-templates
```

Returns all active solution templates with compatible device counts.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Water Flow Monitoring",
    "identifier": "water_flow_monitoring",
    "category": "utilities",
    "description": "Comprehensive water flow monitoring dashboard...",
    "icon": "droplet",
    "color": "#0ea5e9",
    "target_device_types": ["water_meter", "flow_sensor"],
    "required_capabilities": ["flow_rate", "velocity", "total_volume"],
    "template_config": {...},
    "preview_image_url": null,
    "is_active": true,
    "compatible_device_count": 12,
    "created_at": "2026-01-31T10:00:00Z",
    "updated_at": "2026-01-31T10:00:00Z"
  }
]
```

#### Get Solution Template Details
```
GET /api/v1/tenants/{tenant_id}/solution-templates/{template_id}
```

#### Apply Solution Template
```
POST /api/v1/tenants/{tenant_id}/solution-templates/{template_id}/apply
```

Creates a new dashboard from a template with pre-configured widgets.

**Request:**
```json
{
  "dashboard_name": "My Water Flow Dashboard",
  "device_bindings": {
    "0": "device-uuid-1",
    "1": "device-uuid-2"
  },
  "set_as_default": false
}
```

**Response:**
```json
{
  "dashboard_id": "uuid",
  "dashboard_name": "My Water Flow Dashboard",
  "widgets_created": 8,
  "auto_bound_devices": 2,
  "message": "Dashboard created successfully with 8 widgets"
}
```

## Authentication

All endpoints require JWT authentication via the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

The JWT token must contain:
- `tenant_id`: Tenant UUID
- `sub`: User UUID (user_id)
- `role`: User role (admin, user, viewer)

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid Authorization header"
  }
}
```

### 403 Forbidden
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Tenant mismatch"
  }
}
```

### 404 Not Found
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Dashboard not found"
  }
}
```

## Production Features

### Security
- Multi-tenant isolation via PostgreSQL RLS
- User-level access control
- JWT token validation on every request
- Automatic tenant/user context setting
- Cascade delete protection

### Performance
- Efficient query joins for dashboard + widgets
- Indexed foreign keys
- Database connection pooling
- Optimized widget layout batch updates

### Data Integrity
- Foreign key constraints
- Check constraints on widget dimensions
- Transaction support
- Automatic timestamp management

### Scalability
- Async/await for non-blocking I/O
- Connection pooling with configurable limits
- Efficient pagination support
- Optimized queries with proper indexes

## Usage Example

### Create a Dashboard from Template

1. **List available templates:**
```bash
curl -X GET https://api.example.com/api/v1/tenants/{tenant_id}/solution-templates \
  -H "Authorization: Bearer {token}"
```

2. **Apply template:**
```bash
curl -X POST https://api.example.com/api/v1/tenants/{tenant_id}/solution-templates/{template_id}/apply \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "dashboard_name": "My Water Monitoring",
    "set_as_default": true
  }'
```

3. **Get dashboard with widgets:**
```bash
curl -X GET https://api.example.com/api/v1/tenants/{tenant_id}/dashboards/{dashboard_id} \
  -H "Authorization: Bearer {token}"
```

4. **Bind device to widget:**
```bash
curl -X POST https://api.example.com/api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/widgets/{widget_id}/bind-device \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "{device_id}",
    "metric": "flow_rate",
    "alias": "Main Meter"
  }'
```

### Create Custom Dashboard

1. **Create blank dashboard:**
```bash
curl -X POST https://api.example.com/api/v1/tenants/{tenant_id}/dashboards \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Custom Dashboard",
    "layout_config": {"cols": 12, "rowHeight": 30}
  }'
```

2. **Add widgets:**
```bash
curl -X POST https://api.example.com/api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/widgets \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "widget_type": "kpi_card",
    "title": "Temperature",
    "position_x": 0,
    "position_y": 0,
    "width": 3,
    "height": 2,
    "configuration": {
      "metric": "temperature",
      "unit": "°C"
    }
  }'
```

3. **Update layout (drag & drop):**
```bash
curl -X PUT https://api.example.com/api/v1/tenants/{tenant_id}/dashboards/{dashboard_id}/layout \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "widgets": [
      {"id": "{widget_id_1}", "x": 0, "y": 0, "w": 3, "h": 2},
      {"id": "{widget_id_2}", "x": 3, "y": 0, "w": 3, "h": 2}
    ]
  }'
```

## Implementation Status

✅ **Completed Features:**
- Full CRUD operations for dashboards
- Full CRUD operations for widgets
- Solution template system
- Device binding to widgets
- Layout batch update
- Multi-tenant isolation with RLS
- User-level access control
- JWT authentication
- Proper error handling
- Database migrations
- Production-ready code (no TODOs, no mocks)
- API documentation
- Type safety with Pydantic schemas

✅ **Production Quality:**
- PostgreSQL with RLS policies
- Async SQLAlchemy
- Connection pooling
- Transaction support
- Cascade delete handling
- Efficient queries with joins
- Proper indexes
- Error logging
- Input validation
- Type hints throughout

## Competing with Cumulocity & ThingsBoard

### Key Differentiators:
1. **User-Scoped Dashboards**: Each user has their own dashboards (not just tenant-level)
2. **Solution Templates**: Industry-specific pre-built dashboards
3. **Auto-Device Binding**: Intelligent device-to-widget binding
4. **Modern Stack**: FastAPI + Async SQLAlchemy + PostgreSQL
5. **Type Safety**: Full Pydantic validation
6. **Enterprise Security**: Multi-layer RLS with tenant + user isolation

### Performance:
- Async I/O for high concurrency
- Database connection pooling
- Optimized queries with proper indexes
- Efficient batch operations

### Flexibility:
- Drag-and-drop layout system
- Multiple widget types
- Customizable themes
- Rich configuration options
- Device data source bindings
