"""Solution template service — list, fetch, and apply industry vertical templates."""

import logging
from typing import Optional, List
from uuid import UUID

from sqlalchemy import text, select

from app.database import RLSSession
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.device_type import DeviceType
from app.models.unified_alert_rule import UnifiedAlertRule

logger = logging.getLogger(__name__)


class TemplateService:
    """Service for querying and applying solution templates."""

    def __init__(self, session: RLSSession):
        self.session = session

    # ------------------------------------------------------------------
    # Query helpers (raw SQL — solution_templates has no RLS)
    # ------------------------------------------------------------------

    async def get_template(self, template_id: UUID) -> Optional[dict]:
        """Return a single template by ID, or None if not found."""
        result = await self.session.execute(
            text("""
                SELECT id, name, slug, description, industry, icon,
                       device_types, dashboard_config, alert_rules,
                       is_active, created_at, updated_at
                FROM solution_templates
                WHERE id = :id
            """),
            {"id": str(template_id)},
        )
        row = result.mappings().one_or_none()
        return dict(row) if row else None

    async def get_template_by_slug(self, slug: str) -> Optional[dict]:
        """Return a single template by slug, or None if not found."""
        result = await self.session.execute(
            text("""
                SELECT id, name, slug, description, industry, icon,
                       device_types, dashboard_config, alert_rules,
                       is_active, created_at, updated_at
                FROM solution_templates
                WHERE slug = :slug
            """),
            {"slug": slug},
        )
        row = result.mappings().one_or_none()
        return dict(row) if row else None

    async def list_templates(self, industry: Optional[str] = None) -> List[dict]:
        """Return all active templates, optionally filtered by industry."""
        if industry:
            result = await self.session.execute(
                text("""
                    SELECT id, name, slug, description, industry, icon,
                           is_active, created_at, updated_at
                    FROM solution_templates
                    WHERE is_active = true AND industry = :industry
                    ORDER BY name
                """),
                {"industry": industry},
            )
        else:
            result = await self.session.execute(
                text("""
                    SELECT id, name, slug, description, industry, icon,
                           is_active, created_at, updated_at
                    FROM solution_templates
                    WHERE is_active = true
                    ORDER BY name
                """),
            )
        rows = result.mappings().all()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Apply template
    # ------------------------------------------------------------------

    async def apply_template(
        self,
        template: dict,
        tenant_id: UUID,
        user_id: UUID,
        dashboard_name: Optional[str] = None,
    ) -> Dashboard:
        """Apply a solution template for a tenant/user.

        Steps:
        1. Create device types from the template (skip duplicates by name).
        2. Create the dashboard.
        3. Create widgets from the dashboard config.
        4. Create alert rules from the template.

        RLS context must be set by the caller BEFORE invoking this method.
        """
        # 1. Create device types (skip if the tenant already has a type with the same name)
        device_type_ids: dict[str, UUID] = {}
        for dt_spec in template.get("device_types") or []:
            dt_name = dt_spec.get("name")
            if not dt_name:
                continue

            # Check if device type with this name already exists for tenant
            existing = await self.session.execute(
                select(DeviceType).where(
                    DeviceType.tenant_id == tenant_id,
                    DeviceType.name == dt_name,
                )
            )
            existing_dt = existing.scalar_one_or_none()

            if existing_dt:
                device_type_ids[dt_name] = existing_dt.id
                logger.debug(
                    "Skipping existing device type '%s' for tenant %s", dt_name, tenant_id
                )
                continue

            # Convert telemetry_schema to data_model format expected by DeviceType
            telemetry_schema = dt_spec.get("telemetry_schema") or {}
            data_model = [
                {
                    "name": key,
                    "type": props.get("type", "number"),
                    "unit": props.get("unit", ""),
                    "min": props.get("min"),
                    "max": props.get("max"),
                }
                for key, props in telemetry_schema.items()
            ]

            device_type = DeviceType(
                tenant_id=tenant_id,
                name=dt_name,
                description=dt_spec.get("description"),
                category="sensor",
                data_model=data_model,
            )
            self.session.add(device_type)
            await self.session.flush()  # get the id without committing
            device_type_ids[dt_name] = device_type.id
            logger.info(
                "Created device type '%s' (%s) for tenant %s", dt_name, device_type.id, tenant_id
            )

        # 2. Create the dashboard
        dashboard_config = template.get("dashboard_config") or {}
        effective_name = (
            dashboard_name
            or dashboard_config.get("name")
            or template.get("name")
            or "New Dashboard"
        )

        dashboard = Dashboard(
            tenant_id=tenant_id,
            user_id=user_id,
            name=effective_name,
            description=dashboard_config.get("description"),
            solution_type=template.get("slug"),
            layout_config={},
            theme={},
            extra_data={},
        )
        self.session.add(dashboard)
        await self.session.flush()

        # 3. Create widgets
        for widget_spec in dashboard_config.get("widgets") or []:
            widget = DashboardWidget(
                dashboard_id=dashboard.id,
                widget_type=widget_spec.get("widget_type", "kpi_card"),
                title=widget_spec.get("title"),
                position_x=widget_spec.get("position_x", 0),
                position_y=widget_spec.get("position_y", 0),
                width=widget_spec.get("width", 3),
                height=widget_spec.get("height", 2),
                configuration=widget_spec.get("configuration") or {},
                data_sources=widget_spec.get("data_sources") or [],
            )
            self.session.add(widget)

        # 4. Create alert rules
        for rule_spec in template.get("alert_rules") or []:
            rule_name = rule_spec.get("name", "Alert Rule")
            metric = rule_spec.get("metric_key") or rule_spec.get("metric")
            operator_raw = rule_spec.get("operator", ">")
            threshold = rule_spec.get("threshold")
            severity = rule_spec.get("severity", "WARNING")

            # Map operator symbols to API format expected by the model validator
            operator_map = {">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "=": "eq", "!=": "neq"}
            operator = operator_map.get(operator_raw, operator_raw)

            # Map severity to DB format
            severity_map = {"WARNING": "WARNING", "CRITICAL": "CRITICAL", "INFO": "MINOR"}
            db_severity = severity_map.get(severity.upper(), severity)

            rule = UnifiedAlertRule(
                tenant_id=tenant_id,
                name=rule_name,
                rule_type="THRESHOLD",
                metric=metric,
                operator=operator,
                threshold=threshold,
                severity=db_severity,
                active=True,
                cooldown_minutes=5,
            )
            self.session.add(rule)

        await self.session.commit()
        await self.session.refresh(dashboard)

        logger.info(
            "Applied template '%s' for tenant %s — dashboard %s created",
            template.get("slug"),
            tenant_id,
            dashboard.id,
        )
        return dashboard
