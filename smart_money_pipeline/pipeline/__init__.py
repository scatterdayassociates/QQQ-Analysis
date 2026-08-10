"""Pipeline orchestration for automated data ingestion and score calculation."""

from .scheduler import initialize_scheduler, shutdown_scheduler

__all__ = ["initialize_scheduler", "shutdown_scheduler"]
