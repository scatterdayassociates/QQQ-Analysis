"""
CLI - Command-line interface for Smart Money Pipeline.
Provides commands for manual pipeline execution and management.
"""

import logging
from datetime import datetime
from typing import Optional

import typer

from smart_money_pipeline.pipeline.orchestrator import PipelineOrchestrator
from smart_money_pipeline.api.scores_service import ScoresService

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = typer.Typer(help="Smart Money Pipeline CLI")


@app.command()
def run_pipeline(
    as_of_date: Optional[str] = typer.Option(
        None,
        "--date",
        "-d",
        help="Date to calculate scores for (YYYY-MM-DD). Defaults to today.",
    ),
) -> None:
    """
    Run the complete pipeline: fetch data, calculate scores, store results.

    Example:
        smart_money run-pipeline
        smart_money run-pipeline --date 2026-08-10
    """
    typer.echo("\n" + "=" * 70)
    typer.echo("🚀 Starting Smart Money Pipeline")
    typer.echo("=" * 70 + "\n")

    orchestrator = PipelineOrchestrator()
    result = orchestrator.run_full_pipeline(as_of_date=as_of_date)

    # Print summary
    typer.echo("\n" + "=" * 70)
    typer.echo(f"Status: {result['status'].upper()}")
    typer.echo(f"Date: {result['as_of_date']}")

    if "duration_seconds" in result:
        typer.echo(f"Duration: {result['duration_seconds']:.1f}s")

    typer.echo(f"\nData Ingestion:")
    for name, stats in result.get("ingestors", {}).items():
        status = "✓" if stats.get("status") == "success" else "✗"
        typer.echo(f"  {status} {name}: {stats.get('stored_records', 0)} records")

    typer.echo(f"\nScoring:")
    typer.echo(f"  ✓ Calculated: {result['scoring']['successful_scores']} tickers")
    typer.echo(f"  ✓ Stored: {result['scoring']['stored_scores']} scores")
    typer.echo(f"  ✗ Failed: {result['scoring']['failed_scores']} tickers")

    if result["status"] == "failed":
        typer.echo(f"\nError: {result['error']}")
        raise typer.Exit(code=1)

    typer.echo("\n" + "=" * 70)
    typer.echo("✓ Pipeline completed successfully")
    typer.echo("=" * 70 + "\n")


@app.command()
def ingest_form4() -> None:
    """Run Form 4 ingestor only."""
    typer.echo("Running Form 4 ingestor...")
    from smart_money_pipeline.ingestors.form4 import Form4Ingestor

    ingestor = Form4Ingestor()
    raw = ingestor.fetch()
    typer.echo(f"  Fetched: {len(raw)} raw records")

    parsed = ingestor.parse(raw)
    typer.echo(f"  Parsed: {len(parsed)} records")

    success = ingestor.store(parsed)
    typer.echo(f"  Stored: {'✓' if success else '✗'}")


@app.command()
def ingest_thirteend() -> None:
    """Run 13D ingestor only."""
    typer.echo("Running 13D ingestor...")
    from smart_money_pipeline.ingestors.filings_13d import Filings13DIngestor

    ingestor = Filings13DIngestor()
    raw = ingestor.fetch()
    typer.echo(f"  Fetched: {len(raw)} raw records")

    parsed = ingestor.parse(raw)
    typer.echo(f"  Parsed: {len(parsed)} records")

    success = ingestor.store(parsed)
    typer.echo(f"  Stored: {'✓' if success else '✗'}")


@app.command()
def ingest_cot() -> None:
    """Run COT ingestor only."""
    typer.echo("Running COT ingestor...")
    from smart_money_pipeline.ingestors.cot import COTIngestor

    ingestor = COTIngestor()
    raw = ingestor.fetch()
    typer.echo(f"  Fetched: {len(raw)} raw records")

    parsed = ingestor.parse(raw)
    typer.echo(f"  Parsed: {len(parsed)} records")

    success = ingestor.store(parsed)
    typer.echo(f"  Stored: {'✓' if success else '✗'}")


@app.command()
def ingest_short_interest() -> None:
    """Run short interest ingestor only."""
    typer.echo("Running short interest ingestor...")
    from smart_money_pipeline.ingestors.short_interest import ShortInterestIngestor

    ingestor = ShortInterestIngestor()
    raw = ingestor.fetch()
    typer.echo(f"  Fetched: {len(raw)} raw records")

    parsed = ingestor.parse(raw)
    typer.echo(f"  Parsed: {len(parsed)} records")

    success = ingestor.store(parsed)
    typer.echo(f"  Stored: {'✓' if success else '✗'}")


