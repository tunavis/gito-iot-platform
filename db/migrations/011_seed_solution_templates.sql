-- Migration: Seed additional solution templates
-- Adds 4 more industry-specific dashboard templates

-- Energy Meter Monitoring Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Energy Meter Monitoring',
    'energy_meter_monitoring',
    'utilities',
    'Real-time monitoring of energy consumption, power demand, and power factor metrics for smart energy meters.',
    'zap',
    '#f59e0b',
    '["energy_meter", "smart_meter"]',
    '["power", "voltage", "current", "energy_consumption"]',
    '{
        "theme": {
            "primary_color": "#f59e0b",
            "title": "Energy Meter Monitoring"
        },
        "widgets": [
            {
                "type": "device_info",
                "title": "Meter Info",
                "position": {"x": 0, "y": 0, "w": 2, "h": 3},
                "config": {
                    "show_image": true,
                    "show_status": true,
                    "show_location": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Power Consumption",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "power",
                    "unit": "kW",
                    "show_trend": true,
                    "icon": "zap"
                },
                "data_binding": {
                    "metric": "power",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Today''s Energy",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "energy_consumption",
                    "unit": "kWh",
                    "icon": "battery"
                },
                "data_binding": {
                    "metric": "energy_consumption",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Power Factor",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "power_factor",
                    "unit": "",
                    "decimal_places": 3,
                    "icon": "activity"
                },
                "data_binding": {
                    "metric": "power_factor",
                    "auto_bind": true
                }
            },
            {
                "type": "chart",
                "title": "Power Consumption - Last 24 Hours",
                "position": {"x": 0, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["power"],
                    "time_range": "24h",
                    "color": "#f59e0b"
                }
            },
            {
                "type": "chart",
                "title": "Voltage & Current",
                "position": {"x": 6, "y": 3, "w": 6, "h": 4},
                "config": {
                    "chart_type": "line",
                    "metrics": ["voltage", "current"],
                    "time_range": "24h",
                    "colors": ["#3b82f6", "#ef4444"]
                }
            }
        ]
    }',
    true
);

-- Environmental Monitoring Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Environmental Monitoring',
    'environmental_monitoring',
    'environmental',
    'Monitor temperature, humidity, air quality (CO2, PM2.5), and environmental conditions in real-time.',
    'cloud',
    '#10b981',
    '["environmental_sensor", "air_quality_sensor"]',
    '["temperature", "humidity", "co2", "pm25"]',
    '{
        "theme": {
            "primary_color": "#10b981",
            "title": "Environmental Monitoring"
        },
        "widgets": [
            {
                "type": "kpi_card",
                "title": "Temperature",
                "position": {"x": 0, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "temperature",
                    "unit": "°C",
                    "show_trend": true,
                    "icon": "thermometer",
                    "threshold_warning": 25,
                    "threshold_critical": 30
                },
                "data_binding": {
                    "metric": "temperature",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Humidity",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "humidity",
                    "unit": "%",
                    "show_trend": true,
                    "icon": "droplet",
                    "threshold_warning": 60,
                    "threshold_critical": 80
                },
                "data_binding": {
                    "metric": "humidity",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "CO₂ Level",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "co2",
                    "unit": "ppm",
                    "show_trend": true,
                    "icon": "wind",
                    "threshold_warning": 1000,
                    "threshold_critical": 2000
                },
                "data_binding": {
                    "metric": "co2",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "PM2.5",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "pm25",
                    "unit": "μg/m³",
                    "show_trend": true,
                    "icon": "alert-circle",
                    "threshold_warning": 35,
                    "threshold_critical": 55
                },
                "data_binding": {
                    "metric": "pm25",
                    "auto_bind": true
                }
            },
            {
                "type": "chart",
                "title": "Temperature & Humidity - Last 24 Hours",
                "position": {"x": 0, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "line",
                    "metrics": ["temperature", "humidity"],
                    "time_range": "24h",
                    "colors": ["#ef4444", "#3b82f6"]
                }
            },
            {
                "type": "chart",
                "title": "Air Quality - Last 24 Hours",
                "position": {"x": 6, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "area",
                    "metrics": ["co2", "pm25"],
                    "time_range": "24h",
                    "colors": ["#10b981", "#f59e0b"]
                }
            },
            {
                "type": "map",
                "title": "Device Locations",
                "position": {"x": 0, "y": 6, "w": 4, "h": 4},
                "config": {
                    "zoom": 12,
                    "show_label": true
                }
            },
            {
                "type": "table",
                "title": "Recent Readings",
                "position": {"x": 4, "y": 6, "w": 8, "h": 4},
                "config": {
                    "columns": ["timestamp", "temperature", "humidity", "co2", "pm25"],
                    "page_size": 10,
                    "auto_refresh": true
                }
            }
        ]
    }',
    true
);

