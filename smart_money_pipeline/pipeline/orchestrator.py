"""
Pipeline Orchestrator - Coordinates data ingestion and score calculation.
Runs all ingestors in sequence, then calculates and stores scores.
"""

import logging
from datetime import datetime
from typing import Dict, Any, List

from smart_money_pipeline.ingestors.form4 import Form4Ingestor
from smart_money_pipeline.ingestors.filings_13d import Filings13DIngestor
from smart_money_pipeline.ingestors.cot import COTIngestor
from smart_money_pipeline.ingestors.short_interest import ShortInterestIngestor
from smart_money_pipeline.ingestors.thirteenf import ThirteenFIngestor
from smart_money_pipeline.api.scores_service import ScoresService
from smart_money_pipeline.common.db import get_connection, execute_query

logger = logging.getLogger(__name__)


class PipelineOrchestrator:
    """Orchestrates the complete smart money pipeline: ingest → score → store."""

    def __init__(self):
        """Initialize pipeline with all ingestors and scoring service."""
        self.ingestors = [
            ("Form 4", Form4Ingestor()),
            ("13D", Filings13DIngestor()),
            ("COT", COTIngestor()),
            ("Short Interest", ShortInterestIngestor()),
            ("13F", ThirteenFIngestor()),
        ]
        self.scores_service = ScoresService()

    def run_full_pipeline(self, as_of_date: str = None) -> Dict[str, Any]:
        """
        Execute the complete pipeline: fetch, parse, store, score, and save results.

        Args:
            as_of_date: Date to calculate scores for (YYYY-MM-DD), defaults to today

        Returns:
            Dictionary with pipeline execution status and statistics
        """
        if as_of_date is None:
            as_of_date = datetime.now().strftime("%Y-%m-%d")

        logger.info(f"🚀 Starting full pipeline execution for {as_of_date}")
        start_time = datetime.now()

        pipeline_stats = {
            "as_of_date": as_of_date,
            "started_at": start_time.isoformat(),
            "ingestors": {},
            "scoring": {
                "total_tickers": 0,
                "successful_scores": 0,
                "failed_scores": 0,
                "stored_scores": 0,
            },
            "status": "in_progress",
            "error": None,
        }

        try:
            # Phase 1: Run all ingestors
            logger.info("📥 Phase 1: Fetching and storing data from all sources...")
            self._run_ingestors(pipeline_stats)

            # Phase 2: Calculate and store scores
            logger.info("📊 Phase 2: Calculating smart money scores...")
            self._calculate_and_store_scores(as_of_date, pipeline_stats)

            # Phase 3: Update ingestion status
            logger.info("✅ Phase 3: Updating pipeline status...")
            self._update_ingestion_status(as_of_date, "success", pipeline_stats)

            pipeline_stats["status"] = "completed"
            end_time = datetime.now()
            pipeline_stats["completed_at"] = end_time.isoformat()
            pipeline_stats["duration_seconds"] = (end_time - start_time).total_seconds()

            logger.info(
                f"✓ Pipeline completed in {pipeline_stats['duration_seconds']:.1f}s"
            )
            logger.info(f"✓ Calculated scores for {pipeline_stats['scoring']['successful_scores']} tickers")
            logger.info(f"✓ Stored {pipeline_stats['scoring']['stored_scores']} score records")

            return pipeline_stats

        except Exception as e:
            logger.error(f"✗ Pipeline execution failed: {e}", exc_info=True)
            pipeline_stats["status"] = "failed"
            pipeline_stats["error"] = str(e)
            pipeline_stats["failed_at"] = datetime.now().isoformat()

            self._update_ingestion_status(as_of_date, "failed", pipeline_stats)

            return pipeline_stats

    def _run_ingestors(self, pipeline_stats: Dict[str, Any]) -> None:
        """
        Run all ingestors in sequence.

        Args:
            pipeline_stats: Stats dictionary to populate with ingestor results
        """
        for ingestor_name, ingestor in self.ingestors:
            try:
                logger.info(f"  → Running {ingestor_name} ingestor...")
                start = datetime.now()

                # Fetch raw data
                raw_data = ingestor.fetch()
                logger.info(f"    ✓ Fetched {len(raw_data)} raw records")

                # Parse data
                parsed_data = ingestor.parse(raw_data)
                logger.info(f"    ✓ Parsed {len(parsed_data)} records")

                # Store data
                success = ingestor.store(parsed_data)
                duration = (datetime.now() - start).total_seconds()

                pipeline_stats["ingestors"][ingestor_name] = {
                    "status": "success" if success else "failed",
                    "raw_records": len(raw_data),
                    "parsed_records": len(parsed_data),
                    "stored_records": len(parsed_data) if success else 0,
                    "duration_seconds": duration,
                }

                logger.info(f"    ✓ {ingestor_name} complete ({duration:.1f}s)")

            except Exception as e:
                logger.error(f"    ✗ {ingestor_name} failed: {e}", exc_info=True)
                pipeline_stats["ingestors"][ingestor_name] = {
                    "status": "failed",
                    "error": str(e),
                }

    def _calculate_and_store_scores(
        self, as_of_date: str, pipeline_stats: Dict[str, Any]
    ) -> None:
        """
        Calculate scores for all tickers and store to database.

        Args:
            as_of_date: Date to calculate scores for
            pipeline_stats: Stats dictionary to populate
        """
        try:
            # Get all tickers from database
            tickers = self._get_all_tickers()
            pipeline_stats["scoring"]["total_tickers"] = len(tickers)

            logger.info(f"  → Calculating scores for {len(tickers)} tickers...")

            # Calculate scores for each ticker
            for i, ticker in enumerate(tickers, 1):
                try:
                    score_result = self.scores_service.calculate_scores_for_ticker(
                        ticker, as_of_date
                    )

                    # Skip if error
                    if "error" in score_result:
                        logger.warning(f"    ⚠ {ticker}: {score_result['error']}")
                        pipeline_stats["scoring"]["failed_scores"] += 1
                        continue

                    # Store score
                    stored = self.scores_service.store_scores(score_result, as_of_date)
                    if stored:
                        pipeline_stats["scoring"]["successful_scores"] += 1
                        pipeline_stats["scoring"]["stored_scores"] += 1
                    else:
                        pipeline_stats["scoring"]["failed_scores"] += 1

                    # Log progress every 10 tickers
                    if i % 10 == 0:
                        logger.info(
                            f"    ✓ Calculated {i}/{len(tickers)} scores"
                        )

                except Exception as e:
                    logger.warning(f"    ⚠ Error scoring {ticker}: {e}")
                    pipeline_stats["scoring"]["failed_scores"] += 1
                    continue

        except Exception as e:
            logger.error(f"    ✗ Score calculation phase failed: {e}", exc_info=True)
            raise

    def _update_ingestion_status(
        self, as_of_date: str, status: str, pipeline_stats: Dict[str, Any]
    ) -> None:
        """
        Record pipeline execution status to database.

        Args:
            as_of_date: Date of ingestion
            status: Status string ('success' or 'failed')
            pipeline_stats: Full pipeline statistics
        """
        try:
            conn = get_connection()
            cur = conn.cursor()

            import json

            query = """
                INSERT INTO ingestion_status
                (ingestion_date, status, pipeline_stats_json, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (ingestion_date) DO UPDATE SET
                    status = EXCLUDED.status,
                    pipeline_stats_json = EXCLUDED.pipeline_stats_json,
                    updated_at = NOW()
            """

            cur.execute(
                query,
                (
                    as_of_date,
                    status,
                    json.dumps(pipeline_stats),
                ),
            )
            conn.commit()
            cur.close()

            logger.info(f"✓ Recorded pipeline status: {status}")

        except Exception as e:
            logger.error(f"✗ Failed to update ingestion status: {e}")

    def _get_all_tickers(self) -> List[str]:
        """
        Get all tickers from database.

        Returns:
            List of unique ticker symbols
        """
        try:
            query = "SELECT DISTINCT ticker FROM ticker_to_cik WHERE ticker IS NOT NULL ORDER BY ticker"
            results = execute_query(query, fetch_one=False)
            return [r[0] for r in results if r[0]] if results else []
        except Exception as e:
            logger.error(f"Error fetching tickers from database: {e}")
            return []
