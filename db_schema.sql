-- Smart Money Pipeline Database Schema
-- Execute this SQL on your DigitalOcean Postgres database
--
-- From local machine with psql installed:
--   psql -h db-postgresql-nyc3-47709-do-user-19616823-0.k.db.ondigitalocean.com \
--        -U doadmin -d defaultdb -p 25060 -f db_schema.sql
--
-- Or copy/paste this entire script into DigitalOcean's web console

-- Ticker to CIK mapping (refresh from SEC company_tickers.json)
CREATE TABLE IF NOT EXISTS ticker_to_cik (
    ticker VARCHAR(10) PRIMARY KEY,
    cik VARCHAR(10) NOT NULL UNIQUE,
    company_name VARCHAR(255),
    refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ticker to sector mapping (reuse from existing Nasdaq-100 dashboard)
CREATE TABLE IF NOT EXISTS ticker_to_sector (
    ticker VARCHAR(10) PRIMARY KEY,
    sector VARCHAR(100),
    refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Form 4 (Insider Transactions)
CREATE TABLE IF NOT EXISTS form4_transactions (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    cik VARCHAR(10),
    filer_name VARCHAR(255),
    filer_role VARCHAR(100),
    is_officer BOOLEAN,
    is_director BOOLEAN,
    transaction_code CHAR(1),
    transaction_date DATE,
    shares BIGINT,
    price DECIMAL(10, 2),
    shares_owned_after BIGINT,
    filed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT form4_unique UNIQUE(cik, transaction_date, shares, price)
);

CREATE INDEX IF NOT EXISTS idx_form4_ticker ON form4_transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_form4_date ON form4_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_form4_cik ON form4_transactions(cik);

-- Schedule 13D / 13D-A (Activist Stakes)
CREATE TABLE IF NOT EXISTS filings_13d (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    cik VARCHAR(10),
    filer_name VARCHAR(255),
    pct_owned DECIMAL(5, 2),
    filing_date DATE,
    is_amendment BOOLEAN,
    activist_keyword_flag BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT filings_13d_unique UNIQUE(cik, filing_date, is_amendment)
);

CREATE INDEX IF NOT EXISTS idx_13d_ticker ON filings_13d(ticker);
CREATE INDEX IF NOT EXISTS idx_13d_date ON filings_13d(filing_date);
CREATE INDEX IF NOT EXISTS idx_13d_cik ON filings_13d(cik);

-- CFTC Commitments of Traders (COT)
CREATE TABLE IF NOT EXISTS cot_positions (
    id SERIAL PRIMARY KEY,
    contract_name VARCHAR(100),
    report_date DATE,
    leveraged_funds_net BIGINT,
    open_interest BIGINT,
    commercial_net BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cot_unique UNIQUE(contract_name, report_date)
);

CREATE INDEX IF NOT EXISTS idx_cot_date ON cot_positions(report_date);

-- FINRA Short Interest
CREATE TABLE IF NOT EXISTS short_interest (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    settlement_date DATE,
    shares_short BIGINT,
    prior_shares_short BIGINT,
    days_to_cover DECIMAL(5, 2),
    pct_float_short DECIMAL(5, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT short_interest_unique UNIQUE(ticker, settlement_date)
);

CREATE INDEX IF NOT EXISTS idx_short_int_ticker ON short_interest(ticker);
CREATE INDEX IF NOT EXISTS idx_short_int_date ON short_interest(settlement_date);

-- SEC 13F (Institutional Holdings)
CREATE TABLE IF NOT EXISTS thirteenf_positions (
    id SERIAL PRIMARY KEY,
    fund_cik VARCHAR(10),
    fund_name VARCHAR(255),
    ticker VARCHAR(10),
    shares_held BIGINT,
    market_value BIGINT,
    pct_of_fund_portfolio DECIMAL(5, 2),
    period_of_report DATE,
    filed_at TIMESTAMP,
    put_call_flag VARCHAR(4),
    option_notional DECIMAL(18, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT thirteenf_unique UNIQUE(fund_cik, ticker, period_of_report, put_call_flag)
);

CREATE INDEX IF NOT EXISTS idx_13f_ticker ON thirteenf_positions(ticker);
CREATE INDEX IF NOT EXISTS idx_13f_fund ON thirteenf_positions(fund_cik);
CREATE INDEX IF NOT EXISTS idx_13f_date ON thirteenf_positions(period_of_report);

-- Composite Scores (Main Output Table)
CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    as_of_date DATE,
    insider_cluster_score DECIMAL(5, 2),
    activist_flag_score DECIMAL(5, 2),
    cot_zscore DECIMAL(5, 2),
    short_interest_momentum_score DECIMAL(5, 2),
    thirteenf_conviction_score DECIMAL(5, 2),
    composite_score DECIMAL(5, 2),
    weights_used_json JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT scores_unique UNIQUE(ticker, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_scores_ticker ON scores(ticker);
CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(as_of_date);
CREATE INDEX IF NOT EXISTS idx_scores_composite ON scores(composite_score DESC);

-- Ingestion status tracking
CREATE TABLE IF NOT EXISTS ingestion_status (
    id SERIAL PRIMARY KEY,
    source_name VARCHAR(100),
    last_ingested_at TIMESTAMP,
    next_scheduled_at TIMESTAMP,
    status VARCHAR(50),
    error_message TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ingestion_status_unique UNIQUE(source_name)
);

CREATE INDEX IF NOT EXISTS idx_ingest_source ON ingestion_status(source_name);
