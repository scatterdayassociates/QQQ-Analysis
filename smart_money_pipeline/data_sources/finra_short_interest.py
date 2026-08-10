"""
FINRA Short Interest Data Integration.
Fetches bi-weekly short interest data via FINRA Query API or CSV downloads.
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import requests
import csv
from io import StringIO

logger = logging.getLogger(__name__)


class FINRAShortInterestClient:
    """Client for FINRA short interest data."""

    def __init__(self):
        """Initialize FINRA client."""
        # FINRA provides short interest data via:
        # 1. Query API (requires authentication)
        # 2. CSV downloads at: http://www.finra.org/Research/MarketData/

        self.query_api_base = "https://api.finra.org/data/group/MarketData"
        self.csv_download_url = (
            "http://www.finra.org/webservices/MarketDataDownload.aspx"
        )
        self.headers = {
            "User-Agent": "QQQ-Analysis/1.0 (Smart Money Pipeline)",
        }

    def fetch_short_interest(
        self, ticker: str, lookback_days: int = 180
    ) -> List[Dict[str, Any]]:
        """
        Fetch short interest data for a ticker.

        FINRA publishes data bi-weekly (settlement dates around mid-month and end-of-month).

        Args:
            ticker: Stock ticker
            lookback_days: How far back to fetch

        Returns:
            List of short interest records by settlement date
        """
        try:
            logger.info(f"Fetching short interest for {ticker} ({lookback_days} days)")

            # Try Query API first (if authenticated)
            si_data = self._fetch_via_query_api(ticker, lookback_days)

            if si_data:
                logger.info(f"Fetched {len(si_data)} short interest records for {ticker} via Query API")
                return si_data

            # Fall back to CSV download
            logger.info("Query API unavailable, attempting CSV download...")
            si_data = self._fetch_via_csv(ticker, lookback_days)

            logger.info(f"Fetched {len(si_data)} short interest records for {ticker} via CSV")
            return si_data

        except Exception as e:
            logger.error(f"Error fetching short interest for {ticker}: {e}")
            return []

    def _fetch_via_query_api(
        self, ticker: str, lookback_days: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch via FINRA Query API.

        Requires API authentication. This is a premium API requiring:
        - API credentials
        - Subscription to FINRA Market Data services

        Args:
            ticker: Stock ticker
            lookback_days: Lookback period

        Returns:
            List of short interest records (empty if API unavailable)
        """
        try:
            # Query API endpoint would be something like:
            # GET /group/MarketData/SecurityShortInterest?symbol=TICKER

            params = {
                "symbol": ticker,
                "from": (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d"),
                "to": datetime.now().strftime("%Y-%m-%d"),
            }

            # This requires authentication headers
            # For now, this will fail gracefully and fall back to CSV
            response = requests.get(
                f"{self.query_api_base}/SecurityShortInterest",
                params=params,
                headers=self.headers,
                timeout=10,
            )

            if response.status_code == 200:
                return self._parse_query_api_response(response.json())
            else:
                logger.warning(
                    f"Query API returned {response.status_code} for {ticker}"
                )
                return []

        except Exception as e:
            logger.debug(f"Query API fetch failed (expected if not authenticated): {e}")
            return []

    def _fetch_via_csv(
        self, ticker: str, lookback_days: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch short interest data from FINRA CSV downloads.

        FINRA publishes bi-weekly short interest reports:
        http://www.finra.org/Research/MarketData/

        The CSV files contain columns:
        - Settlement Date
        - Ticker
        - Shares Short
        - Shares Outstanding
        - Percent Short
        - Days To Cover

        Args:
            ticker: Stock ticker
            lookback_days: Lookback period

        Returns:
            List of short interest records
        """
        try:
            # FINRA CSV URL for bi-weekly short interest data
            # Format: http://www.finra.org/webservices/MarketDataDownload.aspx?type=shortinterest

            response = requests.get(
                self.csv_download_url,
                params={"type": "shortinterest"},
                headers=self.headers,
                timeout=30,
            )

            if response.status_code != 200:
                logger.warning(
                    f"FINRA CSV download returned {response.status_code}"
                )
                return []

            # Parse CSV data
            records = self._parse_csv_data(response.text, ticker, lookback_days)
            return records

        except Exception as e:
            logger.error(f"Error fetching FINRA CSV for {ticker}: {e}")
            return []

    def _parse_csv_data(
        self, csv_text: str, ticker: str, lookback_days: int
    ) -> List[Dict[str, Any]]:
        """
        Parse FINRA short interest CSV data.

        Args:
            csv_text: Raw CSV text
            ticker: Filter for this ticker
            lookback_days: Only include recent data

        Returns:
            List of parsed records
        """
        records = []
        lookback_date = datetime.now() - timedelta(days=lookback_days)

        try:
            reader = csv.DictReader(StringIO(csv_text))

            for row in reader:
                # Filter for our ticker
                if row.get("Ticker", "").upper() != ticker.upper():
                    continue

                try:
                    settlement_date = datetime.strptime(
                        row.get("Settlement Date", ""), "%m/%d/%Y"
                    )

                    # Only include recent data
                    if settlement_date < lookback_date:
                        continue

                    record = {
                        "ticker": ticker.upper(),
                        "settlement_date": settlement_date.strftime("%Y-%m-%d"),
                        "shares_short": int(row.get("Shares Short", "0").replace(",", "")),
                        "prior_shares_short": 0,  # Could calculate from previous row
                        "days_to_cover": float(row.get("Days To Cover", "0")),
                        "pct_float_short": float(
                            row.get("Percent Short", "0").rstrip("%")
                        ),
                        "source": "finra_csv",
                        "fetched_at": datetime.now().isoformat(),
                    }
                    records.append(record)

                except (ValueError, KeyError) as e:
                    logger.debug(f"Error parsing row for {ticker}: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error parsing FINRA CSV: {e}")

        return records

    def _parse_query_api_response(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Parse FINRA Query API JSON response.

        Args:
            data: Parsed JSON response

        Returns:
            List of short interest records
        """
        records = []

        try:
            # API response structure (varies by endpoint)
            for item in data.get("data", []):
                record = {
                    "ticker": item.get("symbol", "").upper(),
                    "settlement_date": item.get("settlementDate"),
                    "shares_short": int(item.get("sharesShort", 0)),
                    "prior_shares_short": int(item.get("priorSharesShort", 0)),
                    "days_to_cover": float(item.get("daysTocover", 0)),
                    "pct_float_short": float(item.get("percentFloatShort", 0)),
                    "source": "finra_api",
                    "fetched_at": datetime.now().isoformat(),
                }
                records.append(record)

        except Exception as e:
            logger.warning(f"Error parsing FINRA API response: {e}")

        return records


def get_short_interest_data(ticker: str, days: int = 180) -> List[Dict[str, Any]]:
    """
    Convenience function to fetch short interest data.

    Args:
        ticker: Stock ticker
        days: Lookback period in days

    Returns:
        List of short interest records
    """
    client = FINRAShortInterestClient()
    return client.fetch_short_interest(ticker, days)
