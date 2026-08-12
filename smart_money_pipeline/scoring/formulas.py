"""
Smart Money Pipeline Scoring Formulas.

Implements all 6 scoring sub-functions and composite score calculation:
1. Insider Cluster Score - insider buy clustering
2. Activist Flag Score - activist stake intensity
3. COT Z-Score - leveraged funds positioning
4. Short Interest Momentum Score - short interest trend strength
5. 13F Conviction Score - smart money fund concentration
6. Composite Score - weighted combination of all sub-scores

Optimized with query caching and data freshness checks.
"""

from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import logging
import statistics

from smart_money_pipeline.config import get_config
from smart_money_pipeline.common.db import execute_query, get_connection
from smart_money_pipeline.scoring.cache import (
    QueryCache,
    DataFreshnessMonitor,
    OptimizedScoreQueries,
)

logger = logging.getLogger(__name__)


class ScoringFormulas:
    """All scoring formulas for Smart Money Pipeline."""

    def __init__(self, use_cache: bool = True):
        """
        Initialize scoring formulas with configuration.

        Args:
            use_cache: Whether to use query caching (default True)
        """
        self.config = get_config()
        self.weights = self.config.scoring.weights
        self.cache = QueryCache(ttl_seconds=3600) if use_cache else None
        self.freshness_monitor = DataFreshnessMonitor()

        # Initialize data freshness on startup
        try:
            self.freshness_monitor.refresh_timestamps()
        except Exception as e:
            logger.warning(f"Could not initialize data freshness monitor: {e}")

    # ========== SUB-SCORE 1: INSIDER CLUSTER SCORE ==========

    def insider_cluster_score(self, ticker: str, as_of_date: str) -> Optional[float]:
        """
        Calculate insider cluster score (0-100).

        Measures concentration of insider buys over recent periods:
        - 30-day window: 40% weight
        - 90-day window: 60% weight

        Formula:
            score = (count_30d / avg_insiders) * 40 + (count_90d / avg_insiders) * 60

        Where:
            - count_Nd = number of unique insider buys in N-day window
            - avg_insiders = average insiders per company

        Args:
            ticker: Stock ticker
            as_of_date: Date to score (YYYY-MM-DD)

        Returns:
            Score 0-100, or None if insufficient data
        """
        try:
            # Check data freshness
            if not self.freshness_monitor.check_freshness("form4", as_of_date, max_age_days=30):
                logger.warning(f"Form 4 data too old for {ticker} scoring")
                return None

            cache_key = f"insider_{ticker}_{as_of_date}"
            if self.cache:
                cached = self.cache.get(cache_key)
                if cached is not None:
                    logger.debug(f"Insider score cache HIT for {ticker}")
                    return cached

            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Use optimized query to get all insider transactions
            transactions = OptimizedScoreQueries.get_insider_transactions(ticker, lookback_days=90)

            if not transactions:
                logger.debug(f"No insider transactions found for {ticker}")
                return None

            # Count unique insiders in each window
            count_30d = 0
            count_90d = 0
            date_30d_ago = (as_of - timedelta(days=30))
            date_90d_ago = (as_of - timedelta(days=90))

            seen_30d = set()
            seen_90d = set()

            for filer_name, trans_date_str, quantity in transactions:
                trans_date = datetime.strptime(trans_date_str, "%Y-%m-%d") if isinstance(trans_date_str, str) else trans_date_str

                if trans_date >= date_30d_ago:
                    if filer_name not in seen_30d:
                        count_30d += 1
                        seen_30d.add(filer_name)

                if trans_date >= date_90d_ago:
                    if filer_name not in seen_90d:
                        count_90d += 1
                        seen_90d.add(filer_name)

            # Average number of insiders for normalization (baseline ~3-5)
            avg_insiders = 3.5

            # Calculate score
            score_30d = (count_30d / avg_insiders) * self.config.scoring.insider_30d_weight * 100
            score_90d = (count_90d / avg_insiders) * self.config.scoring.insider_90d_weight * 100

            score = score_30d + score_90d
            score = min(score, 100.0)  # Cap at 100

            # Cache result
            if self.cache:
                self.cache.set(cache_key, score)

            return score

        except Exception as e:
            logger.warning(f"Error calculating insider cluster score for {ticker}: {e}")
            return None

    # ========== SUB-SCORE 2: ACTIVIST FLAG SCORE ==========

    def activist_flag_score(self, ticker: str, as_of_date: str) -> Optional[float]:
        """
        Calculate activist flag score (0-100).

        Measures recent and fresh activist stakes:
        - Fresh filing (< 30 days): 100 points
        - Active filing (< 90 days): 50 points
        - Aged filing (< 365 days): 25 points
        - No recent 13D: 0 points

        Formula:
            score = max(activist filing intensity in lookback window)

        Args:
            ticker: Stock ticker
            as_of_date: Date to score (YYYY-MM-DD)

        Returns:
            Score 0-100, or None if no 13D filings
        """
        try:
            # Check data freshness
            if not self.freshness_monitor.check_freshness("filings_13d", as_of_date, max_age_days=60):
                logger.warning(f"13D filing data too old for {ticker} scoring")
                # Don't return None - 13D data doesn't update frequently
                # Continue with stale data if needed

            cache_key = f"activist_{ticker}_{as_of_date}"
            if self.cache:
                cached = self.cache.get(cache_key)
                if cached is not None:
                    logger.debug(f"Activist score cache HIT for {ticker}")
                    return cached

            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Use optimized query to get recent 13D filings
            filings = OptimizedScoreQueries.get_recent_13d_filings(ticker, lookback_days=365)

            if not filings:
                return 0.0  # No activist filings

            # Get most recent filing
            filing_date_str, is_amendment, activist_flag = filings[0]
            filing_date = datetime.strptime(filing_date_str, "%Y-%m-%d") if isinstance(filing_date_str, str) else filing_date_str
            days_since = (as_of - filing_date.replace(hour=0, minute=0, second=0, microsecond=0)).days

            # Score based on recency and activist keyword presence
            if days_since <= self.config.scoring.activist_fresh_days:
                base_score = 100.0
            elif days_since <= 90:
                base_score = 50.0
            elif days_since <= self.config.scoring.activist_max_age_days:
                base_score = 25.0
            else:
                base_score = 0.0

            # Boost score if activist keywords found
            if activist_flag:
                base_score = min(base_score * 1.2, 100.0)

            # Cache result
            if self.cache:
                self.cache.set(cache_key, base_score)

            return base_score

        except Exception as e:
            logger.warning(f"Error calculating activist flag score for {ticker}: {e}")
            return None

    # ========== SUB-SCORE 3: COT Z-SCORE ==========

    def cot_zscore(self, ticker: str, as_of_date: str) -> Optional[float]:
        """
        Calculate COT Z-score (-100 to +100, scaled).

        Measures deviation of leveraged funds positioning from historical mean:
        - Map ticker to relevant futures contracts (ES for S&P, NQ for Nasdaq)
        - Calculate z-score of leveraged_funds_net position
        - Convert z-score to 0-100 scale (mean=50, ±2σ=0/100)

        Formula:
            z = (current_position - mean_position) / std_position
            score = 50 + (z * 25)  # Scale so ±2σ → 0-100

        Args:
            ticker: Stock ticker (mapped to futures contract)
            as_of_date: Date to score (YYYY-MM-DD)

        Returns:
            Score 0-100, or None if insufficient data
        """
        try:
            # Check data freshness
            if not self.freshness_monitor.check_freshness("cot", as_of_date, max_age_days=14):
                logger.warning(f"COT data too old for {ticker} scoring")
                return None

            # Map ticker to futures contract (simplified mapping)
            if ticker in ["QQQ", "TSLA", "AMZN", "NVDA", "AAPL", "MSFT"]:
                contract = "NQ"  # Nasdaq-100 index
            elif ticker in ["SPY", "IVV", "VOO"]:
                contract = "ES"  # S&P 500 index
            else:
                # Default to broad market
                contract = "ES"

            cache_key = f"cot_{contract}_{as_of_date}"
            if self.cache:
                cached = self.cache.get(cache_key)
                if cached is not None:
                    logger.debug(f"COT score cache HIT for {contract}")
                    return cached

            # Get historical COT positions (90-day lookback)
            results = OptimizedScoreQueries.get_cot_history(contract, lookback_days=90)

            if not results or len(results) < 5:
                logger.debug(f"Insufficient COT data for {contract}")
                return None

            positions = [r[0] for r in results]

            # Calculate z-score
            mean_position = statistics.mean(positions)
            if len(positions) > 1:
                std_position = statistics.stdev(positions)
            else:
                return None

            if std_position == 0:
                return 50.0  # No variation, neutral score

            current_position = positions[-1]  # Most recent
            z_score = (current_position - mean_position) / std_position

            # Scale z-score to 0-100 (±2σ → 0-100, mean → 50)
            score = 50 + (z_score * 25)
            score = max(0.0, min(score, 100.0))

            # Cache result
            if self.cache:
                self.cache.set(cache_key, score)

            return score

        except Exception as e:
            logger.warning(f"Error calculating COT z-score for {ticker}: {e}")
            return None

    # ========== SUB-SCORE 4: SHORT INTEREST MOMENTUM SCORE ==========

    def short_interest_momentum_score(self, ticker: str, as_of_date: str) -> Optional[float]:
        """
        Calculate short interest momentum score (0-100).

        Measures acceleration of short interest growth:
        - Recent trend (30-day % change) vs historical baseline
        - Positive momentum (increase) = bullish signal (short squeeze potential)
        - Negative momentum (decrease) = bearish signal

        Formula:
            recent_change = (shares_short_now - shares_short_30d_ago) / shares_short_30d_ago
            historical_std = std(30-day % changes over 90 days)
            momentum = recent_change / historical_std
            score = 50 + (momentum * 25)  # ±2σ → 0-100

        Args:
            ticker: Stock ticker
            as_of_date: Date to score (YYYY-MM-DD)

        Returns:
            Score 0-100, or None if insufficient data
        """
        try:
            # Check data freshness
            if not self.freshness_monitor.check_freshness("short_interest", as_of_date, max_age_days=30):
                logger.warning(f"Short interest data too old for {ticker} scoring")
                return None

            cache_key = f"short_int_{ticker}_{as_of_date}"
            if self.cache:
                cached = self.cache.get(cache_key)
                if cached is not None:
                    logger.debug(f"Short interest score cache HIT for {ticker}")
                    return cached

            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Get short interest data (90-day lookback)
            results = OptimizedScoreQueries.get_short_interest_history(ticker, lookback_days=90)

            if not results or len(results) < 3:
                logger.debug(f"Insufficient short interest data for {ticker}")
                return None

            shares_short_history = [r[1] for r in results]

            # Calculate 30-day changes
            changes = []
            for i in range(1, len(shares_short_history)):
                if shares_short_history[i - 1] > 0:
                    pct_change = (shares_short_history[i] - shares_short_history[i - 1]) / shares_short_history[i - 1]
                    changes.append(pct_change)

            if len(changes) < 2:
                logger.debug(f"Insufficient change data for {ticker}")
                return None

            # Recent change (most recent period)
            recent_change = changes[-1]

            # Historical standard deviation of changes
            std_changes = statistics.stdev(changes) if len(changes) > 1 else 0
            if std_changes == 0:
                return 50.0  # No variation, neutral

            # Calculate momentum
            momentum = recent_change / std_changes

            # Scale to 0-100
            score = 50 + (momentum * 25)
            score = max(0.0, min(score, 100.0))

            # Cache result
            if self.cache:
                self.cache.set(cache_key, score)

            return score

        except Exception as e:
            logger.warning(f"Error calculating short interest momentum score for {ticker}: {e}")
            return None

    # ========== SUB-SCORE 5: 13F CONVICTION SCORE ==========

    def thirteenf_conviction_score(self, ticker: str, as_of_date: str) -> Optional[float]:
        """
        Calculate 13F conviction score (0-100).

        Measures concentration and recency of smart money fund holdings:
        - Fund concentration: % of top 3 funds' portfolios
        - Recency: Age of most recent 13F filing

        Formula:
            concentration = (pct_fund_1 + pct_fund_2 + pct_fund_3) / 3
            recency_boost = 1.0 if filing < 45 days, 0.8 if < 90 days, else 0.5
            score = concentration * recency_boost * 100

        Args:
            ticker: Stock ticker
            as_of_date: Date to score (YYYY-MM-DD)

        Returns:
            Score 0-100, or None if no 13F holdings
        """
        try:
            # 13F data freshness check (note: updates quarterly, so larger window)
            if not self.freshness_monitor.check_freshness("thirteenf", as_of_date, max_age_days=120):
                logger.warning(f"13F filing data too old for {ticker} scoring")
                # Don't return None - 13F data is quarterly, stale data is acceptable

            cache_key = f"thirteenf_{ticker}_{as_of_date}"
            if self.cache:
                cached = self.cache.get(cache_key)
                if cached is not None:
                    logger.debug(f"13F conviction score cache HIT for {ticker}")
                    return cached

            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Get latest 13F positions for this ticker
            results = OptimizedScoreQueries.get_thirteenf_holdings(ticker, lookback_days=365)

            if not results:
                return 0.0  # No 13F holdings

            # Get top 3 fund concentrations
            top_percentages = [r[1] for r in results[:3]]
            avg_concentration = sum(top_percentages) / len(top_percentages)

            # Get recency boost from most recent filing
            most_recent_filing_str = results[0][2]
            if isinstance(most_recent_filing_str, str):
                # Parse timestamp string
                try:
                    filing_dt = datetime.strptime(most_recent_filing_str, "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    # Try just date format
                    filing_dt = datetime.strptime(most_recent_filing_str, "%Y-%m-%d")
            else:
                filing_dt = most_recent_filing_str

            days_since_filing = (as_of - filing_dt.replace(hour=0, minute=0, second=0, microsecond=0)).days

            if days_since_filing <= 45:
                recency_boost = 1.0
            elif days_since_filing <= 90:
                recency_boost = 0.8
            else:
                recency_boost = 0.5

            # Calculate score
            score = avg_concentration * recency_boost * 100
            score = min(score, 100.0)

            # Cache result
            if self.cache:
                self.cache.set(cache_key, score)

            return score

        except Exception as e:
            logger.warning(f"Error calculating 13F conviction score for {ticker}: {e}")
            return None

    # ========== SUB-SCORE 6: COMPOSITE SCORE ==========

    def composite_score(
        self,
        insider_score: Optional[float],
        activist_score: Optional[float],
        cot_score: Optional[float],
        short_int_score: Optional[float],
        thirteenf_score: Optional[float],
    ) -> float:
        """
        Calculate weighted composite score (0-100).

        Combines all 5 sub-scores using configurable weights.
        Missing sub-scores are excluded from calculation.

        Formula:
            composite = (insider * w_insider + activist * w_activist + ...)
                        / sum(weights of non-null scores)

        Default weights (% of 100):
        - Insider: 25%
        - Activist: 15%
        - COT Z-Score: 20%
        - Short Interest: 15%
        - 13F Conviction: 25%

        Args:
            insider_score: Insider cluster score (0-100)
            activist_score: Activist flag score (0-100)
            cot_score: COT z-score (0-100)
            short_int_score: Short interest momentum (0-100)
            thirteenf_score: 13F conviction score (0-100)

        Returns:
            Composite score 0-100
        """
        scores = [
            (insider_score, self.weights.get("insider", 25.0)),
            (activist_score, self.weights.get("activist", 15.0)),
            (cot_score, self.weights.get("cot", 20.0)),
            (short_int_score, self.weights.get("short_interest", 15.0)),
            (thirteenf_score, self.weights.get("thirteenf", 25.0)),
        ]

        # Filter non-null scores
        valid_scores = [(s, w) for s, w in scores if s is not None]

        if not valid_scores:
            return 0.0

        # Normalize weights for available scores
        total_weight = sum(w for _, w in valid_scores)
        weighted_sum = sum(s * w for s, w in valid_scores)

        composite = (weighted_sum / total_weight) * 100
        return min(composite, 100.0)

    # ========== DIAGNOSTICS ==========

    def get_cache_stats(self) -> Dict[str, int]:
        """Get cache statistics."""
        if not self.cache:
            return {"cache_enabled": False}

        stats = self.cache.stats()
        stats["cache_enabled"] = True
        return stats

    def get_data_freshness_status(self) -> Dict[str, Any]:
        """Get current data freshness status for all sources."""
        return self.freshness_monitor.get_status()

    def refresh_data_timestamps(self) -> None:
        """Manually refresh data freshness timestamps."""
        try:
            self.freshness_monitor.refresh_timestamps()
            logger.info("✓ Data freshness timestamps refreshed")
        except Exception as e:
            logger.error(f"Error refreshing timestamps: {e}")

    def clear_cache(self) -> None:
        """Clear all cached scoring results."""
        if self.cache:
            self.cache.clear()
            logger.info("✓ Scoring cache cleared")

    # ========== MAIN SCORING FUNCTION ==========

    def score_ticker(self, ticker: str, as_of_date: str) -> Dict[str, float]:
        """
        Calculate all 6 scores for a ticker on a given date.

        Args:
            ticker: Stock ticker
            as_of_date: Date to score (YYYY-MM-DD)

        Returns:
            Dictionary with all 6 scores:
            {
                "insider_cluster_score": 0-100,
                "activist_flag_score": 0-100,
                "cot_zscore": 0-100,
                "short_interest_momentum_score": 0-100,
                "thirteenf_conviction_score": 0-100,
                "composite_score": 0-100,
            }
        """
        logger.info(f"Scoring {ticker} as of {as_of_date}...")

        # Calculate all sub-scores
        insider_score = self.insider_cluster_score(ticker, as_of_date)
        activist_score = self.activist_flag_score(ticker, as_of_date)
        cot_score = self.cot_zscore(ticker, as_of_date)
        short_int_score = self.short_interest_momentum_score(ticker, as_of_date)
        thirteenf_score = self.thirteenf_conviction_score(ticker, as_of_date)

        # Calculate composite score
        composite = self.composite_score(
            insider_score, activist_score, cot_score, short_int_score, thirteenf_score
        )

        scores = {
            "insider_cluster_score": insider_score,
            "activist_flag_score": activist_score,
            "cot_zscore": cot_score,
            "short_interest_momentum_score": short_int_score,
            "thirteenf_conviction_score": thirteenf_score,
            "composite_score": composite,
        }

        logger.info(f"✓ {ticker}: Composite={composite:.1f}")
        return scores
