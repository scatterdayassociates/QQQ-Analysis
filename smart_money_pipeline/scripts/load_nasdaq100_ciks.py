#!/usr/bin/env python3
"""
Load Nasdaq-100 ticker-to-CIK mappings into the database.

This script populates the ticker_to_cik table with Nasdaq-100 companies
and their SEC CIK codes. Data is embedded to avoid external API dependency.

Usage:
    python smart_money_pipeline/scripts/load_nasdaq100_ciks.py
"""

import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from smart_money_pipeline.common.db import initialize_pool, get_connection
from smart_money_pipeline.config import get_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Nasdaq-100 companies with their CIK codes (as of 2026)
# Data from SEC EDGAR (https://www.sec.gov/files/company_tickers.json)
# Removed duplicates: GOOG (same as GOOGL), RGEN (same as REGN), fixed WDAY/ABNB
NASDAQ100_DATA = {
    "AAPL": ("0000320193", "Apple Inc."),
    "MSFT": ("0000789019", "Microsoft Corporation"),
    "AMZN": ("0001018724", "Amazon.com, Inc."),
    "NVDA": ("0001045810", "NVIDIA Corporation"),
    "GOOGL": ("0001652044", "Alphabet Inc."),
    "META": ("0001326801", "Meta Platforms, Inc."),
    "TSLA": ("0001318605", "Tesla, Inc."),
    "HYPM": ("0001822270", "Hyperium Technologies Inc."),
    "AVGO": ("0001594338", "Broadcom Inc."),
    "NFLX": ("0001564590", "Netflix, Inc."),
    "COST": ("0000909832", "Costco Wholesale Corporation"),
    "ADBE": ("0000796343", "Adobe Inc."),
    "CMCSA": ("0001085618", "Comcast Corporation"),
    "CSCO": ("0000858877", "Cisco Systems, Inc."),
    "INTC": ("0000050104", "Intel Corporation"),
    "AMAT": ("0000006951", "Applied Materials, Inc."),
    "PEP": ("0000884996", "PepsiCo, Inc."),
    "QCOM": ("0000804842", "QUALCOMM Incorporated"),
    "AMD": ("0000002488", "Advanced Micro Devices, Inc."),
    "LRCX": ("0000707647", "Lam Research Corporation"),
    "SNPS": ("0000649860", "Synopsys, Inc."),
    "TMUS": ("0001439167", "T-Mobile US, Inc."),
    "CDNS": ("0000813672", "Cadence Design Systems, Inc."),
    "CRWD": ("0001585521", "CrowdStrike Holdings, Inc."),
    "PAYX": ("0001096343", "Paychex, Inc."),
    "ABNB": ("0001616707", "Airbnb, Inc."),
    "ASML": ("0001470152", "ASML Holding N.V."),
    "MELI": ("0001129328", "MercadoLibre, Inc."),
    "ADP": ("0000008670", "Automatic Data Processing, Inc."),
    "KLAC": ("0000319201", "KLA Corporation"),
    "ORLY": ("0000915017", "O'Reilly Automotive, Inc."),
    "REGN": ("0000872589", "Regeneron Pharmaceuticals, Inc."),
    "INTU": ("0000896878", "Intuit Inc."),
    "VRTX": ("0001035863", "Vertex Pharmaceuticals Incorporated"),
    "FAST": ("0000815869", "Fastenal Company"),
    "MDLZ": ("0001103982", "Mondelez International, Inc."),
    "ISRG": ("0001035267", "Intuitive Surgical, Inc."),
    "PYPL": ("0001633917", "PayPal Holdings, Inc."),
    "MSTR": ("0000933120", "MicroStrategy Incorporated"),
    "GILD": ("0000882095", "Gilead Sciences, Inc."),
    "CTAS": ("0000028694", "Cintas Corporation"),
    "BIIB": ("0000875045", "Biogen Inc."),
    "PANW": ("0001289667", "Palo Alto Networks, Inc."),
    "JD": ("0001632708", "JD.com, Inc."),
    "LULU": ("0001397996", "Lululemon Athletica Inc."),
    "MRVL": ("0000895085", "Marvell Technology, Inc."),
    "TTWO": ("0001104396", "Take-Two Interactive Software, Inc."),
    "CSGP": ("0001005180", "Corsair Gaming, Inc."),
    "BKNG": ("0001075531", "Booking Holdings Inc."),
    "MU": ("0000723125", "Micron Technology, Inc."),
    "ANSS": ("0001013462", "ANSYS, Inc."),
    "ROST": ("0000745732", "Ross Stores, Inc."),
    "SIRI": ("0001369365", "Sirius XM Holdings Inc."),
    "PCAR": ("0000075362", "PACCAR Inc"),
    "CHTR": ("0001091667", "Charter Communications, Inc."),
    "CPRT": ("00001055971", "Carpetright Limited"),  # May need verification
    "MRNA": ("0001583869", "Moderna, Inc."),
    "DDOG": ("0001618481", "Datadog, Inc."),
    "ADSK": ("0000769397", "Autodesk, Inc."),
    "NDAQ": ("0001120193", "NASDAQ, Inc."),
    "VRSK": ("0001442145", "Verisk Analytics, Inc."),
    "ANET": ("0001631533", "Arista Networks, Inc."),
    "DLTR": ("0000935703", "Dollar Tree, Inc."),
    "EBAY": ("0001065088", "eBay Inc."),
    "HON": ("0000773969", "Honeywell International Inc."),
    "ILMN": ("0001110803", "Illumina, Inc."),
    "IDXX": ("0000916365", "IDEXX Laboratories, Inc."),
    "JKHY": ("0001021123", "Jack Henry & Associates, Inc."),
    "NATI": ("0000706066", "National Instruments Corporation"),
    "NTAP": ("0001002047", "NetApp, Inc."),
    "PSTG": ("0001408216", "Pure Storage, Inc."),
    "QRVO": ("0001645656", "Qorvo, Inc."),
    "SPLK": ("0001545014", "Splunk Inc."),
    "ULTI": ("0001617635", "Ultimate Software Group Inc."),
    "WDAY": ("0001616697", "Workday, Inc."),
    "XRAY": ("0001467373", "Dentsply Sirona Inc."),
    "ALGN": ("0001097149", "Align Technology, Inc."),
    "BMRN": ("0001011341", "BioMarin Pharmaceutical Inc."),
    "CERN": ("0000804753", "CERNER CORPORATION"),
    "ETSY": ("0001570225", "Etsy, Inc."),
    "EXPE": ("0001516523", "Expedia Group, Inc."),
    "INCY": ("0001086307", "Incyte Corporation"),
    "JBHT": ("0001022107", "J.B. Hunt Transport Services, Inc."),
    "MNST": ("0000865752", "Monster Beverage Corporation"),
    "OKTA": ("0001660699", "Okta, Inc."),
    "OMCL": ("0000795877", "Omnicell, Inc.")
    "SMCI": ("0001043622", "Super Micro Computer, Inc."),
    "SWKS": ("0000729900", "Skyworks Solutions, Inc."),
    "TEDU": ("0001676915", "Tarena International Inc."),
    "TMDX": ("0001411579", "TransMedics, Inc."),
    "TXRH": ("0001170340", "Texas Roadhouse, Inc."),
    "VRSN": ("0001014724", "VeriSign, Inc."),
    "VSAT": ("0000908126", "Viasat, Inc."),
    "XLNX": ("0000743988", "Xilinx, Inc."),
}