@app.command()
def ingest_thirteenf() -> None:
    """Run 13F ingestor only."""
    typer.echo("Running 13F ingestor...")
    from smart_money_pipeline.ingestors.thirteenf import ThirteenFIngestor

    ingestor = ThirteenFIngestor()
    raw = ingestor.fetch()
    typer.echo(f"  Fetched: {len(raw)} raw records")

    parsed = ingestor.parse(raw)
    typer.echo(f"  Parsed: {len(parsed)} records")

    success = ingestor.store(parsed)
    typer.echo(f"  Stored: {'✓' if success else '✗'}")


@app.command()
def score_universe(
    universe: str = typer.Option(
        "Nasdaq-100",
        "--universe",
        "-u",
        help="Stock universe to score",
    ),
    as_of_date: Optional[str] = typer.Option(
        None,
        "--date",
        "-d",
        help="Date to calculate scores for (YYYY-MM-DD)",
    ),
    limit: int = typer.Option(50, "--limit", "-l", help="Maximum results to show"),
) -> None:
    """
    Calculate scores for all stocks in a universe.

    Example:
        smart_money score-universe
        smart_money score-universe --universe "S&P 500" --limit 100
        smart_money score-universe --date 2026-08-10
    """
    typer.echo(f"\nCalculating scores for {universe}...")

    service = ScoresService()
    result = service.calculate_scores_for_universe(
        universe=universe,
        as_of_date=as_of_date,
        limit=limit,
    )

    if "error" in result:
        typer.echo(f"Error: {result['error']}")
        raise typer.Exit(code=1)

    # Print results
    typer.echo(f"\nTop {result['count']} scores for {universe}:")
    typer.echo("-" * 100)
    typer.echo(
        f"{'Rank':<5} {'Ticker':<8} {'Insider':<10} {'Activist':<10} "
        f"{'COT':<10} {'Short Int':<12} {'13F Conv':<12} {'Composite':<10}"
    )
    typer.echo("-" * 100)

    for i, score in enumerate(result["scores"], 1):
        typer.echo(
            f"{i:<5} {score['ticker']:<8} "
            f"{score.get('insider_cluster_score', 0):<10.2f} "
            f"{score.get('activist_flag_score', 0):<10.2f} "
            f"{score.get('cot_zscore', 0):<10.2f} "
            f"{score.get('short_interest_momentum_score', 0):<12.2f} "
            f"{score.get('thirteenf_conviction_score', 0):<12.2f} "
            f"{score.get('composite_score', 0):<10.2f}"
        )

    typer.echo("-" * 100)
    typer.echo(f"Calculated at: {result['as_of_date']}")


@app.command()
def score_ticker(
    ticker: str = typer.Argument(..., help="Stock ticker symbol"),
    as_of_date: Optional[str] = typer.Option(
        None,
        "--date",
        "-d",
        help="Date to calculate scores for (YYYY-MM-DD)",
    ),
) -> None:
    """
    Calculate all scores for a specific ticker.

    Example:
        smart_money score-ticker AAPL
        smart_money score-ticker AAPL --date 2026-08-10
    """
    typer.echo(f"\nCalculating scores for {ticker}...")

    service = ScoresService()
    result = service.calculate_scores_for_ticker(ticker, as_of_date)

    if "error" in result:
        typer.echo(f"Error: {result['error']}")
        raise typer.Exit(code=1)

    # Print results
    typer.echo(f"\nScores for {ticker}:")
    typer.echo("-" * 50)
    typer.echo(f"Date: {result['as_of_date']}")
    typer.echo(f"Insider Cluster Score:        {result.get('insider_cluster_score', 0):.2f}")
    typer.echo(f"Activist Flag Score:          {result.get('activist_flag_score', 0):.2f}")
    typer.echo(f"COT Z-Score:                  {result.get('cot_zscore', 0):.2f}")
    typer.echo(f"Short Interest Momentum:      {result.get('short_interest_momentum_score', 0):.2f}")
    typer.echo(f"13F Conviction Score:         {result.get('thirteenf_conviction_score', 0):.2f}")
    typer.echo(f"\n{'Composite Score:'.ljust(30)} {result.get('composite_score', 0):.2f}")
    typer.echo("-" * 50)


if __name__ == "__main__":
    app()
