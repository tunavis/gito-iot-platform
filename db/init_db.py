#!/usr/bin/env python3
"""Database initialization script - runs SQL migrations once."""
import asyncio
import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

async def init_database():
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("ERROR: DATABASE_URL not set")
        return

    engine = create_async_engine(database_url, echo=False)
    
    async with engine.begin() as conn:
        # Check if database is already initialized
        result = await conn.execute(
            text("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants'")
        )
        if result.scalar() > 0:
            print("✅ Database already initialized")
            return
        
        print("📦 Initializing database from SQL...")
        
        # Run init.sql
        with open('/app/db/init.sql', 'r') as f:
            sql = f.read()
            # Split by statement and execute
            for statement in sql.split(';'):
                if statement.strip():
                    await conn.execute(text(statement))
        
        print("✅ Database initialized successfully")
    
    await engine.dispose()

if __name__ == '__main__':
    asyncio.run(init_database())
