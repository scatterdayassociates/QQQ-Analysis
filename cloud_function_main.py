"""
Cloud Function entry point for Smart Money Pipeline.
Deploy to GCP Cloud Functions (2nd gen, Python 3.11).

This runs the daily pipeline ingestion and scoring.
Triggered by Cloud Scheduler at 2 AM UTC.
"""

import logging
import json
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_pipeline(request):
    """
    HTTP Cloud Function to execute the Smart Money Pipeline.

    Triggered by Cloud Scheduler.

    Args:
        request: Flask request object (Cloud Functions passes this)

    Returns:
        JSON response with status and execution details
    """
    try:
        logger.info("=" * 60)
        logger.info("Smart Money Pipeline Execution Started")
        logger.info(f"Timestamp: {datetime.utcnow().isoformat()}")
        logger.info("=" * 60)

        # Import here to avoid cold start delays
        from smart_money_pipeline.pipeline.orchestrator import PipelineOrchestrator
        from smart_money_pipeline.common.db import initialize_pool
        from smart_money_pipeline.config import get_config

        # Initialize configuration
        config = get_config()
        logger.info(f"Configuration loaded: {config}")

        # Initialize database connection pool
        logger.info("Initializing database connection pool...")
        initialize_pool()
        logger.info("✓ Database pool initialized")

        # Create orchestrator and run pipeline
        logger.info("Creating pipeline orchestrator...")
        orchestrator = PipelineOrchestrator()

        logger.info("Running full pipeline...")
        stats = orchestrator.run_full_pipeline()

        logger.info("=" * 60)
        logger.info("Pipeline Execution Completed Successfully")
        logger.info(f"Stats: {stats}")
        logger.info("=" * 60)

        return {
            "status": "success",
            "message": "Pipeline executed successfully",
            "timestamp": datetime.utcnow().isoformat(),
            "stats": stats
        }, 200

    except Exception as e:
        logger.error("=" * 60)
        logger.error("Pipeline Execution Failed")
        logger.error(f"Error: {str(e)}", exc_info=True)
        logger.error("=" * 60)

        return {
            "status": "error",
            "message": f"Pipeline execution failed: {str(e)}",
            "timestamp": datetime.utcnow().isoformat(),
            "error": str(e)
        }, 500