-- Fleet Tracking Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Fleet Tracking',
    'fleet_tracking',
    'fleet',
    'Real-time vehicle tracking with location, speed, fuel consumption, and route monitoring for fleet management.',
    'truck',
    '#8b5cf6',
    '["gps_tracker", "vehicle_tracker"]',
    '["latitude", "longitude", "speed", "fuel_level"]',
    '{
        "theme": {
            "primary_color": "#8b5cf6",
            "title": "Fleet Tracking"
        },
        "widgets": [
            {
                "type": "kpi_card",
                "title": "Active Vehicles",
                "position": {"x": 0, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "active_count",
                    "unit": "",
                    "icon": "truck"
                }
            },
            {
                "type": "kpi_card",
                "title": "Avg Speed",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "speed",
                    "unit": "km/h",
                    "show_trend": true,
                    "icon": "gauge"
                },
                "data_binding": {
                    "metric": "speed",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Total Distance",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "distance_today",
                    "unit": "km",
                    "icon": "map"
                }
            },
            {
                "type": "kpi_card",
                "title": "Fuel Level",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "fuel_level",
                    "unit": "%",
                    "icon": "droplet",
                    "threshold_warning": 30,
                    "threshold_critical": 15
                },
                "data_binding": {
                    "metric": "fuel_level",
                    "auto_bind": true
                }
            },
            {
                "type": "map",
                "title": "Live Vehicle Locations",
                "position": {"x": 0, "y": 2, "w": 8, "h": 5},
                "config": {
                    "zoom": 10,
                    "show_label": true,
                    "show_routes": true
                }
            },
            {
                "type": "table",
                "title": "Vehicle Status",
                "position": {"x": 8, "y": 2, "w": 4, "h": 5},
                "config": {
                    "columns": ["vehicle_id", "speed", "fuel_level", "last_update"],
                    "page_size": 10,
                    "auto_refresh": true
                }
            },
            {
                "type": "chart",
                "title": "Speed History - Last 12 Hours",
                "position": {"x": 0, "y": 7, "w": 12, "h": 3},
                "config": {
                    "chart_type": "line",
                    "metrics": ["speed"],
                    "time_range": "12h",
                    "color": "#8b5cf6"
                }
            }
        ]
    }',
    true
);

-- Smart Factory Template
INSERT INTO solution_templates (
    id,
    name,
    identifier,
    category,
    description,
    icon,
    color,
    target_device_types,
    required_capabilities,
    template_config,
    is_active
) VALUES (
    gen_random_uuid(),
    'Smart Factory',
    'smart_factory',
    'industry_4_0',
    'Industry 4.0 dashboard for monitoring OEE, machine status, production rates, and downtime tracking.',
    'factory',
    '#dc2626',
    '["industrial_gateway", "plc", "machine_sensor"]',
    '["machine_status", "production_count", "temperature", "vibration"]',
    '{
        "theme": {
            "primary_color": "#dc2626",
            "title": "Smart Factory"
        },
        "widgets": [
            {
                "type": "kpi_card",
                "title": "OEE",
                "position": {"x": 0, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "oee",
                    "unit": "%",
                    "show_trend": true,
                    "icon": "activity",
                    "threshold_warning": 70,
                    "threshold_critical": 50
                },
                "data_binding": {
                    "metric": "oee",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Production Rate",
                "position": {"x": 2, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "production_rate",
                    "unit": "units/hr",
                    "show_trend": true,
                    "icon": "trending-up"
                },
                "data_binding": {
                    "metric": "production_count",
                    "auto_bind": true
                }
            },
            {
                "type": "kpi_card",
                "title": "Downtime Today",
                "position": {"x": 4, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "downtime_minutes",
                    "unit": "min",
                    "icon": "alert-circle",
                    "color": "#ef4444"
                }
            },
            {
                "type": "kpi_card",
                "title": "Active Machines",
                "position": {"x": 6, "y": 0, "w": 2, "h": 2},
                "config": {
                    "metric": "active_machines",
                    "unit": "",
                    "icon": "cpu"
                }
            },
            {
                "type": "chart",
                "title": "Production Output - Last 24 Hours",
                "position": {"x": 0, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "bar",
                    "metrics": ["production_count"],
                    "time_range": "24h",
                    "color": "#dc2626"
                }
            },
            {
                "type": "chart",
                "title": "Machine Temperature & Vibration",
                "position": {"x": 6, "y": 2, "w": 6, "h": 4},
                "config": {
                    "chart_type": "line",
                    "metrics": ["temperature", "vibration"],
                    "time_range": "24h",
                    "colors": ["#f59e0b", "#8b5cf6"]
                }
            },
            {
                "type": "table",
                "title": "Machine Status",
                "position": {"x": 0, "y": 6, "w": 8, "h": 4},
                "config": {
                    "columns": ["machine_id", "status", "production_count", "temperature", "last_maintenance"],
                    "page_size": 10,
                    "auto_refresh": true
                }
            },
            {
                "type": "map",
                "title": "Factory Floor",
                "position": {"x": 8, "y": 6, "w": 4, "h": 4},
                "config": {
                    "zoom": 18,
                    "show_label": true
                }
            }
        ]
    }',
    true
);
