"""
HTTP API Routes for Smart Money Pipeline.
Provides REST endpoints for fetching and calculating scores.
"""

import json
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Query, HTTPException
from datetime import datetime

from smart_money_pipeline.api.scores_service import ScoresService
from smart_money_pipeline.config import get_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/smart-money", tags=["smart-money"])

# Initialize service
scores_service = ScoresService()


@router.get("/scores")
async def get_scores(
    ticker: Optional[str] = Query(None, description="Single ticker to score"),
    universe: str = Query("Nasdaq-100", description="Universe of stocks"),
    funds: str = Query("Citadel,Millennium,Point72", description="Comma-separated fund names"),
    weights: Optional[str] = Query(None, description="JSON weights override"),
    as_of_date: Optional[str] = Query(None, description="Date (YYYY-MM-DD)"),
    limit: int = Query(100, description="Max results to return"),
) -> Dict[str, Any]:
    """
    Calculate Smart Money Pipeline scores.

    Query Parameters:
    - ticker: Optional. If provided, return scores for single ticker.
             If omitted, return scores for entire universe.
    - universe: Stock universe ("Nasdaq-100", "S&P 500", "Russell 2000")
    - funds: Comma-separated fund names to track
    - weights: JSON object with score weights (e.g., {"insider": 30, "activist": 20, ...})
    - as_of_date: Date for scoring (YYYY-MM-DD). Defaults to today.
    - limit: Maximum number of results (default 100)

    Returns:
        JSON with scores for requested tickers, sorted by composite score descending
    """
    try:
        # Parse optional weights
        weights_dict = None
        if weights:
            try:
                weights_dict = json.loads(weights)
                logger.info(f"Using custom weights: {weights_dict}")
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid weights JSON")

        # Parse funds list
        funds_list = [f.strip() for f in funds.split(",") if f.strip()]

        # If single ticker requested, return just that ticker
        if ticker:
            score_result = scores_service.calculate_scores_for_ticker(ticker, as_of_date)
            if "error" in score_result:
                raise HTTPException(status_code=500, detail=score_result["error"])

            return {
                "universe": universe,
                "funds": funds_list,
                "weights": weights_dict or scores_service.formulas.weights,
                "as_of_date": score_result["as_of_date"],
                "scores": [score_result],
                "timestamp": datetime.now().isoformat(),
            }

        # Return scores for entire universe
        result = scores_service.calculate_scores_for_universe(
            universe=universe,
            funds=funds_list,
            weights=weights_dict,
            as_of_date=as_of_date,
            limit=limit,
        )

        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in scores endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scores/{ticker}")
async def get_ticker_scores(
    ticker: str, as_of_date: Optional[str] = Query(None, description="Date (YYYY-MM-DD)")
) -> Dict[str, Any]:
    """
    Get scores for a specific ticker.

    Path Parameters:
    - ticker: Stock ticker symbol

    Query Parameters:
    - as_of_date: Date for scoring (YYYY-MM-DD). Defaults to today.

    Returns:
        JSON with all 6 scores for the ticker
    """
    try:
        score_result = scores_service.calculate_scores_for_ticker(ticker, as_of_date)

        if "error" in score_result:
            raise HTTPException(status_code=500, detail=score_result["error"])

        return score_result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting scores for {ticker}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
async def get_config_info() -> Dict[str, Any]:
    """
    Get current pipeline configuration.

    Returns:
        JSON with scoring weights, funds tracked, and other config
    """
    config = get_config()

    return {
        "weights": config.scoring.weights,
        "funds": config.funds.fund_ciks,
        "universe": config.universe.universes,
        "database": {
            "host": config.database.host,
            "port": config.database.port,
            "name": config.database.name,
        },
        "sec": {
            "rate_limit_per_sec": config.sec.rate_limit_per_sec,
            "max_retries": config.sec.max_retries,
        },
        "ingest": {
            "lookback_days": config.ingest.lookback_days,
            "batch_size": config.ingest.batch_size,
        },
    }


@router.get("/health")
async def health_check() -> Dict[str, str]:
    """
    Health check endpoint.

    Returns:
        JSON with status
    """
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}