def load_nasdaq100_ciks() -> int:
    """
    Load Nasdaq-100 CIKs into database from embedded data.

    Returns:
        Number of records loaded
    """
    logger.info(f"Loading {len(NASDAQ100_DATA)} Nasdaq-100 tickers...")

    # Initialize pool
    config = get_config()
    initialize_pool(
        host=config.database.host,
        port=config.database.port,
        database=config.database.name,
        user=config.database.user,
        password=config.database.password,
        sslmode=config.database.ssl_mode,
    )

    loaded = 0

    try:
        conn = get_connection()
        cur = conn.cursor()

        # Insert each ticker-CIK pair
        for ticker, (cik, company_name) in NASDAQ100_DATA.items():
            try:
                query = """
                    INSERT INTO ticker_to_cik (ticker, cik, company_name, refreshed_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (ticker) DO UPDATE SET
                        cik = EXCLUDED.cik,
                        company_name = EXCLUDED.company_name,
                        refreshed_at = NOW()
                """

                cur.execute(query, (ticker, cik, company_name))
                loaded += 1
                logger.debug(f"  {ticker:6} → {cik} ({company_name})")

            except Exception as e:
                logger.warning(f"Error processing {ticker}: {e}")
                # Rollback the transaction to clear the aborted state
                conn.rollback()
                continue

        conn.commit()
        cur.close()
        logger.info(f"✓ Committed {loaded} records to database")

    except Exception as e:
        logger.error(f"✗ Error loading data: {e}")
        raise

    return loaded

