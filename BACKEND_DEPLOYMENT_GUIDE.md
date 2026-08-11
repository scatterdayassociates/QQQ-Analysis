# Backend Deployment Guide - Smart Money Pipeline

## Overview
This guide walks through deploying the Python backend to enable the frontend dashboard to display live market data instead of mock data.

**Current Status**: Frontend deployed ✓ | Backend ready for deployment → | Live data **pending**

---

## Prerequisites

### System Requirements
- Python 3.9+
- PostgreSQL 13+ (already running at configured host)
- Linux/macOS/Windows with shell access
- ~2GB available disk space

### API Keys & Access
You'll need the following before starting:

| Source | What You Need | Obtained From |
|--------|---------------|---------------|
| **SEC EDGAR** | User-Agent header (email) | Already in code - uses your email |
| **CFTC** | Public access (no key needed) | Freely available |
| **FINRA** | Download access (no key needed) | Freely available files |
| **Polygon** | API key (if using vendor feed) | https://polygon.io |
| **Alpha Vantage** | API key (optional for short interest) | https://www.alphavantage.co |

---

## Step 1: Prepare the Database

### Connect to PostgreSQL
```bash
psql -h <db-host> -U <db-user> -d postgres
```

### Create database if needed
```sql
CREATE DATABASE qqq_analysis;
```

### Initialize schema
Run this SQL to create all required tables:

```sql
-- Create ticker mapping table
CREATE TABLE IF NOT EXISTS ticker_to_cik (
    ticker VARCHAR(10) PRIMARY KEY,
    cik VARCHAR(20) UNIQUE,
    company_name VARCHAR(255),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Form 4 transactions
CREATE TABLE IF NOT EXISTS form4_transactions (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    cik VARCHAR(20),
    filer_name VARCHAR(255),
    filer_role VARCHAR(100),
    is_officer BOOLEAN,
    is_director BOOLEAN,
    transaction_code VARCHAR(2),
    transaction_date DATE,
    shares INTEGER,
    price DECIMAL(10, 2),
    shares_owned_after INTEGER,
    filed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(ticker, cik, filer_name, transaction_date, shares, price)
);

-- 13D Filings
CREATE TABLE IF NOT EXISTS filings_13d (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    cik VARCHAR(20),
    filer_name VARCHAR(255),
    pct_owned DECIMAL(5, 2),
    filing_date DATE,
    is_amendment BOOLEAN,
    activist_keyword_flag BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(ticker, cik, filer_name, filing_date)
);

-- COT Positions
CREATE TABLE IF NOT EXISTS cot_positions (
    id SERIAL PRIMARY KEY,
    contract_name VARCHAR(255),
    report_date DATE,
    leveraged_funds_net BIGINT,
    open_interest BIGINT,
    commercial_net BIGINT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(contract_name, report_date)
);

-- Short Interest
CREATE TABLE IF NOT EXISTS short_interest (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(10),
    settlement_date DATE,
    shares_short BIGINT,
    prior_shares_short BIGINT,
    days_to_cover DECIMAL(5, 2),
    pct_float_short DECIMAL(5, 2),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(ticker, settlement_date)
);

-- 13F Holdings
CREATE TABLE IF NOT EXISTS thirteenf_positions (
    id SERIAL PRIMARY KEY,
    fund_cik VARCHAR(20),
    fund_name VARCHAR(255),
    ticker VARCHAR(10),
    shares_held BIGINT,
    market_value BIGINT,
    pct_of_fund_portfolio DECIMAL(5, 2),
    period_of_report DATE,
    filed_at TIMESTAMP,
    put_call_flag VARCHAR(4),
    option_notional BIGINT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(fund_cik, ticker, period_of_report)
);

-- Scores table
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
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(ticker, as_of_date)
);

-- Pipeline status tracking
CREATE TABLE IF NOT EXISTS ingestion_status (
    ingestion_date DATE PRIMARY KEY,
    status VARCHAR(50),
    pipeline_stats_json JSONB,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_form4_ticker ON form4_transactions(ticker);
CREATE INDEX idx_form4_date ON form4_transactions(transaction_date);
CREATE INDEX idx_13d_ticker ON filings_13d(ticker);
CREATE INDEX idx_13d_date ON filings_13d(filing_date);
CREATE INDEX idx_cot_date ON cot_positions(report_date);
CREATE INDEX idx_si_ticker ON short_interest(ticker);
CREATE INDEX idx_si_date ON short_interest(settlement_date);
CREATE INDEX idx_13f_ticker ON thirteenf_positions(ticker);
CREATE INDEX idx_scores_ticker ON scores(ticker);
CREATE INDEX idx_scores_date ON scores(as_of_date);
```

