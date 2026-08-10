"""
Short Interest Ingestor - FINRA Short Interest Data.
Fetches bi-weekly short interest data from FINRA.
"""

from typing import List, Dict, Any
from datetime import datetime
import logging

from smart_money_pipeline.ingestors.base import BaseIngestor
from smart_money_pipeline.common.db import get_connection

logger = logging.getLogger(__name__)


class ShortInterestIngestor(BaseIngestor):
    """Ingestor for FINRA short interest data."""

    def __init__(self):
        """Initialize Short Interest ingestor."""
        super().__init__("short_interest")

    def fetch(self) -> List[Dict[str, Any]]:
        """
        Fetch FINRA short interest data.

        Returns:
            List of raw short interest records
        """
        try:
            logger.info("Fetching FINRA short interest data...")

            # Placeholder: Production would fetch from FINRA
            # FINRA publishes bi-weekly short interest data
            # Available endpoints:
            # - FINRA Market Data Gateway
            # - CSV downloads at: http://www.finra.org/Research/MarketData/

            short_interest_data = []

            logger.info(f"Found {len(short_interest_data)} short interest records")
            return short_interest_data

        except Exception as e:
            logger.error(f"Error fetching short interest data: {e}")
            return []

    def parse(self, raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Parse raw short interest data into normalized format.

        Expected input fields:
        - ticker: Stock ticker
        - settlement_date: Settlement date for the short interest snapshot
        - shares_short: Total shares held short
        - prior_shares_short: Previous settlement's short shares (for calculating change)
        - days_to_cover: Days to cover (shares short / avg daily volume)
        - pct_float_short: Percentage of float that is short

        Returns:
            List of normalized short interest records
        """
        parsed = []

        for record in raw_data:
            try:
                normalized = {
                    "ticker": record.get("ticker", "").upper(),
                    "settlement_date": record.get("settlement_date"),
                    "shares_short": int(record.get("shares_short", 0)),
                    "prior_shares_short": int(record.get("prior_shares_short", 0)),
                    "days_to_cover": float(record.get("days_to_cover", 0.0)),
                    "pct_float_short": float(record.get("pct_float_short", 0.0)),
                }

                # Validate required fields
                if normalized["ticker"] and normalized["settlement_date"]:
                    parsed.append(normalized)

            except (ValueError, TypeError) as e:
                logger.warning(f"Error parsing short interest record: {e}")
                continue

        logger.info(f"Parsed {len(parsed)} short interest records")
        return parsed

    def store(self, parsed_data: List[Dict[str, Any]]) -> bool:
        """
        Store parsed short interest data to database.

        Args:
            parsed_data: List of normalized short interest records

        Returns:
            True if successful
        """
        if not parsed_data:
            logger.info("No short interest data to store")
            return True

        try:
            conn = get_connection()
            cur = conn.cursor()

            # Batch insert with upsert
            query = """
                INSERT INTO short_interest
                (ticker, settlement_date, shares_short, prior_shares_short, days_to_cover, pct_float_short)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (ticker, settlement_date) DO NOTHING
            """

            for i in range(0, len(parsed_data), self.batch_size):
                batch = parsed_data[i : i + self.batch_size]
                values = [
                    (
                        r["ticker"],
                        r["settlement_date"],
                        r["shares_short"],
                        r["prior_shares_short"],
                        r["days_to_cover"],
                        r["pct_float_short"],
                    )
                    for r in batch
                ]

                cur.executemany(query, values)
                conn.commit()
                logger.info(f"✓ Stored batch of {len(batch)} short interest records")

            cur.close()
            logger.info(f"✓ Successfully stored {len(parsed_data)} short interest records")
            return True

        except Exception as e:
            logger.error(f"Error storing short interest data: {e}")
            return False