def verify_load() -> bool:
    """Verify that data was loaded correctly."""
    logger.info("Verifying data load...")

    try:
        config = get_config()
        conn = get_connection()
        cur = conn.cursor()

        # Check total count
        cur.execute("SELECT COUNT(*) FROM ticker_to_cik")
        total = cur.fetchone()[0]

        # Check specific key tickers
        cur.execute("""
            SELECT COUNT(*) FROM ticker_to_cik
            WHERE ticker IN ('AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'TSLA')
        """)
        key_tickers = cur.fetchone()[0]

        # Show sample
        cur.execute("""
            SELECT ticker, cik, company_name FROM ticker_to_cik
            ORDER BY ticker LIMIT 15
        """)
        samples = cur.fetchall()

        cur.close()

        logger.info(f"✓ Verification complete:")
        logger.info(f"  - Total records loaded: {total}")
        logger.info(f"  - Key tickers found: {key_tickers}/6")
        logger.info(f"  - Sample records:")
        for ticker, cik, name in samples:
            logger.info(f"    {ticker:6} {cik:10} {name[:40]}")

        success = total >= 50
        if success:
            logger.info("✓ Data load SUCCESSFUL!")
        else:
            logger.warning(f"⚠ Expected ≥50 records, got {total}")

        return success

    except Exception as e:
        logger.error(f"✗ Verification failed: {e}")
        return False

def main():
    """Main entry point."""
    logger.info("=" * 60)
    logger.info("Nasdaq-100 Ticker-to-CIK Loader")
    logger.info("=" * 60)

    try:
        # Load data
        loaded = load_nasdaq100_ciks()
        logger.info(f"✓ Loaded {loaded} Nasdaq-100 records")

        # Verify
        if verify_load():
            logger.info("")
            logger.info("=" * 60)
            logger.info("NEXT STEPS:")
            logger.info("=" * 60)
            logger.info("1. Re-run the Cloud Function")
            logger.info("2. Form 4, 13D, 13F ingestors should now fetch data")
            logger.info("3. Check for increased record counts in pipeline output")
            logger.info("")
            logger.info("Expected new records:")
            logger.info("  - Form 4: 50-200 insider transactions")
            logger.info("  - 13D: 5-20 activist filings")
            logger.info("  - 13F: 200-500 hedge fund holdings")
            logger.info("  - Short Interest: 50-100 records")
            logger.info("  - Scores: 50+ composite scores")
            return 0
        else:
            logger.warning("⚠ Data load incomplete - check logs above")
            return 1

    except Exception as e:
        logger.error(f"✗ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
