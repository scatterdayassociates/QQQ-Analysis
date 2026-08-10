"""
Scores API Service - Core business logic for calculating and retrieving scores.
Used by both HTTP endpoints and CLI.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

from smart_money_pipeline.config import get_config
from smart_money_pipeline.scoring.formulas import ScoringFormulas
from smart_money_pipeline.common.db import execute_query, get_connection

logger = logging.getLogger(__name__)


class ScoresService:
    """Service for calculating and retrieving composite scores."""

    def __init__(self):
        """Initialize scores service."""
        self.config = get_config()
        self.formulas = ScoringFormulas()

    def calculate_scores_for_ticker(
        self, ticker: str, as_of_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Calculate all scores for a single ticker.

        Args:
            ticker: Stock ticker symbol
            as_of_date: Date to calculate scores for (YYYY-MM-DD), defaults to today

        Returns:
            Dictionary with all 6 scores plus metadata
        """
        if as_of_date is None:
            as_of_date = datetime.now().strftime("%Y-%m-%d")

        try:
            # Calculate all 6 scores
            scores = self.formulas.score_ticker(ticker, as_of_date)

            result = {
                "ticker": ticker,
                "as_of_date": as_of_date,
                "insider_cluster_score": scores["insider_cluster_score"],
                "activist_flag_score": scores["activist_flag_score"],
                "cot_zscore": scores["cot_zscore"],
                "short_interest_momentum_score": scores["short_interest_momentum_score"],
                "thirteenf_conviction_score": scores["thirteenf_conviction_score"],
                "composite_score": scores["composite_score"],
                "weights_used": self.formulas.weights,
            }

            return result

        except Exception as e:
            logger.error(f"Error calculating scores for {ticker}: {e}")
            return {
                "ticker": ticker,
                "as_of_date": as_of_date,
                "error": str(e),
            }

    def calculate_scores_for_universe(
        self,
        universe: str = "Nasdaq-100",
        funds: Optional[List[str]] = None,
        weights: Optional[Dict[str, float]] = None,
        as_of_date: Optional[str] = None,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """
        Calculate scores for all tickers in a universe, sorted by composite score.

        Args:
            universe: Universe name ("Nasdaq-100", "S&P 500", "Russell 2000")
            funds: List of fund names to filter by (optional)
            weights: Custom weights dict to override defaults (optional)
            as_of_date: Date to calculate scores for (YYYY-MM-DD)
            limit: Maximum number of results to return

        Returns:
            Dictionary with scores for all tickers, sorted by composite score DESC
        """
        if as_of_date is None:
            as_of_date = datetime.now().strftime("%Y-%m-%d")

        try:
            # Get tickers for universe
            tickers = self._get_universe_tickers(universe)
            logger.info(f"Calculating scores for {len(tickers)} tickers in {universe}")

            # Override weights if provided
            if weights:
                self.formulas.weights = weights

            # Calculate scores for all tickers
            results = []
            for ticker in tickers:
                score_result = self.calculate_scores_for_ticker(ticker, as_of_date)

                # Skip if error
                if "error" in score_result:
                    continue

                results.append(score_result)

            # Sort by composite score (descending)
            results.sort(key=lambda x: x.get("composite_score", 0), reverse=True)

            # Apply limit
            results = results[:limit]

            return {
                "universe": universe,
                "funds": funds or list(self.config.funds.fund_ciks.keys()),
                "weights": self.formulas.weights,
                "as_of_date": as_of_date,
                "count": len(results),
                "scores": results,
                "timestamp": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Error calculating scores for universe {universe}: {e}")
            return {
                "universe": universe,
                "error": str(e),
                "timestamp": datetime.now().isoformat(),
            }

    def store_scores(
        self, scores_result: Dict[str, Any], as_of_date: str
    ) -> bool:
        """
        Store calculated scores to database.

        Args:
            scores_result: Score dictionary from calculate_scores_for_ticker
            as_of_date: Date of scores

        Returns:
            True if successful
        """
        if "error" in scores_result:
            return False

        try:
            conn = get_connection()
            cur = conn.cursor()

            query = """
                INSERT INTO scores
                (ticker, as_of_date, insider_cluster_score, activist_flag_score,
                 cot_zscore, short_interest_momentum_score, thirteenf_conviction_score,
                 composite_score, weights_used_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (ticker, as_of_date) DO UPDATE SET
                    insider_cluster_score = EXCLUDED.insider_cluster_score,
                    activist_flag_score = EXCLUDED.activist_flag_score,
                    cot_zscore = EXCLUDED.cot_zscore,
                    short_interest_momentum_score = EXCLUDED.short_interest_momentum_score,
                    thirteenf_conviction_score = EXCLUDED.thirteenf_conviction_score,
                    composite_score = EXCLUDED.composite_score,
                    weights_used_json = EXCLUDED.weights_used_json
            """

            import json

            cur.execute(
                query,
                (
                    scores_result["ticker"],
                    as_of_date,
                    scores_result.get("insider_cluster_score"),
                    scores_result.get("activist_flag_score"),
                    scores_result.get("cot_zscore"),
                    scores_result.get("short_interest_momentum_score"),
                    scores_result.get("thirteenf_conviction_score"),
                    scores_result.get("composite_score"),
                    json.dumps(scores_result.get("weights_used", {})),
                ),
            )
            conn.commit()
            cur.close()

            return True

        except Exception as e:
            logger.error(f"Error storing scores: {e}")
            return False

    def _get_universe_tickers(self, universe: str) -> List[str]:
        """
        Get list of tickers for a given universe.

        Args:
            universe: Universe name

        Returns:
            List of ticker symbols
        """
        if universe == "Nasdaq-100":
            # Hardcoded for now, could load from database
            return [
                "AAPL",
                "MSFT",
                "NVDA",
                "AMZN",
                "TSLA",
                "META",
                "GOOGL",
                "GOOG",
                "AVGO",
                "NFLX",
                "QCOM",
                "ADBE",
                "CRM",
                "INTC",
                "INTU",
                "AMD",
                "CSCO",
                "CMCSA",
                "PEP",
                "COST",
                "AZO",
                "ASML",
                "TMUS",
                "NXPI",
                "AMAT",
                "LRCX",
                "MRNA",
                "SNPS",
                "CDNS",
                "JD",
                "CHTR",
                "BIIB",
                "KLAC",
                "PYPL",
                "ABNB",
                "VRSK",
                "SPLK",
                "ARM",
                "ORCL",
                "LULU",
                "CRWD",
                "DDOG",
                "OKTA",
                "PANW",
                "FTNT",
                "NET",
                "MSTR",
                "COIN",
                "SQ",
                "SHOP",
            ]
        elif universe == "S&P 500":
            # Placeholder
            return []
        elif universe == "Russell 2000":
            # Placeholder
            return []
        else:
            return []
