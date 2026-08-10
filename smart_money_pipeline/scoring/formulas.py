"""
Smart Money Pipeline Scoring Formulas.

Implements all 6 scoring sub-functions and composite score calculation:
1. Insider Cluster Score - insider buy clustering
2. Activist Flag Score - activist stake intensity
3. COT Z-Score - leveraged funds positioning
4. Short Interest Momentum Score - short interest trend strength
5. 13F Conviction Score - smart money fund concentration
6. Composite Score - weighted combination of all sub-scores
"""

from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import logging
import statistics

from smart_money_pipeline.config import get_config
from smart_money_pipeline.common.db import execute_query, get_connection

logger = logging.getLogger(__name__)


class ScoringFormulas:
    """All scoring formulas for Smart Money Pipeline."""

    def __init__(self):
        """Initialize scoring formulas with configuration."""
        self.config = get_config()
        self.weights = self.config.scoring.weights

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
            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Get insider buys in 30-day window
            date_30d_ago = (as_of - timedelta(days=30)).strftime("%Y-%m-%d")
            query_30d = """
                SELECT COUNT(DISTINCT filer_name) as unique_insiders
                FROM form4_transactions
                WHERE ticker = %s
                AND transaction_code = 'P'
                AND transaction_date BETWEEN %s AND %s
            """
            result_30d = execute_query(query_30d, (ticker, date_30d_ago, as_of_date), fetch_one=True)
            count_30d = result_30d[0] if result_30d else 0

            # Get insider buys in 90-day window
            date_90d_ago = (as_of - timedelta(days=90)).strftime("%Y-%m-%d")
            query_90d = """
                SELECT COUNT(DISTINCT filer_name) as unique_insiders
                FROM form4_transactions
                WHERE ticker = %s
                AND transaction_code = 'P'
                AND transaction_date BETWEEN %s AND %s
            """
            result_90d = execute_query(query_90d, (ticker, date_90d_ago, as_of_date), fetch_one=True)
            count_90d = result_90d[0] if result_90d else 0

            # Average number of insiders for normalization (baseline ~3-5)
            avg_insiders = 3.5

            # Calculate score
            score_30d = (count_30d / avg_insiders) * self.config.scoring.insider_30d_weight * 100
            score_90d = (count_90d / avg_insiders) * self.config.scoring.insider_90d_weight * 100

            score = score_30d + score_90d
            return min(score, 100.0)  # Cap at 100

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
            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Get most recent 13D filing
            query = """
                SELECT filing_date, is_amendment, activist_keyword_flag
                FROM filings_13d
                WHERE ticker = %s
                AND filing_date <= %s
                ORDER BY filing_date DESC
                LIMIT 1
            """
            result = execute_query(query, (ticker, as_of_date), fetch_one=True)

            if not result:
                return 0.0  # No activist filings

            filing_date_str, is_amendment, activist_flag = result
            days_since = (as_of - datetime.strptime(filing_date_str, "%Y-%m-%d")).days

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
            # Map ticker to futures contract (simplified mapping)
            if ticker in ["QQQ", "TSLA", "AMZN", "NVDA", "AAPL", "MSFT"]:
                contract = "NQ"  # Nasdaq-100 index
            elif ticker in ["SPY", "IVV", "VOO"]:
                contract = "ES"  # S&P 500 index
            else:
                # Default to broad market
                contract = "ES"

            # Get historical COT positions (90-day lookback)
            lookback_days = 90
            date_start = (
                datetime.strptime(as_of_date, "%Y-%m-%d") - timedelta(days=lookback_days)
            ).strftime("%Y-%m-%d")

            query = """
                SELECT leveraged_funds_net
                FROM cot_positions
                WHERE contract_name = %s
                AND report_date BETWEEN %s AND %s
                ORDER BY report_date ASC
            """
            results = execute_query(query, (contract, date_start, as_of_date), fetch_one=False)

            if not results or len(results) < 5:
                return None  # Insufficient data

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
            return max(0.0, min(score, 100.0))

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
            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Get short interest data (90-day lookback)
            lookback_days = 90
            date_start = (as_of - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

            query = """
                SELECT settlement_date, shares_short
                FROM short_interest
                WHERE ticker = %s
                AND settlement_date BETWEEN %s AND %s
                ORDER BY settlement_date ASC
            """
            results = execute_query(query, (ticker, date_start, as_of_date), fetch_one=False)

            if not results or len(results) < 3:
                return None  # Insufficient data

            shares_short_history = [r[1] for r in results]

            # Calculate 30-day changes
            changes = []
            for i in range(1, len(shares_short_history)):
                if shares_short_history[i - 1] > 0:
                    pct_change = (shares_short_history[i] - shares_short_history[i - 1]) / shares_short_history[i - 1]
                    changes.append(pct_change)

            if len(changes) < 2:
                return None

            # Recent change (most recent 30 days)
            recent_change = changes[-1]

            # Historical standard deviation of changes
            std_changes = statistics.stdev(changes) if len(changes) > 1 else 0
            if std_changes == 0:
                return 50.0  # No variation, neutral

            # Calculate momentum
            momentum = recent_change / std_changes

            # Scale to 0-100
            score = 50 + (momentum * 25)
            return max(0.0, min(score, 100.0))

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
            as_of = datetime.strptime(as_of_date, "%Y-%m-%d")

            # Get latest 13F positions for this ticker
            lookback_days = self.config.scoring.thirteenf_filing_window_days
            date_start = (as_of - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

            query = """
                SELECT fund_name, pct_of_fund_portfolio, filed_at
                FROM thirteenf_positions
                WHERE ticker = %s
                AND put_call_flag IS NULL  -- Stock positions only
                AND period_of_report BETWEEN %s AND %s
                ORDER BY pct_of_fund_portfolio DESC
                LIMIT 10  -- Top 10 funds
            """
            results = execute_query(query, (ticker, date_start, as_of_date), fetch_one=False)

            if not results:
                return 0.0  # No 13F holdings

            # Get top 3 fund concentrations
            top_percentages = [r[1] for r in results[:3]]
            avg_concentration = sum(top_percentages) / len(top_percentages)

            # Get recency boost from most recent filing
            most_recent_filing_str = results[0][2]
            days_since_filing = (as_of - datetime.strptime(most_recent_filing_str, "%Y-%m-%d %H:%M:%S")).days

            if days_since_filing <= 45:
                recency_boost = 1.0
            elif days_since_filing <= 90:
                recency_boost = 0.8
            else:
                recency_boost = 0.5

            # Calculate score
            score = avg_concentration * recency_boost * 100
            return min(score, 100.0)

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
