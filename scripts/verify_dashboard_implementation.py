#!/usr/bin/env python3
"""
Dashboard System Implementation Verification Script

Verifies that all required files exist and contain expected components.
Run this script to validate the dashboard system implementation.
"""

import os
import sys
from pathlib import Path

# Colors for terminal output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
RESET = '\033[0m'

# Use simple ASCII characters for Windows compatibility
CHECK = '[OK]'
CROSS = '[FAIL]'
WARN = '[WARN]'

def check_file_exists(filepath, description):
    """Check if a file exists and print result."""
    if os.path.exists(filepath):
        print(f"{GREEN}{CHECK}{RESET} {description}: {filepath}")
        return True
    else:
        print(f"{RED}{CROSS}{RESET} {description}: {filepath} (MISSING)")
        return False

def check_file_contains(filepath, search_strings, description):
    """Check if file contains specific strings."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            missing = [s for s in search_strings if s not in content]
            if not missing:
                print(f"{GREEN}{CHECK}{RESET} {description}")
                return True
            else:
                print(f"{YELLOW}{WARN}{RESET} {description} - Missing: {', '.join(missing)}")
                return False
    except Exception as e:
        print(f"{RED}{CROSS}{RESET} {description} - Error: {e}")
        return False

def main():
    """Run verification checks."""
    print("=" * 70)
    print("Dashboard System Implementation Verification")
    print("=" * 70)
    print()

    # Determine project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    api_dir = project_root / "api" / "app"
    db_dir = project_root / "db" / "migrations"

    checks_passed = 0
    checks_failed = 0

    # Check API Router Files
    print("1. Checking API Router Files...")
    files_to_check = [
        (api_dir / "routers" / "dashboards.py", "Dashboard router"),
        (api_dir / "routers" / "dashboard_widgets.py", "Widget router"),
        (api_dir / "routers" / "solution_templates.py", "Solution template router"),
    ]

    for filepath, desc in files_to_check:
        if check_file_exists(filepath, desc):
            checks_passed += 1
        else:
            checks_failed += 1

    print()

    # Check Schema Files
    print("2. Checking Schema Files...")
    files_to_check = [
        (api_dir / "schemas" / "dashboard.py", "Dashboard schemas"),
        (api_dir / "schemas" / "solution_template.py", "Solution template schemas"),
    ]

    for filepath, desc in files_to_check:
        if check_file_exists(filepath, desc):
            checks_passed += 1
        else:
            checks_failed += 1

    print()

    # Check Model Files
    print("3. Checking Model Files...")
    if check_file_exists(api_dir / "models" / "dashboard.py", "Dashboard models"):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check Database Migration
    print("4. Checking Database Migration...")
    if check_file_exists(db_dir / "010_dashboard_system.sql", "Dashboard migration"):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check Router Registration in main.py
    print("5. Checking Router Registration...")
    main_py = api_dir / "main.py"
    if check_file_contains(
        main_py,
        [
            "dashboards, dashboard_widgets, solution_templates",
            "app.include_router(dashboards.router",
            "app.include_router(dashboard_widgets.router",
            "app.include_router(solution_templates.router",
        ],
        "Routers registered in main.py"
    ):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check Enhanced RLSSession
    print("6. Checking Enhanced RLSSession...")
    db_py = api_dir / "database.py"
    if check_file_contains(
        db_py,
        [
            "async def set_tenant_context",
            "user_id: UUID | str = None",
            "app.current_tenant_id",
            "app.current_user_id",
        ],
        "RLSSession enhanced for user context"
    ):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check Dashboard Router Implementation
    print("7. Checking Dashboard Router Implementation...")
    dashboard_router = api_dir / "routers" / "dashboards.py"
    if check_file_contains(
        dashboard_router,
        [
            "async def list_dashboards",
            "async def create_dashboard",
            "async def get_dashboard",
            "async def update_dashboard",
            "async def delete_dashboard",
            "async def update_dashboard_layout",
            "set_tenant_context(tenant_id, current_user_id)",
        ],
        "Dashboard router endpoints complete"
    ):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check Widget Router Implementation
    print("8. Checking Widget Router Implementation...")
    widget_router = api_dir / "routers" / "dashboard_widgets.py"
    if check_file_contains(
        widget_router,
        [
            "async def create_widget",
            "async def update_widget",
            "async def delete_widget",
            "async def bind_device_to_widget",
            "set_tenant_context(tenant_id, current_user_id)",
        ],
        "Widget router endpoints complete"
    ):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check Solution Template Router Implementation
    print("9. Checking Solution Template Router Implementation...")
    template_router = api_dir / "routers" / "solution_templates.py"
    if check_file_contains(
        template_router,
        [
            "async def list_solution_templates",
            "async def get_solution_template",
            "async def apply_solution_template",
            "set_tenant_context(tenant_id, current_user_id)",
        ],
        "Solution template router endpoints complete"
    ):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check RLS Policies in Migration
    print("10. Checking RLS Policies...")
    migration = db_dir / "010_dashboard_system.sql"
    if check_file_contains(
        migration,
        [
            "CREATE POLICY tenant_isolation_dashboards",
            "CREATE POLICY user_dashboards_access",
            "CREATE POLICY user_dashboard_widgets_access",
            "app.current_tenant_id",
            "app.current_user_id",
        ],
        "RLS policies configured"
    ):
        checks_passed += 1
    else:
        checks_failed += 1

    print()

    # Check Documentation
    print("11. Checking Documentation...")
    docs_to_check = [
        (project_root / "api" / "DASHBOARD_API.md", "API documentation"),
        (project_root / "api" / "DASHBOARD_TESTING.md", "Testing documentation"),
        (project_root / "DASHBOARD_IMPLEMENTATION_SUMMARY.md", "Implementation summary"),
    ]

    for filepath, desc in docs_to_check:
        if check_file_exists(filepath, desc):
            checks_passed += 1
        else:
            checks_failed += 1

    print()

    # Summary
    print("=" * 70)
    print("Verification Summary")
    print("=" * 70)
    total_checks = checks_passed + checks_failed
    print(f"Total Checks: {total_checks}")
    print(f"{GREEN}Passed: {checks_passed}{RESET}")
    if checks_failed > 0:
        print(f"{RED}Failed: {checks_failed}{RESET}")
    else:
        print(f"Failed: {checks_failed}")
    print()

    if checks_failed == 0:
        print(f"{GREEN}{CHECK} All checks passed! Dashboard system is properly implemented.{RESET}")
        return 0
    else:
        print(f"{YELLOW}{WARN} Some checks failed. Please review the output above.{RESET}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
