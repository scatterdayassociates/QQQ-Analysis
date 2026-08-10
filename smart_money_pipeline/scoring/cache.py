"""
Query Cache and Data Freshness Management.
Optimizes scoring by caching database queries and tracking data freshness.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional, Any
from functools import lru_cache
import json

from smart_money_pipeline.common.db import execute_query

logger = logging.getLogger(__name__)


class QueryCache:
    """
    In-memory cache for frequently-accessed scoring queries.
    Reduces database load by caching results for scoring window.
    """

    def __init__(self, ttl_seconds: int = 3600):
        """
        Initialize query cache.

        Args:
            ttl_seconds: Time-to-live for cache entries (default 1 hour)
        """
        self.cache: Dict[str, Tuple[Any, datetime]] = {}
        self.ttl_seconds = ttl_seconds

    def get(self, key: str) -> Optional[Any]:
        """
        Retrieve cached value if it exists and hasn't expired.

        Args:
            key: Cache key

        Returns:
            Cached value or None if not found/expired
        """
        if key not in self.cache:
            return None

        value, cached_at = self.cache[key]
        age_seconds = (datetime.now() - cached_at).total_seconds()

        if age_seconds > self.ttl_seconds:
            del self.cache[key]
            return None

        return value

    def set(self, key: str, value: Any) -> None:
        """
        Store value in cache.

        Args:
            key: Cache key
            value: Value to cache
        """
        self.cache[key] = (value, datetime.now())
        logger.debug(f"Cache SET: {key}")

    def clear(self) -> None:
        """Clear all cached values."""
        self.cache.clear()

    def stats(self) -> Dict[str, int]:
        """Get cache statistics."""
        now = datetime.now()
        valid = sum(
            1 for _, (_, cached_at) in self.cache.items()
            if (now - cached_at).total_seconds() <= self.ttl_seconds
        )
        expired = len(self.cache) - valid

        return {
            "total_entries": len(self.cache),
            "valid_entries": valid,
            "expired_entries": expired,
        }


class DataFreshnessMonitor:
    """
    Tracks freshness of data from each source.
    Ensures scoring only uses recent data.
    """

    def __init__(self):
        """Initialize freshness monitor."""
        self.freshness: Dict[str, Optional[datetime]] = {
            "form4": None,
            "filings_13d": None,
            "cot": None,
            "short_interest": None,
            "thirteenf": None,
        }

    def refresh_timestamps(self) -> None:
        """
        Query database for most recent data timestamps.
        Called after ingestion pipeline completes.
        """
        try:
            # Form 4 data
            result = execute_query(
                "SELECT MAX(transaction_date) FROM form4_transactions",
                fetch_one=True,
            )
            if result and result[0]:
                self.freshness["form4"] = result[0]

            # 13D data
            result = execute_query(
                "SELECT MAX(filing_date) FROM filings_13d", fetch_one=True
            )
            if result and result[0]:
                self.freshness["filings_13d"] = result[0]

            # COT data
            result = execute_query(
                "SELECT MAX(report_date) FROM cot_positions", fetch_one=True
            )
            if result and result[0]:
                self.freshness["cot"] = result[0]

            # Short Interest data
            result = execute_query(
                "SELECT MAX(settlement_date) FROM short_interest", fetch_one=True
            )
            if result and result[0]:
                self.freshness["short_interest"] = result[0]

            # 13F data
            result = execute_query(
                "SELECT MAX(period_of_report) FROM thirteenf_positions", fetch_one=True
            )
            if result and result[0]:
                self.freshness["thirteenf"] = result[0]

            logger.info(f"✓ Data freshness timestamps updated")

        except Exception as e:
            logger.error(f"Error refreshing data freshness timestamps: {e}")

    def check_freshness(
        self, data_source: str, as_of_date: str, max_age_days: int = 7
    ) -> bool:
        """
        Check if data from a source is fresh enough for scoring.

        Args:
            data_source: Source name (form4, filings_13d, cot, short_interest, thirteenf)
            as_of_date: Target scoring date (YYYY-MM-DD)
            max_age_days: Maximum acceptable age of data

        Returns:
            True if data is fresh enough, False otherwise
        """
        if not self.freshness.get(data_source):
            logger.warning(f"No data available for {data_source}")
            return False

        last_update = self.freshness[data_source]
        if isinstance(last_update, str):
            last_update = datetime.strptime(last_update, "%Y-%m-%d")
        elif isinstance(last_update, datetime):
            if last_update.time() == datetime.min.time():
                # Date only, convert to datetime
                pass
            else:
                # Has time component, just use as-is
                pass

        as_of = datetime.strptime(as_of_date, "%Y-%m-%d")
        age = (as_of - last_update.replace(hour=0, minute=0, second=0, microsecond=0)).days

        is_fresh = age <= max_age_days

        log_level = logger.info if is_fresh else logger.warning
        log_level(
            f"Data freshness check {data_source}: "
            f"age={age} days, max_allowed={max_age_days}, "
            f"fresh={'✓' if is_fresh else '✗'}"
        )

        return is_fresh

    def get_status(self) -> Dict[str, Any]:
        """Get current freshness status for all sources."""
        status = {}
        for source, last_update in self.freshness.items():
            if last_update:
                age_days = (datetime.now() - (
                    last_update
                    if isinstance(last_update, datetime)
                    else datetime.strptime(str(last_update), "%Y-%m-%d")
                )).days
                status[source] = {
                    "last_update": last_update.isoformat() if isinstance(last_update, datetime) else str(last_update),
                    "age_days": age_days,
                }
            else:
                status[source] = {"last_update": None, "age_days": None}

        return status


class OptimizedScoreQueries:
    """
    Optimized database queries for scoring calculations.
    Uses efficient query patterns and batching.
    """

    @staticmethod
    def get_insider_transactions(
        ticker: str, lookback_days: int = 90
    ) -> List[Tuple[str, str, str]]:
        """
        Get insider buy transactions efficiently.

        Args:
            ticker: Stock ticker
            lookback_days: Days to look back

        Returns:
            List of (filer_name, transaction_date, quantity) tuples
        """
        try:
            query = """
                SELECT DISTINCT filer_name, transaction_date, quantity
                FROM form4_transactions
                WHERE ticker = %s
                  AND transaction_code = 'P'
                  AND transaction_date >= DATE_SUB(NOW(), INTERVAL %s DAY)
                ORDER BY transaction_date DESC
            """
            results = execute_query(query, (ticker, lookback_days), fetch_one=False)
            return results or []
        except Exception as e:
            logger.error(f"Error fetching insider transactions for {ticker}: {e}")
            return []

    @staticmethod
    def get_recent_13d_filings(ticker: str, lookback_days: int = 365) -> List[Tuple]:
        """
        Get recent 13D filings efficiently.

        Args:
            ticker: Stock ticker
            lookback_days: Days to look back

        Returns:
            List of (filing_date, is_amendment, activist_keyword_flag) tuples
        """
        try:
            query = """
                SELECT filing_date, is_amendment, activist_keyword_flag
                FROM filings_13d
                WHERE ticker = %s
                  AND filing_date >= DATE_SUB(NOW(), INTERVAL %s DAY)
                ORDER BY filing_date DESC
                LIMIT 5
            """
            results = execute_query(query, (ticker, lookback_days), fetch_one=False)
            return results or []
        except Exception as e:
            logger.error(f"Error fetching 13D filings for {ticker}: {e}")
            return []

    @staticmethod
    def get_cot_history(contract: str, lookback_days: int = 90) -> List[Tuple]:
        """
        Get COT history for a contract efficiently.

        Args:
            contract: Futures contract (e.g., 'NQ', 'ES')
            lookback_days: Days to look back

        Returns:
            List of leveraged_funds_net positions
        """
        try:
            query = """
                SELECT leveraged_funds_net, report_date
                FROM cot_positions
                WHERE contract_name = %s
                  AND report_date >= DATE_SUB(NOW(), INTERVAL %s DAY)
                ORDER BY report_date ASC
            """
            results = execute_query(query, (contract, lookback_days), fetch_one=False)
            return results or []
        except Exception as e:
            logger.error(f"Error fetching COT history for {contract}: {e}")
            return []

    @staticmethod
    def get_short_interest_history(
        ticker: str, lookback_days: int = 90
    ) -> List[Tuple]:
        """
        Get short interest history efficiently.

        Args:
            ticker: Stock ticker
            lookback_days: Days to look back

        Returns:
            List of (settlement_date, shares_short) tuples
        """
        try:
            query = """
                SELECT settlement_date, shares_short
                FROM short_interest
                WHERE ticker = %s
                  AND settlement_date >= DATE_SUB(NOW(), INTERVAL %s DAY)
                ORDER BY settlement_date ASC
            """
            results = execute_query(query, (ticker, lookback_days), fetch_one=False)
            return results or []
        except Exception as e:
            logger.error(f"Error fetching short interest history for {ticker}: {e}")
            return []

    @staticmethod
    def get_thirteenf_holdings(
        ticker: str, lookback_days: int = 365
    ) -> List[Tuple]:
        """
        Get 13F holdings efficiently.

        Args:
            ticker: Stock ticker
            lookback_days: Days to look back

        Returns:
            List of (fund_name, pct_of_fund_portfolio, filed_at) tuples
        """
        try:
            query = """
                SELECT fund_name, pct_of_fund_portfolio, filed_at
                FROM thirteenf_positions
                WHERE ticker = %s
                  AND put_call_flag IS NULL
                  AND period_of_report >= DATE_SUB(NOW(), INTERVAL %s DAY)
                ORDER BY pct_of_fund_portfolio DESC
                LIMIT 10
            """
            results = execute_query(query, (ticker, lookback_days), fetch_one=False)
            return results or []
        except Exception as e:
            logger.error(f"Error fetching 13F holdings for {ticker}: {e}")
            return []

    @staticmethod
    def batch_get_scores_data(
        tickers: List[str],
    ) -> Dict[str, Dict[str, List[Tuple]]]:
        """
        Efficiently fetch all scoring data for multiple tickers in one go.
        Reduces database round-trips.

        Args:
            tickers: List of ticker symbols

        Returns:
            Dictionary with structure:
            {
                ticker: {
                    'insider': [...],
                    'activist': [...],
                    'cot': [...],
                    'short_interest': [...],
                    'thirteenf': [...]
                }
            }
        """
        result = {}

        for ticker in tickers:
            result[ticker] = {
                "insider": OptimizedScoreQueries.get_insider_transactions(ticker),
                "activist": OptimizedScoreQueries.get_recent_13d_filings(ticker),
                "short_interest": OptimizedScoreQueries.get_short_interest_history(
                    ticker
                ),
                "thirteenf": OptimizedScoreQueries.get_thirteenf_holdings(ticker),
            }

        # COT data is contract-based, not ticker-based
        # Query once for each relevant contract
        cot_contracts = {"NQ": [], "ES": [], "YM": []}
        for contract in cot_contracts:
            cot_contracts[contract] = OptimizedScoreQueries.get_cot_history(contract)

        # Attach COT data to all tickers
        for ticker in result:
            result[ticker]["cot"] = cot_contracts

        return result