---

## Step 2: Configure Environment

### Create `.env` file in backend directory
```bash
# Database
DATABASE_HOST=<your-db-host>
DATABASE_PORT=5432
DATABASE_NAME=qqq_analysis
DATABASE_USER=<your-db-user>
DATABASE_PASSWORD=<your-db-password>

# SEC EDGAR
SEC_USER_AGENT="SmartMoneyPipeline david@scatterdayassociates.com"
SEC_RATE_LIMIT=2  # requests per second

# API Configuration
BACKEND_PORT=8000
BACKEND_HOST=0.0.0.0
LOG_LEVEL=INFO

# Optional: Vendor APIs
POLYGON_API_KEY=<optional>
ALPHA_VANTAGE_API_KEY=<optional>

# Scheduler
PIPELINE_SCHEDULE_HOUR=2  # UTC hour to run (2 AM UTC = 9 PM ET)
PIPELINE_SCHEDULE_MINUTE=0
PIPELINE_TIMEZONE=UTC
```

### Set environment variables
```bash
export $(cat .env | xargs)
```

---

## Step 3: Install and Run Backend

### Clone and setup
```bash
cd /path/to/backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

pip install -r requirements.txt
```

### Verify database connection
```bash
python -c "from smart_money_pipeline.common.db import get_connection; get_connection()"
```

Expected output: No error = connection successful ✓

### Populate ticker mapping
```bash
python smart_money_pipeline/cli.py init-tickers
```

This fetches the latest ticker-to-CIK mapping from SEC's company_tickers.json

---

## Step 4: Test Individual Ingestors (Optional)

Before running the full pipeline, test each data source:

```bash
# Test Form 4 (Insider Transactions)
python smart_money_pipeline/cli.py ingest form4 --limit 5

# Test 13D (Activist Filings)
python smart_money_pipeline/cli.py ingest thirteend --limit 5

# Test COT (Futures Positioning)
python smart_money_pipeline/cli.py ingest cot

# Test Short Interest
python smart_money_pipeline/cli.py ingest short-interest

# Test 13F (Institutional Holdings)
python smart_money_pipeline/cli.py ingest thirteenf --limit 5
```

Each should complete without errors. Check logs for warnings about missing data.

---

## Step 5: Run Full Pipeline

### Manual test run (for today's data)
```bash
python smart_money_pipeline/cli.py run-pipeline
```

This will:
1. ✅ Fetch from all 5 data sources
2. ✅ Parse and normalize the data
3. ✅ Store to database
4. ✅ Calculate composite scores for all Nasdaq-100 tickers
5. ✅ Record pipeline status

**Expected duration**: 3-8 minutes depending on network

### Check results
```bash
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -c "
SELECT COUNT(*) as total_scores, 
       COUNT(CASE WHEN composite_score > 0 THEN 1 END) as scored,
       AVG(composite_score) as avg_score,
       MAX(composite_score) as max_score
FROM scores 
WHERE as_of_date = CURRENT_DATE;"
```

Expected: Should see scores for 90-100 tickers with composite scores 0-100

---

