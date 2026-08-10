"""
SEC EDGAR API Integration.
Fetches Form 4, 13D, and 13F filings from SEC EDGAR.
"""

import logging
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import requests
from xml.etree import ElementTree as ET

from smart_money_pipeline.config import get_config

logger = logging.getLogger(__name__)


class SECEdgarAPI:
    """Client for SEC EDGAR REST API."""

    def __init__(self):
        """Initialize SEC EDGAR API client."""
        self.config = get_config()
        self.base_url = "https://www.sec.gov/cgi-bin/browse-edgar"
        self.data_url = "https://data.sec.gov/submissions"
        self.headers = {
            "User-Agent": self.config.sec.user_agent,
        }
        self.rate_limiter = RateLimiter(requests_per_second=self.config.sec.rate_limit_per_sec)

    def fetch_form4_filings(
        self, cik: str, lookback_days: int = 90
    ) -> List[Dict[str, Any]]:
        """
        Fetch Form 4 filings for a CIK.

        Args:
            cik: Central Index Key (10-digit string, zero-padded)
            lookback_days: How far back to search

        Returns:
            List of Form 4 filing metadata
        """
        try:
            # Form 4 = insider transaction forms
            params = {
                "action": "getcompany",
                "CIK": cik,
                "type": "4",
                "dateb": "",
                "owner": "exclude",
                "count": 100,
                "search_text": "",
            }

            self.rate_limiter.wait()
            response = requests.get(
                self.base_url, params=params, headers=self.headers, timeout=10
            )
            response.raise_for_status()

            # Parse HTML to find filing links
            filings = self._parse_edgar_filings_html(response.text, lookback_days)
            logger.info(f"Found {len(filings)} Form 4 filings for CIK {cik}")

            return filings

        except Exception as e:
            logger.error(f"Error fetching Form 4 filings for {cik}: {e}")
            return []

    def fetch_13d_filings(
        self, lookback_days: int = 90
    ) -> List[Dict[str, Any]]:
        """
        Fetch recent 13D/13D-A filings across all filers.

        Uses full-text search to find activist filings.

        Args:
            lookback_days: How far back to search

        Returns:
            List of 13D filing metadata
        """
        try:
            # Search for 13D/13D-A filings (activist stakes)
            lookback_date = (datetime.now() - timedelta(days=lookback_days)).strftime(
                "%Y-%m-%d"
            )

            params = {
                "action": "getcompany",
                "type": "13D",
                "dateb": "",
                "owner": "exclude",
                "count": 100,
                "search_text": "",
            }

            self.rate_limiter.wait()
            response = requests.get(
                self.base_url, params=params, headers=self.headers, timeout=10
            )
            response.raise_for_status()

            filings = self._parse_edgar_filings_html(response.text, lookback_days)
            logger.info(f"Found {len(filings)} 13D filings in last {lookback_days} days")

            return filings

        except Exception as e:
            logger.error(f"Error fetching 13D filings: {e}")
            return []

    def fetch_13f_filings(self, fund_cik: str) -> List[Dict[str, Any]]:
        """
        Fetch 13F-HR filings for a fund.

        Args:
            fund_cik: Fund's Central Index Key

        Returns:
            List of 13F filing metadata
        """
        try:
            params = {
                "action": "getcompany",
                "CIK": fund_cik,
                "type": "13F-HR",
                "dateb": "",
                "owner": "exclude",
                "count": 40,  # Last 10 quarters
                "search_text": "",
            }

            self.rate_limiter.wait()
            response = requests.get(
                self.base_url, params=params, headers=self.headers, timeout=10
            )
            response.raise_for_status()

            filings = self._parse_edgar_filings_html(response.text)
            logger.info(f"Found {len(filings)} 13F-HR filings for fund {fund_cik}")

            return filings

        except Exception as e:
            logger.error(f"Error fetching 13F filings for {fund_cik}: {e}")
            return []

    def fetch_form4_details(self, filing_url: str) -> Dict[str, Any]:
        """
        Fetch and parse Form 4 XML document.

        Args:
            filing_url: URL to Form 4 filing document

        Returns:
            Parsed Form 4 transaction data
        """
        try:
            self.rate_limiter.wait()
            response = requests.get(filing_url, headers=self.headers, timeout=10)
            response.raise_for_status()

            # Parse XML to extract transaction details
            root = ET.fromstring(response.content)

            transactions = []
            for tx in root.findall(".//nonDerivativeTransaction"):
                transaction = {
                    "transaction_code": tx.findtext("transactionCode", ""),
                    "transaction_date": tx.findtext("transactionDate", ""),
                    "shares": int(tx.findtext("shares", "0") or 0),
                    "price": float(tx.findtext("pricePerShare", "0") or 0),
                }
                transactions.append(transaction)

            return {
                "url": filing_url,
                "transactions": transactions,
                "fetched_at": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Error fetching Form 4 details from {filing_url}: {e}")
            return {"url": filing_url, "transactions": [], "error": str(e)}

    def fetch_13d_details(self, filing_url: str) -> Dict[str, Any]:
        """
        Fetch and parse 13D filing document.

        Args:
            filing_url: URL to 13D filing document

        Returns:
            Parsed 13D data (ownership %, company info, etc.)
        """
        try:
            self.rate_limiter.wait()
            response = requests.get(filing_url, headers=self.headers, timeout=10)
            response.raise_for_status()

            # Parse HTML/text to extract key information
            text = response.text.lower()

            # Extract ownership percentage (look for "% of class")
            pct_owned = self._extract_percentage(response.text, "% of class")

            return {
                "url": filing_url,
                "pct_owned": pct_owned,
                "filing_text": response.text,
                "fetched_at": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Error fetching 13D details from {filing_url}: {e}")
            return {"url": filing_url, "error": str(e)}

    def fetch_13f_details(self, filing_url: str) -> Dict[str, Any]:
        """
        Fetch and parse 13F-HR XML table.

        Args:
            filing_url: URL to 13F-HR filing document

        Returns:
            Parsed holdings data
        """
        try:
            # Find the XML file URL (typically infotable.xml)
            self.rate_limiter.wait()
            response = requests.get(filing_url, headers=self.headers, timeout=10)
            response.raise_for_status()

            # Parse XML holdings
            root = ET.fromstring(response.content)

            holdings = []
            for holding in root.findall(".//infoTable"):
                stock_data = {
                    "ticker": holding.findtext("cusip", ""),
                    "shares_held": int(holding.findtext("shrsOrPrnAmt", "0") or 0),
                    "market_value": int(holding.findtext("value", "0") or 0),
                    "pct_of_portfolio": float(
                        holding.findtext("shPrnamtFlag", "0") or 0
                    ),
                }
                holdings.append(stock_data)

            return {
                "url": filing_url,
                "holdings": holdings,
                "fetched_at": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Error fetching 13F details from {filing_url}: {e}")
            return {"url": filing_url, "holdings": [], "error": str(e)}

    def _parse_edgar_filings_html(
        self, html: str, lookback_days: int = 90
    ) -> List[Dict[str, Any]]:
        """
        Parse EDGAR search results HTML to extract filing metadata.

        Args:
            html: HTML response from EDGAR
            lookback_days: Filter filings within this many days

        Returns:
            List of filing metadata with dates and document links
        """
        filings = []
        lookback_date = datetime.now() - timedelta(days=lookback_days)

        try:
            # Simple regex parsing for filing table rows
            # In production, use BeautifulSoup for robust HTML parsing
            import re

            # Pattern: filing date, form type, document link
            filing_pattern = r'<tr.*?</tr>'
            for row in re.findall(filing_pattern, html, re.DOTALL):
                # Extract date, form type, and link
                date_match = re.search(r'(\d{4}-\d{2}-\d{2})', row)
                link_match = re.search(r'href="([^"]*?)0001193125[^"]*?"', row)

                if date_match and link_match:
                    filing_date = datetime.strptime(date_match.group(1), "%Y-%m-%d")

                    # Only include recent filings
                    if filing_date >= lookback_date:
                        filings.append(
                            {
                                "date": filing_date.strftime("%Y-%m-%d"),
                                "link": link_match.group(1),
                                "fetched_at": datetime.now().isoformat(),
                            }
                        )

        except Exception as e:
            logger.warning(f"Error parsing EDGAR HTML: {e}")

        return filings

    def _extract_percentage(self, text: str, pattern: str) -> Optional[float]:
        """Extract percentage from text."""
        import re

        match = re.search(r'(\d+\.?\d*)\s*%\s*of\s*class', text, re.IGNORECASE)
        if match:
            return float(match.group(1))
        return None


class RateLimiter:
    """Rate limiter for API requests."""

    def __init__(self, requests_per_second: float = 5.0):
        """
        Initialize rate limiter.

        Args:
            requests_per_second: Max requests per second
        """
        self.requests_per_second = requests_per_second
        self.min_interval = 1.0 / requests_per_second
        self.last_request_time = 0

    def wait(self):
        """Wait if necessary to respect rate limit."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self.last_request_time = time.time()
