"""
COT Ingestor - CFTC Commitments of Traders Data.
Fetches leveraged funds positioning data from CFTC COT reports.
"""

from typing import List, Dict, Any
from datetime import datetime
import logging

from smart_money_pipeline.ingestors.base import BaseIngestor
from smart_money_pipeline.common.db import get_connection

logger = logging.getLogger(__name__)


class COTIngestor(BaseIngestor):
    """Ingestor for CFTC Commitments of Traders data."""

    def __init__(self):
        """Initialize COT ingestor."""
        super().__init__("cot")
        # Map of futures contracts to track for QQQ-like exposure
        self.contracts_of_interest = {
            "ES": "E-mini S&P 500",  # S&P 500 equity index
            "NQ": "E-mini Nasdaq-100",  # Nasdaq-100 index
            "YM": "E-mini Dow",  # Dow index
        }

    def fetch(self) -> List[Dict[str, Any]]:
        """
        Fetch CFTC COT data for NQ (E-mini Nasdaq-100).

        Returns:
            List of raw COT records
        """
        try:
            from smart_money_pipeline.data_sources.cftc_cot import get_nq_cot_data

            logger.info("Fetching COT data from CFTC for NQ contract...")

            # Fetch NQ (E-mini Nasdaq-100) COT data
            cot_data = get_nq_cot_data(weeks=52)

            logger.info(f"Found {len(cot_data)} COT records")
            return cot_data

        except Exception as e:
            logger.error(f"Error fetching COT data: {e}")
            return []

    def parse(self, raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Parse raw COT data into normalized format.

        Expected input fields:
        - contract_name: Futures contract (e.g., 'ES', 'NQ', 'YM')
        - report_date: Report date
        - leveraged_funds_net: Net long position of leveraged funds
        - open_interest: Total open interest
        - commercial_net: Commercial net position

        Returns:
            List of normalized COT records
        """
        parsed = []

        for record in raw_data:
            try:
                contract = record.get("contract_name", "").upper()

                # Only include contracts of interest
                if contract not in self.contracts_of_interest:
                    continue

                normalized = {
                    "contract_name": contract,
                    "report_date": record.get("report_date"),
                    "leveraged_funds_net": int(record.get("leveraged_funds_net", 0)),
                    "open_interest": int(record.get("open_interest", 0)),
                    "commercial_net": int(record.get("commercial_net", 0)),
                }

                # Validate required fields
                if normalized["contract_name"] and normalized["report_date"]:
                    parsed.append(normalized)

            except (ValueError, TypeError) as e:
                logger.warning(f"Error parsing COT record: {e}")
                continue

        logger.info(f"Parsed {len(parsed)} COT records")
        return parsed

    def store(self, parsed_data: List[Dict[str, Any]]) -> bool:
        """
        Store parsed COT data to database.

        Args:
            parsed_data: List of normalized COT records

        Returns:
            True if successful
        """
        if not parsed_data:
            logger.info("No COT data to store")
            return True

        try:
            conn = get_connection()
            cur = conn.cursor()

            # Batch insert with upsert
            query = """
                INSERT INTO cot_positions
                (contract_name, report_date, leveraged_funds_net, open_interest, commercial_net)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (contract_name, report_date) DO NOTHING
            """

            for i in range(0, len(parsed_data), self.batch_size):
                batch = parsed_data[i : i + self.batch_size]
                values = [
                    (
                        r["contract_name"],
                        r["report_date"],
                        r["leveraged_funds_net"],
                        r["open_interest"],
                        r["commercial_net"],
                    )
                    for r in batch
                ]

                cur.executemany(query, values)
                conn.commit()
                logger.info(f"✓ Stored batch of {len(batch)} COT records")

            cur.close()
            logger.info(f"✓ Successfully stored {len(parsed_data)} COT records")
            return True

        except Exception as e:
            logger.error(f"Error storing COT data: {e}")
            return False