## Step 6: Deploy Backend Service

### Option A: Standalone Process
```bash
# Run in foreground (for testing)
python -m smart_money_pipeline.api.main

# Run in background with nohup
nohup python -m smart_money_pipeline.api.main > backend.log 2>&1 &
```

### Option B: Systemd Service (Recommended for Production)

Create `/etc/systemd/system/smart-money-backend.service`:

```ini
[Unit]
Description=Smart Money Pipeline Backend
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/backend
Environment="PATH=/path/to/backend/venv/bin"
EnvironmentFile=/path/to/backend/.env
ExecStart=/path/to/backend/venv/bin/python -m smart_money_pipeline.api.main
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable smart-money-backend
sudo systemctl start smart-money-backend
sudo systemctl status smart-money-backend
```

### Option C: Docker (Recommended)

Create `Dockerfile`:
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["python", "-m", "smart_money_pipeline.api.main"]
```

Build and run:
```bash
docker build -t smart-money-backend .
docker run -d \
  --env-file .env \
  -p 8000:8000 \
  --name smart-money-backend \
  smart-money-backend
```

---

## Step 7: Configure Scheduled Pipeline

### Option A: APScheduler (Built-in)
The backend includes APScheduler which runs automatically. The pipeline executes at:
- **Time**: 2:00 AM UTC daily (configurable via `PIPELINE_SCHEDULE_HOUR`)
- **Task**: Fetch all data sources and recalculate scores

Check scheduler status:
```bash
curl http://localhost:8000/api/smart-money/scheduler/status
```

Expected response:
```json
{
  "status": "running",
  "jobs": [
    {
      "id": "pipeline-daily",
      "name": "Run Full Pipeline",
      "next_run": "2026-08-12T02:00:00+00:00"
    }
  ]
}
```

### Option B: Cron Job (Alternative)
```bash
# Edit crontab
crontab -e

# Add this line (runs at 2 AM UTC)
0 2 * * * cd /path/to/backend && /path/to/backend/venv/bin/python smart_money_pipeline/cli.py run-pipeline >> logs/cron.log 2>&1
```

---

## Step 8: Connect Frontend to Backend

### Update frontend environment
In your Next.js deployment (Vercel), set:
```
BACKEND_API_URL=https://your-backend-domain.com
```

Or for local development:
```
BACKEND_API_URL=http://localhost:8000
```

### Verify connection
Frontend will automatically:
1. Try to fetch from `BACKEND_API_URL`
2. Show real data if backend responds
3. Show "⚠ Using Mock Data" if backend unavailable
4. Display per-source freshness timestamps once connected

---

## Step 9: Monitoring & Health Checks

### Health endpoint
```bash
curl http://localhost:8000/api/smart-money/health
# Response: {"status": "healthy", "timestamp": "2026-08-12T02:15:30Z"}
```

### Data freshness check
```bash
curl http://localhost:8000/api/smart-money/scoring/data-freshness
```

This shows when each data source was last updated.

### View recent scores
```bash
curl "http://localhost:8000/api/smart-money/scores?universe=Nasdaq-100&limit=10"
```

### Monitor logs
```bash
# If using systemd
sudo journalctl -u smart-money-backend -f

# If using Docker
docker logs -f smart-money-backend

# If using nohup
tail -f backend.log
```

---

## Troubleshooting

### Problem: Database Connection Failed
**Solution**: Check credentials and network access
```bash
psql -h $DATABASE_HOST -U $DATABASE_USER -c "SELECT 1"
```

### Problem: SEC EDGAR Rate Limited (403 Forbidden)
**Solution**: Reduce rate limit and add delays
```bash
# In .env
SEC_RATE_LIMIT=0.5  # Slower: 0.5 requests/second
```

### Problem: No scores calculated
**Solution**: Check data freshness
```bash
curl http://localhost:8000/api/smart-money/scoring/data-freshness
```

If all sources show "No data available", the ingestors haven't run yet. Run pipeline manually:
```bash
python smart_money_pipeline/cli.py run-pipeline
```

### Problem: Frontend still shows "Using Mock Data"
**Solution**: Verify backend URL and CORS
```bash
# From frontend server, test backend
curl -I http://your-backend:8000/api/smart-money/health

