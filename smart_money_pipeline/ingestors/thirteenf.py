"""
13F Ingestor - SEC Institutional Holdings Data.
Fetches and parses 13F-HR filings from tracked smart money funds.
"""

from typing import List, Dict, Any
from datetime import datetime
import logging

from smart_money_pipeline.ingestors.base import BaseIngestor
from smart_money_pipeline.common.db import get_connection
from smart_money_pipeline.config import get_config

logger = logging.getLogger(__name__)


class ThirteenFIngestor(BaseIngestor):
    """Ingestor for SEC 13F institutional holdings data."""

    def __init__(self):
        """Initialize 13F ingestor."""
        super().__init__("13f")
        config = get_config()
        self.fund_ciks = config.funds.fund_ciks
        self.include_options = config.funds.include_options

    def fetch(self) -> List[Dict[str, Any]]:
        """
        Fetch 13F-HR filings from SEC EDGAR for tracked funds.

        Returns:
            List of raw 13F position records
        """
        try:
            logger.info("Fetching 13F-HR filings from SEC EDGAR...")

            # Placeholder: Production would fetch 13F filings for each fund_cik
            # and parse the XML table format (IT1, IT2, etc.)

            thirteenf_data = []

            logger.info(f"Found {len(thirteenf_data)} 13F positions")
            return thirteenf_data

        except Exception as e:
            logger.error(f"Error fetching 13F data: {e}")
            return []

    def parse(self, raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Parse raw 13F holdings into normalized format.

        Expected input fields:
        - fund_cik, fund_name: Fund identifier and name
        - ticker: Stock ticker
        - shares_held: Number of shares held
        - market_value: Market value in thousands (13F units)
        - pct_of_fund_portfolio: Percentage of fund portfolio
        - period_of_report: Report end date (quarter end)
        - filed_at: Filing date
        - put_call_flag: 'C' for calls, 'P' for puts, or blank for stock
        - option_notional: Notional value for options (optional)

        Returns:
            List of normalized 13F records
        """
        parsed = []

        for record in raw_data:
            try:
                # Skip if not tracking this fund
                fund_cik = record.get("fund_cik", "").lstrip("0")
                if fund_cik not in [v.lstrip("0") for v in self.fund_ciks.values()]:
                    continue

                # Skip puts/calls if not including options
                put_call_flag = (record.get("put_call_flag") or "").upper()
                if not self.include_options and put_call_flag in ["P", "C"]:
                    continue

                normalized = {
                    "fund_cik": fund_cik,
                    "fund_name": record.get("fund_name", ""),
                    "ticker": record.get("ticker", "").upper(),
                    "shares_held": int(record.get("shares_held", 0)),
                    "market_value": int(record.get("market_value", 0)),  # in thousands
                    "pct_of_fund_portfolio": float(record.get("pct_of_fund_portfolio", 0.0)),
                    "period_of_report": record.get("period_of_report"),
                    "filed_at": record.get("filed_at"),
                    "put_call_flag": put_call_flag or None,
                    "option_notional": float(record.get("option_notional", 0.0)) if put_call_flag else None,
                }

                # Validate required fields
                if normalized["fund_cik"] and normalized["ticker"] and normalized["period_of_report"]:
                    parsed.append(normalized)

            except (ValueError, TypeError) as e:
                logger.warning(f"Error parsing 13F record: {e}")
                continue

        logger.info(f"Parsed {len(parsed)} 13F positions")
        return parsed

    def store(self, parsed_data: List[Dict[str, Any]]) -> bool:
        """
        Store parsed 13F data to database.

        Args:
            parsed_data: List of normalized 13F records

        Returns:
            True if successful
        """
        if not parsed_data:
            logger.info("No 13F data to store")
            return True

        try:
            conn = get_connection()
            cur = conn.cursor()

            # Batch insert with upsert
            query = """
                INSERT INTO thirteenf_positions
                (fund_cik, fund_name, ticker, shares_held, market_value, pct_of_fund_portfolio,
                 period_of_report, filed_at, put_call_flag, option_notional)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (fund_cik, ticker, period_of_report, put_call_flag) DO NOTHING
            """

            for i in range(0, len(parsed_data), self.batch_size):
                batch = parsed_data[i : i + self.batch_size]
                values = [
                    (
                        r["fund_cik"],
                        r["fund_name"],
                        r["ticker"],
                        r["shares_held"],
                        r["market_value"],
                        r["pct_of_fund_portfolio"],
                        r["period_of_report"],
                        r["filed_at"],
                        r["put_call_flag"],
                        r["option_notional"],
                    )
                    for r in batch
                ]

                cur.executemany(query, values)
                conn.commit()
                logger.info(f"✓ Stored batch of {len(batch)} 13F records")

            cur.close()
            logger.info(f"✓ Successfully stored {len(parsed_data)} 13F positions")
            return True

        except Exception as e:
            logger.error(f"Error storing 13F data: {e}")
            return False
