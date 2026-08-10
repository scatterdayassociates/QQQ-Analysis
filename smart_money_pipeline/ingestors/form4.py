"""
Form 4 Ingestor - SEC Insider Transaction Data.
Fetches insider buy/sell transactions from SEC EDGAR.
"""

from typing import List, Dict, Any
from datetime import datetime
import logging
import requests

from smart_money_pipeline.ingestors.base import BaseIngestor
from smart_money_pipeline.common.db import get_connection

logger = logging.getLogger(__name__)


class Form4Ingestor(BaseIngestor):
    """Ingestor for SEC Form 4 insider transactions."""

    def __init__(self):
        """Initialize Form 4 ingestor."""
        super().__init__("form4")
        self.sec_api_base = "https://www.sec.gov/cgi-bin/browse-edgar"

    def fetch(self) -> List[Dict[str, Any]]:
        """
        Fetch Form 4 filings from SEC EDGAR.

        Returns:
            List of raw Form 4 filing records
        """
        try:
            # This is a placeholder - actual implementation requires:
            # 1. Get list of CIKs from ticker_to_cik table
            # 2. Query SEC EDGAR for each CIK's Form 4 filings
            # 3. Parse filing documents to extract transaction details
            # 4. Filter for buys (transaction_code = 'P') vs sales ('S')

            logger.info("Fetching Form 4 data from SEC EDGAR...")

            # For now, return empty list (will be populated with real data)
            # Production implementation would query SEC API with rate limiting
            form4_data = []

            logger.info(f"Found {len(form4_data)} Form 4 transactions")
            return form4_data

        except Exception as e:
            logger.error(f"Error fetching Form 4 data: {e}")
            return []

    def parse(self, raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Parse raw Form 4 filings into normalized format.

        Expected input fields:
        - cik, ticker, filer_name, filer_role
        - is_officer, is_director
        - transaction_code ('P'=buy, 'S'=sale, 'A'=award, 'M'=option exercise)
        - transaction_date, shares, price, shares_owned_after
        - filed_at

        Returns:
            List of normalized Form 4 records
        """
        parsed = []

        for record in raw_data:
            try:
                # Only process buys (P) for insider cluster scoring
                if record.get("transaction_code") not in ["P", "A"]:  # Include awards
                    continue

                normalized = {
                    "ticker": record.get("ticker", "").upper(),
                    "cik": record.get("cik", "").lstrip("0"),
                    "filer_name": record.get("filer_name", ""),
                    "filer_role": record.get("filer_role", ""),
                    "is_officer": record.get("is_officer", False),
                    "is_director": record.get("is_director", False),
                    "transaction_code": record.get("transaction_code", ""),
                    "transaction_date": record.get("transaction_date"),
                    "shares": int(record.get("shares", 0)),
                    "price": float(record.get("price", 0.0)),
                    "shares_owned_after": int(record.get("shares_owned_after", 0)),
                    "filed_at": record.get("filed_at"),
                }

                # Validate required fields
                if normalized["ticker"] and normalized["cik"] and normalized["transaction_date"]:
                    parsed.append(normalized)

            except (ValueError, TypeError) as e:
                logger.warning(f"Error parsing Form 4 record: {e}")
                continue

        logger.info(f"Parsed {len(parsed)} Form 4 transactions")
        return parsed

    def store(self, parsed_data: List[Dict[str, Any]]) -> bool:
        """
        Store parsed Form 4 data to database.

        Args:
            parsed_data: List of normalized Form 4 records

        Returns:
            True if successful
        """
        if not parsed_data:
            logger.info("No Form 4 data to store")
            return True

        try:
            conn = get_connection()
            cur = conn.cursor()

            # Batch insert with upsert (ON CONFLICT)
            query = """
                INSERT INTO form4_transactions
                (ticker, cik, filer_name, filer_role, is_officer, is_director,
                 transaction_code, transaction_date, shares, price, shares_owned_after, filed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (cik, transaction_date, shares, price) DO NOTHING
            """

            for i in range(0, len(parsed_data), self.batch_size):
                batch = parsed_data[i : i + self.batch_size]
                values = [
                    (
                        r["ticker"],
                        r["cik"],
                        r["filer_name"],
                        r["filer_role"],
                        r["is_officer"],
                        r["is_director"],
                        r["transaction_code"],
                        r["transaction_date"],
                        r["shares"],
                        r["price"],
                        r["shares_owned_after"],
                        r["filed_at"],
                    )
                    for r in batch
                ]

                cur.executemany(query, values)
                conn.commit()
                logger.info(f"✓ Stored batch of {len(batch)} Form 4 records")

            cur.close()
            logger.info(f"✓ Successfully stored {len(parsed_data)} Form 4 transactions")
            return True

        except Exception as e:
            logger.error(f"Error storing Form 4 data: {e}")
            return False