# Check CORS is enabled in FastAPI app
```

### Problem: Pipeline runs but takes too long
**Solution**: Check for database bottlenecks
```bash
# Add indexes if missing (see Step 1)
# Check database size
psql -c "SELECT pg_size_pretty(pg_database_size('qqq_analysis'));"
```

---

## Performance Tuning

### Database Connection Pool
In `config.py`, adjust:
```python
DATABASE_POOL_SIZE = 5        # Connections per worker
DATABASE_MAX_OVERFLOW = 10    # Additional connections when needed
DATABASE_POOL_TIMEOUT = 30    # Connection acquisition timeout
```

### Score Calculation Cache
The backend includes a 1-hour in-memory cache. To clear:
```bash
curl -X POST http://localhost:8000/api/smart-money/scoring/clear-cache
```

### Parallel Data Fetching
Ingestors fetch data in parallel. Threads configured in `cli.py`:
```python
MAX_WORKERS = 4  # Adjust based on CPU cores
```

---

## Security Checklist

- [ ] Database credentials in `.env` (not in code)
- [ ] Backend behind authentication/firewall in production
- [ ] SEC User-Agent includes contact email
- [ ] Rate limits configured to respect API terms
- [ ] Logs don't contain sensitive data
- [ ] Database backups enabled
- [ ] CORS configured to allow frontend domain only

---

## Timeline to Live Data

1. **Now**: Backend deployed (Steps 1-7) = ~30 minutes
2. **Next scheduled run**: 2:00 AM UTC tomorrow
3. **Data available**: 2:20 AM UTC (pipeline duration ~20 min)
4. **Frontend shows real data**: Automatic once backend responds

**To see data immediately**: Run pipeline manually after deployment
```bash
python smart_money_pipeline/cli.py run-pipeline
```

---

## Next Steps After Deployment

1. ✅ Verify backend is running: `curl http://localhost:8000/api/smart-money/health`
2. ✅ Run pipeline: `python smart_money_pipeline/cli.py run-pipeline`
3. ✅ Check scores: `curl http://localhost:8000/api/smart-money/scores`
4. ✅ Update frontend `BACKEND_API_URL` environment variable
5. ✅ Dashboard shows real data with per-source freshness timestamps

---

## Support & Monitoring

### Key Endpoints for Monitoring
| Endpoint | Purpose |
|----------|---------|
| `GET /api/smart-money/health` | Backend status |
| `GET /api/smart-money/scores` | Get all scores |
| `GET /api/smart-money/scoring/data-freshness` | Last update times |
| `GET /api/smart-money/scoring/cache-stats` | Cache efficiency |
| `GET /api/smart-money/scheduler/status` | Pipeline schedule |
| `POST /api/smart-money/scheduler/trigger` | Manually run pipeline |

### Logging
- Check backend logs for ingestor errors
- Database error logs in PostgreSQL
- Frontend console shows mock data warning if backend unavailable

### Contact Points for Issues
- **SEC API errors**: Check User-Agent header and rate limits
- **Database errors**: Verify PostgreSQL availability and schema
- **FINRA short interest**: May need to configure vendor feed
- **Frontend not updating**: Check BACKEND_API_URL and CORS

---

## Optional: Historical Data Backfill

To populate historical scores beyond tomorrow's pipeline:

```bash
# Backfill last 30 days
for i in {30..1}; do
  DATE=$(date -d "$i days ago" +%Y-%m-%d)
  python smart_money_pipeline/cli.py run-pipeline --date $DATE
done
```

This enables historical analysis on the frontend.
