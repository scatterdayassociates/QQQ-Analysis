"""
Base ingestor class for all data sources.
Provides common functionality for fetching, parsing, and storing data.
"""

from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import List, Dict, Any
import logging

from smart_money_pipeline.config import get_config
from smart_money_pipeline.common.db import execute_query, execute_upsert, get_connection

logger = logging.getLogger(__name__)


class BaseIngestor(ABC):
    """Abstract base class for data source ingestors."""

    def __init__(self, source_name: str):
        """
        Initialize ingestor.

        Args:
            source_name: Name of data source (e.g., 'form4', '13d', 'cot', 'short_interest', '13f')
        """
        self.source_name = source_name
        self.config = get_config()
        self.lookback_days = self.config.ingest.lookback_days
        self.batch_size = self.config.ingest.batch_size

    @abstractmethod
    def fetch(self) -> List[Dict[str, Any]]:
        """
        Fetch raw data from source API/endpoint.

        Returns:
            List of dictionaries with raw data
        """
        pass

    @abstractmethod
    def parse(self, raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Parse raw data into normalized format for storage.

        Args:
            raw_data: List of raw data dictionaries from fetch()

        Returns:
            List of normalized data dictionaries ready for database insert
        """
        pass

    @abstractmethod
    def store(self, parsed_data: List[Dict[str, Any]]) -> bool:
        """
        Store parsed data to database.

        Args:
            parsed_data: List of normalized data from parse()

        Returns:
            True if successful, False otherwise
        """
        pass

    def ingest(self) -> bool:
        """
        Execute complete ingestion pipeline: fetch → parse → store.

        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info(f"\n{'=' * 60}")
            logger.info(f"Ingesting {self.source_name}")
            logger.info(f"{'=' * 60}")

            # Fetch
            logger.info(f"Fetching data from {self.source_name}...")
            raw_data = self.fetch()
            logger.info(f"✓ Fetched {len(raw_data)} records")

            # Parse
            logger.info(f"Parsing {len(raw_data)} records...")
            parsed_data = self.parse(raw_data)
            logger.info(f"✓ Parsed {len(parsed_data)} records")

            # Store
            logger.info(f"Storing {len(parsed_data)} records...")
            success = self.store(parsed_data)

            if success:
                logger.info(f"✓ {self.source_name} ingestion complete")
                self._update_ingestion_status("completed", None)
            else:
                logger.error(f"✗ {self.source_name} ingestion failed")
                self._update_ingestion_status("failed", "Storage failed")

            return success

        except Exception as e:
            logger.error(f"✗ Error during {self.source_name} ingestion: {e}")
            self._update_ingestion_status("failed", str(e))
            return False

    def _update_ingestion_status(self, status: str, error_message: str = None):
        """Update ingestion_status table with pipeline state."""
        try:
            query = """
                INSERT INTO ingestion_status (source_name, last_ingested_at, status, error_message, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (source_name)
                DO UPDATE SET
                    status = EXCLUDED.status,
                    last_ingested_at = CASE WHEN EXCLUDED.status = 'completed' THEN NOW() ELSE last_ingested_at END,
                    error_message = EXCLUDED.error_message,
                    updated_at = NOW()
            """
            conn = get_connection()
            cur = conn.cursor()
            cur.execute(query, (self.source_name, datetime.now() if status == "completed" else None, status, error_message))
            conn.commit()
            cur.close()
        except Exception as e:
            logger.warning(f"Failed to update ingestion status: {e}")

    def get_lookback_date(self) -> str:
        """Get date from lookback_days ago in ISO format."""
        return (datetime.now() - timedelta(days=self.lookback_days)).strftime("%Y-%m-%d")
