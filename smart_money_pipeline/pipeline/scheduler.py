"""
Scheduler - Manages scheduled tasks for pipeline execution.
Uses APScheduler to run pipeline on a schedule (e.g., nightly).
"""

import logging
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.job import Job

from smart_money_pipeline.pipeline.orchestrator import PipelineOrchestrator

logger = logging.getLogger(__name__)

# Global scheduler instance
_scheduler: Optional[AsyncIOScheduler] = None
_orchestrator: Optional[PipelineOrchestrator] = None


def initialize_scheduler() -> AsyncIOScheduler:
    """
    Initialize and start the APScheduler instance.

    Returns:
        AsyncIOScheduler instance
    """
    global _scheduler, _orchestrator

    logger.info("🕐 Initializing scheduler...")

    _scheduler = AsyncIOScheduler()
    _orchestrator = PipelineOrchestrator()

    # Schedule nightly pipeline run at 2:00 AM UTC (9:00 PM EST)
    # This allows time for market data to be published
    schedule_nightly_pipeline(run_time="02:00")

    _scheduler.start()
    logger.info("✓ Scheduler initialized and started")

    return _scheduler


def shutdown_scheduler() -> None:
    """Shutdown the scheduler gracefully."""
    global _scheduler

    if _scheduler and _scheduler.running:
        logger.info("🛑 Shutting down scheduler...")
        _scheduler.shutdown(wait=True)
        logger.info("✓ Scheduler shut down")


def schedule_nightly_pipeline(run_time: str = "02:00", job_id: str = "nightly_pipeline") -> Job:
    """
    Schedule the full pipeline to run at a specific time each night.

    Args:
        run_time: Time in HH:MM format (24-hour, UTC). Defaults to 02:00 UTC
        job_id: Unique job identifier

    Returns:
        APScheduler Job instance
    """
    global _scheduler

    if _scheduler is None:
        raise RuntimeError("Scheduler not initialized. Call initialize_scheduler() first.")

    hour, minute = map(int, run_time.split(":"))

    logger.info(f"📅 Scheduling nightly pipeline at {hour:02d}:{minute:02d} UTC")

    # Remove existing job if it exists
    try:
        _scheduler.remove_job(job_id)
        logger.info(f"   (Replaced existing '{job_id}' job)")
    except Exception:
        pass

    # Schedule with cron trigger for daily execution
    job = _scheduler.add_job(
        _execute_pipeline_job,
        trigger=CronTrigger(hour=hour, minute=minute, timezone="UTC"),
        id=job_id,
        name="Nightly Smart Money Pipeline",
        replace_existing=True,
    )

    logger.info(f"✓ Scheduled: {job.name}")

    return job


def schedule_immediate_pipeline(job_id: str = "immediate_pipeline") -> Job:
    """
    Schedule pipeline to run immediately (useful for manual triggers).

    Args:
        job_id: Unique job identifier

    Returns:
        APScheduler Job instance
    """
    global _scheduler

    if _scheduler is None:
        raise RuntimeError("Scheduler not initialized. Call initialize_scheduler() first.")

    logger.info("⚡ Scheduling immediate pipeline execution...")

    # Remove existing job if it exists
    try:
        _scheduler.remove_job(job_id)
    except Exception:
        pass

    # Schedule to run now
    job = _scheduler.add_job(
        _execute_pipeline_job,
        id=job_id,
        name="Immediate Pipeline Execution",
        replace_existing=True,
    )

    logger.info(f"✓ Scheduled immediate execution: {job.name}")

    return job


def get_scheduler() -> Optional[AsyncIOScheduler]:
    """Get the current scheduler instance (if initialized)."""
    return _scheduler


def get_scheduler_status() -> dict:
    """
    Get current scheduler status and running jobs.

    Returns:
        Dictionary with scheduler state and job information
    """
    global _scheduler

    if _scheduler is None:
        return {"initialized": False, "running": False, "jobs": []}

    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "trigger": str(job.trigger),
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
            "func": f"{job.func.__module__}.{job.func.__name__}",
        })

    return {
        "initialized": True,
        "running": _scheduler.running,
        "job_count": len(jobs),
        "jobs": jobs,
    }


def _execute_pipeline_job() -> None:
    """
    Job function executed by the scheduler.
    Runs the full pipeline orchestration.
    """
    global _orchestrator

    logger.info("\n" + "=" * 60)
    logger.info(f"⏰ Pipeline job started at {datetime.now().isoformat()}")
    logger.info("=" * 60)

    try:
        if _orchestrator is None:
            logger.error("Pipeline orchestrator not initialized!")
            return

        # Run the full pipeline
        result = _orchestrator.run_full_pipeline()

        # Log summary
        logger.info("=" * 60)
        logger.info(f"Pipeline Status: {result['status'].upper()}")
        logger.info(f"Duration: {result.get('duration_seconds', 'N/A')}s")
        logger.info(f"Scores Calculated: {result['scoring']['successful_scores']}")
        logger.info(f"Scores Stored: {result['scoring']['stored_scores']}")

        if result["status"] == "failed":
            logger.error(f"Error: {result['error']}")

        logger.info("=" * 60 + "\n")

    except Exception as e:
        logger.error(f"✗ Pipeline job failed with exception: {e}", exc_info=True)
        logger.info("=" * 60 + "\n")
