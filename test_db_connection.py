#!/usr/bin/env python3
"""
Test database connection to DigitalOcean Postgres.
Verifies that the connection pool, configuration, and tables are all working.
"""

import sys
import logging
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from smart_money_pipeline.config import get_config
from smart_money_pipeline.common.db import initialize_pool, get_connection, table_exists

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

def test_connection():
    """Test the database connection and verify tables exist."""
    logger.info("=" * 60)
    logger.info("Smart Money Pipeline - Database Connection Test")
    logger.info("=" * 60)

    try:
        # Load configuration
        logger.info("\n1. Loading configuration...")
        config = get_config()
        logger.info(f"   ✓ Database host: {config.database.host}")
        logger.info(f"   ✓ Database port: {config.database.port}")
        logger.info(f"   ✓ Database name: {config.database.name}")
        logger.info(f"   ✓ SSL mode: {config.database.ssl_mode}")

        # Initialize connection pool
        logger.info("\n2. Initializing connection pool...")
        initialize_pool()
        logger.info("   ✓ Connection pool initialized")

        # Test connection
        logger.info("\n3. Testing database connection...")
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT version();")
        version = cur.fetchone()
        logger.info(f"   ✓ Connected successfully!")
        logger.info(f"   ✓ PostgreSQL version: {version[0].split(',')[0]}")
        cur.close()

        # Test query
        logger.info("\n4. Testing simple query...")
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
        table_count = cur.fetchone()[0]
        logger.info(f"   ✓ Found {table_count} tables in public schema")
        cur.close()

        # Verify required tables
        logger.info("\n5. Verifying required tables...")
        required_tables = [
            "ticker_to_cik",
            "ticker_to_sector",
            "form4_transactions",
            "filings_13d",
            "cot_positions",
            "short_interest",
            "thirteenf_positions",
            "scores",
            "ingestion_status",
        ]

        all_exist = True
        for table in required_tables:
            exists = table_exists(table)
            status = "✓" if exists else "✗"
            logger.info(f"   {status} {table}")
            if not exists:
                all_exist = False

        if not all_exist:
            logger.error("\n✗ Some required tables are missing!")
            return False

        logger.info("\n" + "=" * 60)
        logger.info("✓ All tests passed! Database is ready for use.")
        logger.info("=" * 60)
        return True

    except Exception as e:
        logger.error(f"\n✗ Connection test failed: {e}")
        logger.error(f"   Make sure:")
        logger.error(f"   1. DigitalOcean database is running")
        logger.error(f"   2. Network can reach db-postgresql-nyc3-47709-do-user-19616823-0.k.db.ondigitalocean.com:25060")
        logger.error(f"   3. .env.local has correct credentials")
        return False

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(".env.local")

    success = test_connection()
    sys.exit(0 if success else 1)
