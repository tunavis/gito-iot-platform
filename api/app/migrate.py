"""
Database Migration Runner

Tracks and applies SQL migrations in order, similar to how Rails/Laravel handle migrations.
Creates a schema_migrations table to track applied migrations.
"""
import asyncio
import logging
import os
from pathlib import Path
from typing import List
import asyncpg

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path("/app/db/migrations")


async def run_migrations():
    """Run all pending database migrations."""
    
    logger.info("🔄 Starting database migrations...")
    
    # Get credentials from environment
    db_password = os.getenv("DB_PASSWORD", "")
    db_name = os.getenv("POSTGRES_DB", "gito_iot_staging")
    db_user = os.getenv("POSTGRES_USER", "gito_user")
    
    try:
        # Connect directly to database
        conn = await asyncpg.connect(
            host="postgres",
            port=5432,
            user=db_user,
            password=db_password,
            database=db_name
        )
        
        # Create migrations tracking table if it doesn't exist
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        
        # Get list of applied migrations
        applied = await conn.fetch("SELECT version FROM schema_migrations ORDER BY version")
        applied_versions = {row['version'] for row in applied}
        
        # Get all migration files
        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        
        if not migration_files:
            logger.warning(f"⚠️  No migration files found in {MIGRATIONS_DIR}")
            await conn.close()
            return
        
        pending_count = 0
        
        for migration_file in migration_files:
            version = migration_file.name
            
            if version in applied_versions:
                logger.debug(f"⏭️  Skipping {version} (already applied)")
                continue
            
            logger.info(f"▶️  Applying {version}...")
            
            try:
                # Read migration SQL
                sql = migration_file.read_text()
                
                # Execute migration in a transaction
                async with conn.transaction():
                    await conn.execute(sql)
                    await conn.execute(
                        "INSERT INTO schema_migrations (version) VALUES ($1)",
                        version
                    )
                
                logger.info(f"✅ Applied {version}")
                pending_count += 1
                
            except Exception as e:
                logger.error(f"❌ Failed to apply {version}: {e}")
                # Don't stop - continue with other migrations
                # This allows partial recovery
        
        await conn.close()
        
        if pending_count > 0:
            logger.info(f"✅ Applied {pending_count} migration(s)")
        else:
            logger.info("✅ Database is up to date")
            
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s:%(name)s:%(message)s"
    )
    asyncio.run(run_migrations())
