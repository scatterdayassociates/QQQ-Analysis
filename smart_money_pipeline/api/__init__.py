"""Smart Money Pipeline REST API."""

from .scores_service import ScoresService

# Note: router is imported lazily in main.py to avoid requiring FastAPI
# when running as a Cloud Function

__all__ = ["ScoresService"]
