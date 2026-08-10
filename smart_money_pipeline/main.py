"""
Smart Money Pipeline - Main FastAPI Application.
HTTP server for calculating and serving Smart Money scores.
"""

import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from smart_money_pipeline.api.routes import router
from smart_money_pipeline.common.db import initialize_pool
from smart_money_pipeline.config import get_config
from smart_money_pipeline.pipeline.scheduler import (
    initialize_scheduler,
    shutdown_scheduler,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup and shutdown lifecycle for FastAPI application.
    Initializes database pool and background scheduler.
    """
    # Startup
    logger.info("Starting Smart Money Pipeline API...")
    logger.info("Initializing database connection pool...")
    try:
        initialize_pool()
        logger.info("✓ Database connection pool initialized")
    except Exception as e:
        logger.error(f"✗ Failed to initialize database: {e}")
        sys.exit(1)

    # Initialize scheduler for background pipeline tasks
    logger.info("Initializing background scheduler...")
    try:
        initialize_scheduler()
        logger.info("✓ Background scheduler initialized")
    except Exception as e:
        logger.error(f"✗ Failed to initialize scheduler: {e}")
        # Don't exit - scheduler is optional, API can still function

    yield

    # Shutdown
    logger.info("Shutting down Smart Money Pipeline API...")
    shutdown_scheduler()


# Create FastAPI app
app = FastAPI(
    title="Smart Money Pipeline API",
    description="REST API for Smart Money Pipeline scoring engine",
    version="0.1.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to known origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(router)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Smart Money Pipeline API",
        "version": "0.1.0",
        "docs": "/docs",
        "openapi": "/openapi.json",
    }


if __name__ == "__main__":
    import uvicorn

    config = get_config()
    port = int(config.log_level.split(":")[1]) if ":" in config.log_level else 8000

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info",
    )
