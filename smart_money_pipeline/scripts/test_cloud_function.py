#!/usr/bin/env python3
"""
Test Cloud Function deployment.
Validates that the smart_money_pipeline Cloud Function is working correctly.

Usage:
    # Test via HTTP endpoint (if public)
    python test_cloud_function.py --url https://region-project.cloudfunctions.net/smart_money_pipeline_main

    # Test via database (preferred)
    python test_cloud_function.py --database

    # Run full validation suite
    python test_cloud_function.py --full
"""

import sys
import logging
import json
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class CloudFunctionTester:
    """Test Cloud Function deployment and data ingestion."""

    def __init__(self):
        """Initialize tester."""
        self.results = {}
        self.start_time = datetime.now()

    def test_via_http(self, url: str) -> bool:
        """
        Test Cloud Function via HTTP endpoint.

        Args:
            url: Cloud Function HTTP endpoint URL

        Returns:
            True if function responded successfully
        """
        logger.info("\n" + "="*70)
        logger.info("TEST 1: Cloud Function HTTP Endpoint")
        logger.info("="*70)

        try:
            import requests

            logger.info(f"Calling: {url}")

            # Send request to Cloud Function
            response = requests.post(
                url,
                json={},
                headers={"Content-Type": "application/json"},
                timeout=60,
            )

            logger.info(f"Status Code: {response.status_code}")
            logger.info(f"Response Time: {response.elapsed.total_seconds():.2f}s")

            if response.status_code == 200:
                try:
                    data = response.json()
                    logger.info(f"Response Body: {json.dumps(data, indent=2)}")
                    self.results["http_test"] = "PASS"
                    return True
                except json.JSONDecodeError:
                    logger.info(f"Response Text: {response.text[:500]}")
                    self.results["http_test"] = "PASS (non-JSON)"
                    return True
            else:
                logger.warning(f"Unexpected status code: {response.status_code}")
                logger.warning(f"Response: {response.text[:500]}")
                self.results["http_test"] = f"FAIL ({response.status_code})"
                return False

        except Exception as e:
            logger.error(f"HTTP test failed: {e}")
            self.results["http_test"] = f"FAIL ({str(e)[:50]})"
            return False

    def test_via_database(self) -> bool:
        """
        Test by checking database for ingested records.

        Returns:
            True if records found
        """
        logger.info("\n" + "="*70)
        logger.info("TEST 2: Database Record Validation")
        logger.info("="*70)

        try:
            from smart_money_pipeline.config import get_config
            from smart_money_pipeline.common.db import (
                initialize_pool,
                execute_query,
            )

            config = get_config()
            logger.info(f"Database: {config.database.name}@{config.database.host}")

            # Initialize connection pool
            initialize_pool(
                host=config.database.host,
                port=config.database.port,
                database=config.database.name,
                user=config.database.user,
                password=config.database.password,
                sslmode=config.database.ssl_mode,
            )

            # Test each data source table
            tables = {
                "filings_4": "Form 4 Insider Transactions",
                "filings_13d": "13D Activist Stakes",
                "filings_13f": "13F Hedge Fund Holdings",
                "cot": "CFTC Commitments of Traders",
                "short_interest": "FINRA Short Interest",
                "smart_money_scores": "Smart Money Scores",
            }

            all_good = True
            logger.info("\nTable Record Counts:")

            for table, description in tables.items():
                try:
                    query = f"SELECT COUNT(*) as count FROM {table}"
                    result = execute_query(query, fetch_one=True)
                    count = result["count"] if result else 0

                    status = "✓" if count > 0 else "○"
                    logger.info(f"  {status} {table:20} {count:6} {description}")

                    if count > 0:
                        # Get sample record
                        query = f"SELECT * FROM {table} LIMIT 1"
                        sample = execute_query(query, fetch_one=True)
                        if sample:
                            logger.info(f"      Sample: {dict(sample)}")

                except Exception as e:
                    logger.warning(f"  ✗ {table:20} ERROR - {str(e)[:50]}")
                    all_good = False

            self.results["database_test"] = "PASS" if all_good else "PARTIAL"
            return all_good

        except Exception as e:
            logger.error(f"Database test failed: {e}")
            self.results["database_test"] = f"FAIL ({str(e)[:50]})"
            return False

    def test_data_quality(self) -> bool:
        """
        Validate data quality in database.

        Returns:
            True if data passes quality checks
        """
        logger.info("\n" + "="*70)
        logger.info("TEST 3: Data Quality Validation")
        logger.info("="*70)

        try:
            from smart_money_pipeline.config import get_config
            from smart_money_pipeline.common.db import (
                initialize_pool,
                execute_query,
            )

            config = get_config()
            initialize_pool(
                host=config.database.host,
                port=config.database.port,
                database=config.database.name,
                user=config.database.user,
                password=config.database.password,
                sslmode=config.database.ssl_mode,
            )

            all_good = True

            # Check Form 4 records
            logger.info("\n1. Form 4 Records:")
            query = """
                SELECT COUNT(*) as count FROM filings_4
                WHERE ticker IS NOT NULL AND transaction_date IS NOT NULL
            """
            result = execute_query(query, fetch_one=True)
            count = result["count"] if result else 0
            status = "✓" if count > 0 else "○"
            logger.info(f"   {status} Valid Form 4 records: {count}")

            # Check 13D records
            logger.info("\n2. 13D Records:")
            query = """
                SELECT COUNT(*) as count FROM filings_13d
                WHERE ticker IS NOT NULL AND filing_date IS NOT NULL
            """
            result = execute_query(query, fetch_one=True)
            count = result["count"] if result else 0
            status = "✓" if count > 0 else "○"
            logger.info(f"   {status} Valid 13D records: {count}")

            # Check 13F records
            logger.info("\n3. 13F Records:")
            query = """
                SELECT COUNT(*) as count FROM filings_13f
                WHERE ticker IS NOT NULL AND filing_date IS NOT NULL
            """
            result = execute_query(query, fetch_one=True)
            count = result["count"] if result else 0
            status = "✓" if count > 0 else "○"
            logger.info(f"   {status} Valid 13F records: {count}")

            # Check COT records
            logger.info("\n4. COT Records:")
            query = "SELECT COUNT(*) as count FROM cot WHERE report_date IS NOT NULL"
            result = execute_query(query, fetch_one=True)
            count = result["count"] if result else 0
            status = "✓" if count >= 52 else "○"
            logger.info(f"   {status} COT records: {count} (expected ≥52)")

            # Check short interest records
            logger.info("\n5. Short Interest Records:")
            query = """
                SELECT COUNT(*) as count FROM short_interest
                WHERE ticker IS NOT NULL AND settlement_date IS NOT NULL
            """
            result = execute_query(query, fetch_one=True)
            count = result["count"] if result else 0
            status = "✓" if count > 0 else "○"
            logger.info(f"   {status} Short interest records: {count}")

            # Check smart money scores
            logger.info("\n6. Smart Money Scores:")
            query = """
                SELECT COUNT(*) as count,
                       AVG(smart_money_score) as avg_score,
                       MIN(smart_money_score) as min_score,
                       MAX(smart_money_score) as max_score
                FROM smart_money_scores
            """
            result = execute_query(query, fetch_one=True)
            if result and result["count"] > 0:
                logger.info(f"   ✓ Total scores: {result['count']}")
                logger.info(f"     Avg score: {result['avg_score']:.2f}")
                logger.info(f"     Score range: {result['min_score']:.2f} - {result['max_score']:.2f}")
            else:
                logger.info(f"   ○ No scores computed yet")

            self.results["quality_test"] = "PASS" if all_good else "PARTIAL"
            return all_good

        except Exception as e:
            logger.error(f"Quality test failed: {e}")
            self.results["quality_test"] = f"FAIL ({str(e)[:50]})"
            return False

    def test_ticker_coverage(self) -> bool:
        """
        Validate coverage across Nasdaq-100 tickers.

        Returns:
            True if good coverage
        """
        logger.info("\n" + "="*70)
        logger.info("TEST 4: Ticker Coverage")
        logger.info("="*70)

        try:
            from smart_money_pipeline.config import get_config
            from smart_money_pipeline.common.db import (
                initialize_pool,
                execute_query,
            )

            config = get_config()
            initialize_pool(
                host=config.database.host,
                port=config.database.port,
                database=config.database.name,
                user=config.database.user,
                password=config.database.password,
                sslmode=config.database.ssl_mode,
            )

            # Key tickers to check
            key_tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "TSLA", "COST", "NFLX"]

            logger.info("\nData Coverage by Ticker:")
            logger.info(f"{'Ticker':<8} {'Form 4':<8} {'13D':<8} {'13F':<8} {'COT':<8} {'Score':<8}")
            logger.info("-" * 50)

            all_good = True
            for ticker in key_tickers:
                form4 = (
                    execute_query(
                        "SELECT COUNT(*) as count FROM filings_4 WHERE ticker = %s",
                        (ticker,),
                        fetch_one=True,
                    )["count"]
                    or 0
                )
                d13d = (
                    execute_query(
                        "SELECT COUNT(*) as count FROM filings_13d WHERE ticker = %s",
                        (ticker,),
                        fetch_one=True,
                    )["count"]
                    or 0
                )
                d13f = (
                    execute_query(
                        "SELECT COUNT(*) as count FROM filings_13f WHERE ticker = %s",
                        (ticker,),
                        fetch_one=True,
                    )["count"]
                    or 0
                )
                cot = (
                    execute_query(
                        "SELECT COUNT(*) as count FROM cot",
                        fetch_one=True,
                    )["count"]
                    or 0
                )
                score = (
                    execute_query(
                        "SELECT smart_money_score FROM smart_money_scores WHERE ticker = %s LIMIT 1",
                        (ticker,),
                        fetch_one=True,
                    )["smart_money_score"]
                    if execute_query(
                        "SELECT 1 FROM smart_money_scores WHERE ticker = %s LIMIT 1",
                        (ticker,),
                        fetch_one=True,
                    )
                    else None
                )

                score_str = f"{score:.1f}" if score else "N/A"
                logger.info(
                    f"{ticker:<8} {form4:<8} {d13d:<8} {d13f:<8} {cot:<8} {score_str:<8}"
                )

            self.results["coverage_test"] = "PASS"
            return True

        except Exception as e:
            logger.error(f"Coverage test failed: {e}")
            self.results["coverage_test"] = f"FAIL ({str(e)[:50]})"
            return False

    def generate_report(self):
        """Generate test report."""
        logger.info("\n" + "="*70)
        logger.info("TEST SUMMARY")
        logger.info("="*70)

        for test, result in self.results.items():
            logger.info(f"  {test:25} {result}")

        elapsed = (datetime.now() - self.start_time).total_seconds()
        logger.info(f"\nTotal test time: {elapsed:.1f}s")

        # Overall status
        failed = [r for r in self.results.values() if "FAIL" in r]
        if failed:
            logger.warning(f"\n⚠ {len(failed)} test(s) failed")
            logger.info("See details above for troubleshooting")
        else:
            logger.info("\n✓ All tests passed!")

    def run_full_suite(self):
        """Run all tests."""
        logger.info("\n" + "="*70)
        logger.info("CLOUD FUNCTION TEST SUITE")
        logger.info("="*70)

        self.test_via_database()
        self.test_data_quality()
        self.test_ticker_coverage()
        self.generate_report()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Test Cloud Function deployment"
    )
    parser.add_argument(
        "--url",
        help="Cloud Function HTTP endpoint URL",
    )
    parser.add_argument(
        "--database",
        action="store_true",
        help="Test via database records",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run full test suite",
    )

    args = parser.parse_args()

    tester = CloudFunctionTester()

    # Run tests based on arguments
    if args.url:
        tester.test_via_http(args.url)
    elif args.database or args.full:
        if args.full:
            tester.run_full_suite()
        else:
            tester.test_via_database()
            tester.test_data_quality()
            tester.generate_report()
    else:
        # Default: run full suite
        tester.run_full_suite()


if __name__ == "__main__":
    main()
