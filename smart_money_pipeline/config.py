"""
Smart Money Pipeline Configuration.

Loads and manages configuration from environment variables and config files.
All tuneable parameters (weights, funds, rate limits, etc.) are defined here.
"""

import os
from typing import Dict, List
from dataclasses import dataclass, field
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv(".env.local")


@dataclass
class DatabaseConfig:
    """Database connection configuration."""
    host: str = field(default_factory=lambda: os.getenv("DATABASE_HOST", "localhost"))
    port: int = field(default_factory=lambda: int(os.getenv("DATABASE_PORT", "5432")))
    name: str = field(default_factory=lambda: os.getenv("DATABASE_NAME", "defaultdb"))
    user: str = field(default_factory=lambda: os.getenv("DATABASE_USER", "postgres"))
    password: str = field(default_factory=lambda: os.getenv("DATABASE_PASSWORD", ""))
    ssl_mode: str = field(default_factory=lambda: os.getenv("DATABASE_SSL_MODE", "require"))
    pool_min_size: int = 1
    pool_max_size: int = 10

    @property
    def connection_string(self) -> str:
        """Return psycopg2-compatible connection string."""
        return (
            f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.name}"
            f"?sslmode={self.ssl_mode}"
        )


@dataclass
class SECConfig:
    """SEC EDGAR API configuration."""
    # User-Agent is REQUIRED by SEC
    user_agent: str = field(
        default_factory=lambda: os.getenv(
            "SEC_USER_AGENT",
            "QQQ-Analysis david@scatterdayassociates.com"
        )
    )
    # Rate limiting for SEC EDGAR (max ~10 req/sec, but be conservative)
    rate_limit_per_sec: float = field(
        default_factory=lambda: float(os.getenv("SEC_RATE_LIMIT_PER_SEC", "5"))
    )
    # Retry settings
    max_retries: int = 3
    retry_backoff_factor: float = 1.5  # Exponential backoff


@dataclass
class IngestConfig:
    """Data ingestion configuration."""
    # Historical lookback window
    lookback_days: int = field(
        default_factory=lambda: int(os.getenv("LOOKBACK_DAYS", "365"))
    )
    # Batch sizes for bulk operations
    batch_size: int = 100
    # Whether to upsert (update on duplicate key) instead of inserting
    upsert_on_conflict: bool = True


@dataclass
class ScoringConfig:
    """Scoring formula configuration."""
    # Composite score weights (must sum to 100 for weighting to work)
    weights: Dict[str, float] = field(default_factory=lambda: {
        "insider": 25.0,           # Insider cluster buys
        "activist": 15.0,           # Activist stakes
        "cot": 20.0,                # COT z-score
        "short_interest": 15.0,     # Short interest momentum
        "thirteenf": 25.0,          # 13F conviction
    })

    # Normalization windows
    insider_30d_weight: float = 0.4
    insider_90d_weight: float = 0.6

    # 13D scoring thresholds
    activist_fresh_days: int = 30  # Filing is "fresh" if < 30d old
    activist_max_age_days: int = 365

    # Short interest calculation
    short_int_percentile_window: int = 365  # Days for percentile calculation

    # 13F calculation window
    thirteenf_filing_window_days: int = 45  # Days after quarter-end to capture filings

    def validate(self) -> bool:
        """Validate weights sum to reasonable value (100±5%)."""
        total = sum(self.weights.values())
        if not (95 <= total <= 105):
            raise ValueError(
                f"Weights must sum to ~100 (got {total}). "
                f"Weights: {self.weights}"
            )
        return True


@dataclass
class FundConfig:
    """Fund basket configuration for 13F analysis."""
    # Configurable list of funds to track (as CIK strings)
    fund_ciks: Dict[str, str] = field(default_factory=lambda: {
        "Citadel": "1207907",  # Citadel Advisors
        "Millennium": "1617103",  # Millennium Management
        "Point72": "1000229",  # Point72 Asset Management
        "Balyasny": "1707410",  # Balyasny Asset Management
    })

    # Include options in conviction scoring?
    include_options: bool = True


@dataclass
class UniverseConfig:
    """Stock universe configuration."""
    # Default universe: Nasdaq-100
    default_universe: str = "Nasdaq-100"

    # Available universes
    universes: Dict[str, List[str]] = field(default_factory=lambda: {
        "Nasdaq-100": [],  # Will be loaded from SEC company_tickers.json
        "S&P 500": [],
        "Russell 2000": [],
    })


@dataclass
class AppConfig:
    """Master application configuration."""
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    sec: SECConfig = field(default_factory=SECConfig)
    ingest: IngestConfig = field(default_factory=IngestConfig)
    scoring: ScoringConfig = field(default_factory=ScoringConfig)
    funds: FundConfig = field(default_factory=FundConfig)
    universe: UniverseConfig = field(default_factory=UniverseConfig)

    # Logging
    log_level: str = field(
        default_factory=lambda: os.getenv("LOG_LEVEL", "INFO")
    )

    def validate(self) -> bool:
        """Validate all sub-configs."""
        self.scoring.validate()
        return True


# Singleton configuration instance
_config: AppConfig | None = None


def get_config() -> AppConfig:
    """Get or create the application configuration singleton."""
    global _config
    if _config is None:
        _config = AppConfig()
        _config.validate()
    return _config


def reset_config() -> None:
    """Reset config singleton (mainly for testing)."""
    global _config
    _config = None


# Example usage and validation
if __name__ == "__main__":
    config = get_config()
    print("Configuration loaded:")
    print(f"  Database: {config.database.host}:{config.database.port}/{config.database.name}")
    print(f"  SEC User-Agent: {config.sec.user_agent}")
    print(f"  Scoring Weights: {config.scoring.weights}")
    print(f"  Funds Tracked: {config.funds.fund_ciks}")
    print(f"  Log Level: {config.log_level}")
