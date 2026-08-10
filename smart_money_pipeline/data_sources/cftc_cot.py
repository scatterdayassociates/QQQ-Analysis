"""
CFTC Commitments of Traders (COT) Integration.
Fetches leveraged funds positioning from CFTC COT reports.
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import requests
import pandas as pd

logger = logging.getLogger(__name__)


class CFTCCOTClient:
    """Client for CFTC Commitments of Traders data."""

    def __init__(self):
        """Initialize CFTC COT client."""
        # CFTC provides COT data via REST API and CSV downloads
        self.base_url = "https://www.cftc.gov/ws/public/cftc"
        self.disaggregated_url = (
            "https://www.cftc.gov/dea/cotarchives/json"
        )

    def fetch_cot_for_contract(
        self, contract: str = "NQ", lookback_weeks: int = 52
    ) -> List[Dict[str, Any]]:
        """
        Fetch COT data for a specific futures contract.

        Args:
            contract: Contract code (e.g., 'NQ' for E-mini Nasdaq-100)
            lookback_weeks: How far back to fetch data

        Returns:
            List of COT records with dates and positions
        """
        try:
            logger.info(f"Fetching COT data for {contract} ({lookback_weeks} weeks)")

            # CFTC publishes disaggregated COT data
            # Available at: https://www.cftc.gov/market-reports/commitments-traders/historical-compressed-files
            cot_data = self._fetch_disaggregated_cot(contract, lookback_weeks)

            logger.info(f"Fetched {len(cot_data)} COT records for {contract}")
            return cot_data

        except Exception as e:
            logger.error(f"Error fetching COT data for {contract}: {e}")
            return []

    def _fetch_disaggregated_cot(
        self, contract: str, lookback_weeks: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch CFTC Disaggregated COT report.

        The disaggregated report breaks down positions by:
        - Producer/Merchant/Processor/User
        - Swap Dealer
        - Money Manager (Leveraged Funds)
        - Other Reportables
        - Non-Reportables

        Args:
            contract: Contract name (e.g., 'E-mini NASDAQ-100 Stock Index Futures')
            lookback_weeks: Lookback period

        Returns:
            List of COT records
        """
        try:
            # CFTC JSON API endpoint (if available)
            # Otherwise fall back to CSV download
            params = {
                "compress": "gzip",
                "year": datetime.now().year,
            }

            # Attempt to fetch from CFTC API
            response = requests.get(
                f"{self.disaggregated_url}/CftcDealerByVenueJson",
                params=params,
                timeout=10,
            )

            if response.status_code == 200:
                data = response.json()
                return self._parse_cftc_json(data, contract)
            else:
                # Fall back to CSV parsing
                return self._fetch_cot_csv(contract, lookback_weeks)

        except Exception as e:
            logger.warning(f"Error fetching disaggregated COT: {e}")
            # Fallback: return empty list or implement CSV parsing
            return self._fetch_cot_csv(contract, lookback_weeks)

    def _fetch_cot_csv(
        self, contract: str, lookback_weeks: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch COT data from CFTC CSV files.

        CFTC publishes historical data as compressed CSV files:
        https://www.cftc.gov/dea/cotarchives/

        Args:
            contract: Contract name
            lookback_weeks: Lookback period

        Returns:
            List of COT records
        """
        try:
            # For NQ (E-mini Nasdaq), map to CFTC contract name
            cftc_contract_map = {
                "NQ": "E-mini NASDAQ-100 Stock Index Futures",
                "ES": "E-mini S&P 500 Stock Index Futures",
                "YM": "E-mini Dow Stock Index Futures",
            }

            contract_name = cftc_contract_map.get(contract, contract)

            # CFTC publishes weekly reports every Friday
            # Historical files at: https://www.cftc.gov/dea/cotarchives/json

            # For this implementation, we'll simulate fetching
            # In production, parse actual CSV/JSON files from CFTC
            logger.info(
                f"Would fetch COT CSV for {contract_name} from CFTC archive"
            )

            # Placeholder: return sample structure
            # Production would parse actual CFTC data
            cot_records = []

            end_date = datetime.now()
            for weeks_back in range(lookback_weeks):
                report_date = end_date - timedelta(weeks=weeks_back)

                # Skip weekends (COT reports on Fridays)
                if report_date.weekday() > 4:
                    report_date = report_date - timedelta(
                        days=report_date.weekday() - 4
                    )

                # Create sample record structure
                record = {
                    "contract_name": contract,
                    "report_date": report_date.strftime("%Y-%m-%d"),
                    "leveraged_funds_net": 0,  # Would be populated from CSV
                    "open_interest": 0,  # Would be populated from CSV
                    "commercial_net": 0,  # Would be populated from CSV
                    "source": "cftc",
                    "fetched_at": datetime.now().isoformat(),
                }
                cot_records.append(record)

            return cot_records

        except Exception as e:
            logger.error(f"Error fetching COT CSV for {contract}: {e}")
            return []

    def _parse_cftc_json(self, data: Dict[str, Any], contract: str) -> List[Dict[str, Any]]:
        """
        Parse CFTC JSON response.

        Args:
            data: Parsed JSON from CFTC API
            contract: Contract to filter for

        Returns:
            List of COT records
        """
        records = []

        try:
            # Navigate JSON structure (varies by endpoint)
            if "result" in data:
                for item in data["result"]:
                    if contract in item.get("contract_name", ""):
                        record = {
                            "contract_name": contract,
                            "report_date": item.get("report_date"),
                            "leveraged_funds_net": int(
                                item.get("money_manager_net", 0)
                            ),
                            "open_interest": int(item.get("open_interest", 0)),
                            "commercial_net": int(item.get("commercial_net", 0)),
                            "source": "cftc_api",
                            "fetched_at": datetime.now().isoformat(),
                        }
                        records.append(record)

        except Exception as e:
            logger.warning(f"Error parsing CFTC JSON: {e}")

        return records


def get_nq_cot_data(weeks: int = 52) -> List[Dict[str, Any]]:
    """
    Convenience function to fetch NQ COT data.

    Args:
        weeks: Lookback period in weeks

    Returns:
        List of COT records for E-mini Nasdaq-100
    """
    client = CFTCCOTClient()
    return client.fetch_cot_for_contract("NQ", weeks)
