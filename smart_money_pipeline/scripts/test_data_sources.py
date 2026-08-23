#!/usr/bin/env python3
"""
Test each data source API individually to identify which ones are working/broken.
"""

import sys
from pathlib import Path
import logging

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from smart_money_pipeline.config import get_config
from smart_money_pipeline.common.db import initialize_pool, execute_query

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def test_sec_edgar():
    """Test SEC EDGAR API for Form 4, 13D, 13F."""
    logger.info("\n" + "="*60)
    logger.info("Testing SEC EDGAR API")
    logger.info("="*60)

    try:
        from smart_money_pipeline.data_sources.sec_edgar import SECEdgarAPI

        sec = SECEdgarAPI()

        # Test with AAPL (CIK: 0000320193)
        logger.info("\n1. Testing Form 4 fetch for AAPL...")
        form4 = sec.fetch_form4_filings("0000320193", lookback_days=30)
        logger.info(f"   Result: {len(form4)} Form 4 filings found")
        if form4:
            logger.info(f"   Sample: {form4[0]}")

        logger.info("\n2. Testing 13D fetch...")
        d13d = sec.fetch_13d_filings(lookback_days=30)
        logger.info(f"   Result: {len(d13d)} 13D filings found")
        if d13d:
            logger.info(f"   Sample: {d13d[0]}")

        logger.info("\n3. Testing 13F fetch for Citadel (CIK: 1207907)...")
        d13f = sec.fetch_13f_filings("1207907")
        logger.info(f"   Result: {len(d13f)} 13F filings found")
        if d13f:
            logger.info(f"   Sample: {d13f[0]}")

        return len(form4) > 0 or len(d13d) > 0 or len(d13f) > 0

    except Exception as e:
        logger.error(f"SEC EDGAR API test FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_cot():
    """Test CFTC COT API."""
    logger.info("\n" + "="*60)
    logger.info("Testing CFTC COT API")
    logger.info("="*60)

    try:
        from smart_money_pipeline.data_sources.cftc_cot import get_nq_cot_data

        logger.info("\n1. Fetching COT data for NQ...")
        cot_data = get_nq_cot_data(weeks=4)
        logger.info(f"   Result: {len(cot_data)} records found")
        if cot_data:
            logger.info(f"   Sample: {cot_data[0]}")

        return len(cot_data) > 0

    except Exception as e:
        logger.error(f"COT API test FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_finra():
    """Test FINRA short interest API."""
    logger.info("\n" + "="*60)
    logger.info("Testing FINRA Short Interest API")
    logger.info("="*60)

    try:
        from smart_money_pipeline.data_sources.finra_short_interest import get_short_interest_data

        logger.info("\n1. Fetching short interest for AAPL...")
        si_data = get_short_interest_data("AAPL", days=30)
        logger.info(f"   Result: {len(si_data)} records found")
        if si_data:
            logger.info(f"   Sample: {si_data[0]}")

        return len(si_data) > 0

    except Exception as e:
        logger.error(f"FINRA API test FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

def check_ticker_cik_table():
    """Verify ticker_to_cik table has data."""
    logger.info("\n" + "="*60)
    logger.info("Checking ticker_to_cik Table")
    logger.info("="*60)

    try:
        config = get_config()
        initialize_pool(
            host=config.database.host,
            port=config.database.port,
            database=config.database.name,
            user=config.database.user,
            password=config.database.password,
            sslmode=config.database.ssl_mode,
        )

        result = execute_query("SELECT COUNT(*) as count FROM ticker_to_cik", fetch_one=True)
        count = result["count"] if result else 0
        logger.info(f"   Total ticker_to_cik records: {count}")

        # Check for AAPL
        aapl = execute_query("SELECT * FROM ticker_to_cik WHERE ticker = 'AAPL'", fetch_one=True)
        if aapl:
            logger.info(f"   AAPL found: CIK={aapl['cik']}")
        else:
            logger.warning("   AAPL NOT FOUND!")

        return count > 50

    except Exception as e:
        logger.error(f"Database check FAILED: {e}")
        return False

def main():
    """Run all tests."""
    logger.info("\n" + "="*60)
    logger.info("DATA SOURCE API TEST SUITE")
    logger.info("="*60)

    results = {}

    # Check database first
    results["Database"] = check_ticker_cik_table()

    # Test each API
    results["SEC EDGAR"] = test_sec_edgar()
    results["CFTC COT"] = test_cot()
    results["FINRA"] = test_finra()

    # Summary
    logger.info("\n" + "="*60)
    logger.info("TEST SUMMARY")
    logger.info("="*60)
    for source, working in results.items():
        status = "✓ WORKING" if working else "✗ FAILED"
        logger.info(f"  {source:20} {status}")

    logger.info("\n" + "="*60)
    logger.info("ANALYSIS")
    logger.info("="*60)

    if results["Database"]:
        logger.info("✓ Database: ticker_to_cik is populated")
    else:
        logger.warning("✗ Database: ticker_to_cik is EMPTY or missing")

    if results["SEC EDGAR"]:
        logger.info("✓ SEC EDGAR: APIs are working")
    else:
        logger.warning("✗ SEC EDGAR: APIs are NOT returning data")
        logger.warning("  - Check if SEC is blocking requests")
        logger.warning("  - Check if User-Agent is set")
        logger.warning("  - Check network connectivity")

    if results["CFTC COT"]:
        logger.info("✓ CFTC: COT API is working")
    else:
        logger.warning("✗ CFTC: COT API is NOT working")

    if results["FINRA"]:
        logger.info("✓ FINRA: Short interest API is working")
    else:
        logger.warning("✗ FINRA: Short interest API is NOT working")

if __name__ == "__main__":
    main()
