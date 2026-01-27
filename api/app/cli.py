"""
Management CLI for Gito IoT Platform.

Provides administrative commands for database seeding and other operations.

Usage:
    python -m app.cli seed                 # Run database seeder
"""

import sys
import asyncio
from app.seed import main as seed_main


def seed_command():
    """Execute database seeding."""
    return asyncio.run(seed_main())


def main():
    """Main CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: python -m app.cli <command>")
        print("\nAvailable commands:")
        print("  seed      - Populate database with seed data")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "seed":
        sys.exit(seed_command())
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
