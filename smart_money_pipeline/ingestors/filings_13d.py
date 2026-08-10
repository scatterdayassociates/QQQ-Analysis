"""
13D Ingestor - SEC Activist Stake Filings.
Fetches Schedule 13D/13D-A filings from SEC EDGAR.
"""

from typing import List, Dict, Any
from datetime import datetime
import logging

from smart_money_pipeline.ingestors.base import BaseIngestor
from smart_money_pipeline.common.db import get_connection

logger = logging.getLogger(__name__)


class Filings13DIngestor(BaseIngestor):
    """Ingestor for SEC Schedule 13D/13D-A activist stake filings."""

    def __init__(self):
        """Initialize 13D ingestor."""
        super().__init__("13d")
        self.activist_keywords = [
            "change of control",
            "propose",
            "oppose",
            "remedial",
            "successor",
        ]

    def fetch(self) -> List[Dict[str, Any]]:
        """
        Fetch 13D/13D-A filings from SEC EDGAR.

        Returns:
            List of raw 13D filing records
        """
        try:
            logger.info("Fetching 13D filings from SEC EDGAR...")

            # Placeholder: Production would query SEC EDGAR for 13D/13D-A filings
            # filtered for the lookback period
            filings_13d_data = []

            logger.info(f"Found {len(filings_13d_data)} 13D filings")
            return filings_13d_data

        except Exception as e:
            logger.error(f"Error fetching 13D data: {e}")
            return []

    def parse(self, raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Parse raw 13D filings into normalized format.

        Expected input fields:
        - cik, ticker, filer_name
        - pct_owned: Percentage of company owned
        - filing_date
        - is_amendment: Whether this is a 13D-A (amendment)
        - filing_text: Raw text to scan for activist keywords

        Returns:
            List of normalized 13D records
        """
        parsed = []

        for record in raw_data:
            try:
                # Scan for activist keywords in filing text
                filing_text = (record.get("filing_text", "") or "").lower()
                activist_flag = any(
                    keyword in filing_text for keyword in self.activist_keywords
                )

                normalized = {
                    "ticker": record.get("ticker", "").upper(),
                    "cik": record.get("cik", "").lstrip("0"),
                    "filer_name": record.get("filer_name", ""),
                    "pct_owned": float(record.get("pct_owned", 0.0)),
                    "filing_date": record.get("filing_date"),
                    "is_amendment": record.get("is_amendment", False),
                    "activist_keyword_flag": activist_flag,
                }

                # Validate required fields
                if normalized["ticker"] and normalized["cik"] and normalized["filing_date"]:
                    parsed.append(normalized)

            except (ValueError, TypeError) as e:
                logger.warning(f"Error parsing 13D record: {e}")
                continue

        logger.info(f"Parsed {len(parsed)} 13D filings")
        return parsed

    def store(self, parsed_data: List[Dict[str, Any]]) -> bool:
        """
        Store parsed 13D data to database.

        Args:
            parsed_data: List of normalized 13D records

        Returns:
            True if successful
        """
        if not parsed_data:
            logger.info("No 13D data to store")
            return True

        try:
            conn = get_connection()
            cur = conn.cursor()

            # Batch insert with upsert
            query = """
                INSERT INTO filings_13d
                (ticker, cik, filer_name, pct_owned, filing_date, is_amendment, activist_keyword_flag)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (cik, filing_date, is_amendment) DO NOTHING
            """

            for i in range(0, len(parsed_data), self.batch_size):
                batch = parsed_data[i : i + self.batch_size]
                values = [
                    (
                        r["ticker"],
                        r["cik"],
                        r["filer_name"],
                        r["pct_owned"],
                        r["filing_date"],
                        r["is_amendment"],
                        r["activist_keyword_flag"],
                    )
                    for r in batch
                ]

                cur.executemany(query, values)
                conn.commit()
                logger.info(f"✓ Stored batch of {len(batch)} 13D records")

            cur.close()
            logger.info(f"✓ Successfully stored {len(parsed_data)} 13D filings")
            return True

        except Exception as e:
            logger.error(f"Error storing 13D data: {e}")
            return False
