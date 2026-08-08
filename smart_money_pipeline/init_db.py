#!/usr/bin/env python3
"""
Initialize Smart Money Pipeline database schema.

Creates all normalized tables and indexes needed for the pipeline.
Safe to run multiple times - creates tables if they don't exist.

Usage:
    python init_db.py
"""

import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from smart_money_pipeline.common.db import get_connection, return_connection, table_exists

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Complete database schema
SCHEMA = """
-- Ticker to CIK mapping (refresh from SEC company_tickers.json)
CREATE TABLE IF NOT EXISTS ticker_to_cik (
    ticker VARCHAR(10) PRIMARY KEY,
    cik VARCHAR(10) NOT NULL UNIQUE,
    company_name VARCHAR(255),
    refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ticker to sector mapping (reuse from existing Nasdaq-100 dashboard)
CREATE TABLE IF NOT EXISTS ticker_to_sector (
    ticker VARCHAR(10) PRIMARY KEY,
    sector VARCHAR(100),
    refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Form 4 (Insider Transactions)
CREATE TABLE IF NOT EXISTS form4_transactions (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    cik VARCHAR(10),
    filer_name VARCHAR(255),
    filer_role VARCHAR(100),
    is_officer BOOLEAN,
    is_director BOOLEAN,
    transaction_code CHAR(1),  -- P (buy), S (sale), A (award), M (option exercise)
    transaction_date DATE,
    shares BIGINT,
    price DECIMAL(10, 2),
    shares_owned_after BIGINT,
    filed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT form4_unique UNIQUE(cik, transaction_date, shares, price)
);

CREATE INDEX IF NOT EXISTS idx_form4_ticker ON form4_transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_form4_date ON form4_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_form4_cik ON form4_transactions(cik);

-- Schedule 13D / 13D-A (Activist Stakes)
CREATE TABLE IF NOT EXISTS filings_13d (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    cik VARCHAR(10),
    filer_name VARCHAR(255),
    pct_owned DECIMAL(5, 2),
    filing_date DATE,
    is_amendment BOOLEAN,
    activist_keyword_flag BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT filings_13d_unique UNIQUE(cik, filing_date, is_amendment)
);

CREATE INDEX IF NOT EXISTS idx_13d_ticker ON filings_13d(ticker);
CREATE INDEX IF NOT EXISTS idx_13d_date ON filings_13d(filing_date);
CREATE INDEX IF NOT EXISTS idx_13d_cik ON filings_13d(cik);

-- CFTC Commitments of Traders (COT)
CREATE TABLE IF NOT EXISTS cot_positions (
    id SERIAL PRIMARY KEY,
    contract_name VARCHAR(100),
    report_date DATE,
    leveraged_funds_net BIGINT,
    open_interest BIGINT,
    commercial_net BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cot_unique UNIQUE(contract_name, report_date)
);

CREATE INDEX IF NOT EXISTS idx_cot_date ON cot_positions(report_date);

-- FINRA Short Interest
CREATE TABLE IF NOT EXISTS short_interest (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    settlement_date DATE,
    shares_short BIGINT,
    prior_shares_short BIGINT,
    days_to_cover DECIMAL(5, 2),
    pct_float_short DECIMAL(5, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT short_interest_unique UNIQUE(ticker, settlement_date)
);

CREATE INDEX IF NOT EXISTS idx_short_int_ticker ON short_interest(ticker);
CREATE INDEX IF NOT EXISTS idx_short_int_date ON short_interest(settlement_date);

-- SEC 13F (Institutional Holdings)
CREATE TABLE IF NOT EXISTS thirteenf_positions (
    id SERIAL PRIMARY KEY,
    fund_cik VARCHAR(10),
    fund_name VARCHAR(255),
    ticker VARCHAR(10),
    shares_held BIGINT,
    market_value BIGINT,
    pct_of_fund_portfolio DECIMAL(5, 2),
    period_of_report DATE,
    filed_at TIMESTAMP,
    put_call_flag VARCHAR(4),
    option_notional DECIMAL(18, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT thirteenf_unique UNIQUE(fund_cik, ticker, period_of_report, put_call_flag)
);

CREATE INDEX IF NOT EXISTS idx_13f_ticker ON thirteenf_positions(ticker);
CREATE INDEX IF NOT EXISTS idx_13f_fund ON thirteenf_positions(fund_cik);
CREATE INDEX IF NOT EXISTS idx_13f_date ON thirteenf_positions(period_of_report);

-- Composite Scores (Main Output Table)
CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    as_of_date DATE,
    insider_cluster_score DECIMAL(5, 2),
    activist_flag_score DECIMAL(5, 2),
    cot_zscore DECIMAL(5, 2),
    short_interest_momentum_score DECIMAL(5, 2),
    thirteenf_conviction_score DECIMAL(5, 2),
    composite_score DECIMAL(5, 2),
    weights_used_json JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT scores_unique UNIQUE(ticker, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_scores_ticker ON scores(ticker);
CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(as_of_date);
CREATE INDEX IF NOT EXISTS idx_scores_composite ON scores(composite_score DESC);

-- Ingestion status tracking (optional but useful)
CREATE TABLE IF NOT EXISTS ingestion_status (
    id SERIAL PRIMARY KEY,
    source_name VARCHAR(100),
    last_ingested_at TIMESTAMP,
    next_scheduled_at TIMESTAMP,
    status VARCHAR(50),  -- 'pending', 'running', 'completed', 'failed'
    error_message TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ingestion_status_unique UNIQUE(source_name)
);

CREATE INDEX IF NOT EXISTS idx_ingest_source ON ingestion_status(source_name);
"""


def create_schema() -> bool:
    """
    Create all database tables.

    Returns:
        True if successful, False otherwise
    """
    try:
        conn = get_connection()
        cur = conn.cursor()

        # Split schema into individual statements and execute
        statements = [s.strip() for s in SCHEMA.split(";") if s.strip()]

        for stmt in statements:
            try:
                logger.info(f"Executing: {stmt[:80]}...")
                cur.execute(stmt)
                conn.commit()
            except Exception as e:
                logger.error(f"Error executing statement: {e}")
                conn.rollback()
                return False

        cur.close()
        return_connection(conn)
        logger.info("✓ Database schema created successfully")
        return True

    except Exception as e:
        logger.error(f"Failed to create schema: {e}")
        return False


def verify_tables() -> bool:
    """Verify all required tables exist."""
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
        logger.info(f"{status} {table}")
        if not exists:
            all_exist = False

    return all_exist


def main():
    """Initialize database and verify tables."""
    logger.info("=" * 60)
    logger.info("Smart Money Pipeline - Database Initialization")
    logger.info("=" * 60)

    # Create tables
    if not create_schema():
        logger.error("Failed to create schema")
        return False

    logger.info("")
    logger.info("Verifying tables...")
    if not verify_tables():
        logger.error("One or more tables failed verification")
        return False

    logger.info("")
    logger.info("=" * 60)
    logger.info("✓ Database initialization complete!")
    logger.info("=" * 60)
    return True


if __name__ == "__main__":
    # Load environment variables
    from dotenv import load_dotenv
    load_dotenv(".env.local")

    # Import db module to initialize pool
    from smart_money_pipeline.common.db import initialize_pool

    try:
        # Initialize connection pool
        initialize_pool()

        # Create schema
        success = main()
        sys.exit(0 if success else 1)

    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
