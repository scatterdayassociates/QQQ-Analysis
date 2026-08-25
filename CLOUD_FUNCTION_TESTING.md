# Cloud Function Testing Guide

**Purpose**: Validate that the Smart Money Pipeline Cloud Function is working correctly and ingesting data from all sources.

**Test Location**: `smart_money_pipeline/scripts/test_cloud_function.py`

---

## Quick Start

### Test 1: Full Validation Suite (Recommended)
```bash
# Set environment variables
export DATABASE_HOST=your_cloud_sql_ip
export DATABASE_PORT=5432
export DATABASE_NAME=smart_money
export DATABASE_USER=your_db_user
export DATABASE_PASSWORD=your_db_password

# Run full test suite
python smart_money_pipeline/scripts/test_cloud_function.py --full
```

### Test 2: Database Only (Fastest)
```bash
# Check if data was ingested into database
python smart_money_pipeline/scripts/test_cloud_function.py --database
```

### Test 3: HTTP Endpoint (If Public)
```bash
# Call Cloud Function directly
python smart_money_pipeline/scripts/test_cloud_function.py \
  --url https://region-project.cloudfunctions.net/smart_money_pipeline_main
```

---

## Test Details

### TEST 1: Cloud Function HTTP Endpoint
**What it tests**: Direct HTTP call to Cloud Function

**Output**:
```
Status Code: 200
Response Time: 2.45s
Response Body: {...}
```

**Success Criteria**: Status 200 with valid response

**Use when**: Function is publicly accessible

---

### TEST 2: Database Record Validation
**What it tests**: Count of ingested records in each table

**Output**:
```
Table Record Counts:
  ✓ filings_4             145 Form 4 Insider Transactions
  ✓ filings_13d            12 13D Activist Stakes
  ✓ filings_13f           342 13F Hedge Fund Holdings
  ✓ cot                    52 CFTC Commitments of Traders
  ○ short_interest          0 FINRA Short Interest
  ✓ smart_money_scores     93 Smart Money Scores
```

**Success Criteria**:
- Form 4: 50+ records
- 13D: 5+ records
- 13F: 200+ records
- COT: 52 records (full year)
- Short Interest: 0+ (FINRA may be unavailable)
- Scores: 50+ records

**Expected Totals**:
- Without FINRA: 600+ records across 5 tables
- With FINRA: 650+ records across 6 tables

---

### TEST 3: Data Quality Validation
**What it tests**: Data completeness and consistency

**Output**:
```
1. Form 4 Records:
   ✓ Valid Form 4 records: 145

2. 13D Records:
   ✓ Valid 13D records: 12

3. 13F Records:
   ✓ Valid 13F records: 342

4. COT Records:
   ✓ COT records: 52 (expected ≥52)

5. Short Interest Records:
   ○ Short interest records: 0

6. Smart Money Scores:
   ✓ Total scores: 93
     Avg score: 65.34
     Score range: 25.12 - 87.43
```

**Success Criteria**:
- All scores in 0-100 range
- Average score between 40-80
- All records have required fields

---

### TEST 4: Ticker Coverage
**What it tests**: Data availability for key tickers

**Output**:
```
Data Coverage by Ticker:
Ticker   Form 4   13D      13F      COT      Score   
------   ------   ---      ---      ---      -----
AAPL     12       2        18       52       72.5    
MSFT     8        1        15       52       68.3    
NVDA     15       3        22       52       75.8    
GOOGL    6        0        12       52       61.2    
META     9        2        14       52       69.1    
TSLA     11       2        19       52       73.4    
COST     4        0        8        52       58.9    
NFLX     7        1        11       52       64.2    
```

**Success Criteria**:
- Each ticker has data across multiple sources
- Scores computed for all tickers
- Coverage is consistent

---

## Expected Results Summary

### Success Case (All Tests Pass)
```
TEST SUMMARY
  http_test              PASS
  database_test          PASS
  quality_test           PASS
  coverage_test          PASS

✓ All tests passed!
```

**What this means**:
- Cloud Function executed successfully
- All data sources (except FINRA) are ingesting data
- Data quality is good
- Smart money scores are being computed

### Partial Success (Database tests pass, HTTP fails)
```
TEST SUMMARY
  http_test              FAIL (unreachable)
  database_test          PASS
  quality_test           PASS
  coverage_test          PASS

✓ Cloud Function is working (HTTP endpoint just isn't public)
```

**What this means**:
- Function is working but endpoint isn't accessible
- Data is being ingested correctly
- Ignore HTTP failure if function runs on a schedule

### Failure Case (No records)
```
TEST SUMMARY
  http_test              PASS
  database_test          FAIL (0 records)
  quality_test           FAIL
  coverage_test          FAIL

⚠ 3 test(s) failed
```

**What this means**:
- Function ran but no data was ingested
- Check Cloud Function logs for errors
- Verify database connection credentials
- Verify SEC EDGAR and CFTC APIs are accessible

---

## Troubleshooting Guide

### No Records in Database
1. Check Cloud Function logs:
   ```bash
   gcloud functions logs read smart_money_pipeline_main --limit 50
   ```

2. Look for errors related to:
   - Database connection
   - SEC EDGAR API access
   - CFTC API access
   - Data parsing

3. Run test_data_sources.py to verify APIs work:
   ```bash
   python smart_money_pipeline/scripts/test_data_sources.py
   ```

### Low Record Counts
1. Check if all data sources are working:
   - Form 4: Requires SEC EDGAR access + valid CIKs
   - 13D: Requires SEC EDGAR access
   - 13F: Requires SEC EDGAR access + fund CIKs
   - COT: Should return 52 (1 year of data)
   - Short Interest: FINRA is network-restricted

2. Verify ticker_to_cik table has data:
   ```sql
   SELECT COUNT(*) FROM ticker_to_cik;  -- Should be 93
   ```

### Scores Not Computed
1. Verify form 4 and 13D ingestors ran
2. Check if ticker-to-CIK mapping exists
3. Look for errors in scoring logic

### FINRA Always Empty
This is expected - network environment blocks access. See `FINRA_ISSUE.md`

---

## Running Tests Regularly

### Option 1: Manual Testing (Ad-hoc)
```bash
# After deploying Cloud Function, run tests
python smart_money_pipeline/scripts/test_cloud_function.py --full
```

### Option 2: Automated Testing (Schedule)
```bash
# Add to Cloud Scheduler to run after pipeline
gcloud scheduler jobs create pubsub test-cloud-function \
  --schedule "0 2 * * *" \
  --topic smartmoney_test_trigger
```

Then create a Cloud Function that runs the tests.

### Option 3: CI/CD Integration
```bash
# Add to GitHub Actions workflow
- name: Test Cloud Function
  run: |
    python smart_money_pipeline/scripts/test_cloud_function.py --full
```

---

## Environment Variables Required

```bash
# Database connection
export DATABASE_HOST=your_cloud_sql_public_ip
export DATABASE_PORT=5432
export DATABASE_NAME=smart_money
export DATABASE_USER=cloudsql_user
export DATABASE_PASSWORD=your_password
export DATABASE_SSL_MODE=require

# For Cloud Shell testing
gcloud sql connect smart-money-db --user=cloudsql_user
```

---

## Interpreting Timestamps

Records are timestamped with `fetched_at` field:
- **Recent** (< 1 hour): Fresh data from current pipeline run
- **Old** (> 24 hours): Data from previous run
- **Empty**: Pipeline hasn't run yet

Check when Cloud Function was last scheduled:
```bash
gcloud functions describe smart_money_pipeline_main
```

---

## Performance Baselines

**Expected execution times**:
- Test 1 (HTTP): 2-5 seconds
- Test 2 (Database): 1-3 seconds
- Test 3 (Quality): 3-5 seconds
- Test 4 (Coverage): 5-10 seconds
- **Total**: ~15-30 seconds for full suite

If tests take much longer:
- Database may be under heavy load
- Network latency to Cloud SQL may be high
- Check for slow queries in Cloud Logging

---

## Test Output Interpretation

### ✓ (Checkmark)
Data found and passes validation

### ○ (Circle)
Data not found but no error (expected in some cases like FINRA)

### ✗ (X)
Error or validation failure - investigation needed

---

## Next Steps After Testing

### If All Tests Pass ✓
1. Monitor regular pipeline runs
2. Check daily for data updates
3. Validate scores are reasonable

### If Some Tests Fail ⚠
1. Review test output for specific failures
2. Check Cloud Function logs
3. Run diagnostic test scripts
4. Verify network connectivity
5. Check database capacity

### If All Tests Fail ✗
1. Verify Cloud Function was deployed
2. Check function execution status
3. Review Cloud Logging for errors
4. Verify database is accessible
5. Run `test_data_sources.py` to test APIs directly

---

## Useful Commands

```bash
# View Cloud Function code
gcloud functions describe smart_money_pipeline_main

# View recent logs
gcloud functions logs read smart_money_pipeline_main --limit 100

# Trigger function manually
gcloud functions call smart_money_pipeline_main --data '{}'

# Check database records
gcloud sql connect smart-money-db --user=cloudsql_user
SELECT COUNT(*) FROM filings_4;
SELECT COUNT(*) FROM smart_money_scores;

# Check last run time
SELECT MAX(fetched_at) FROM filings_4;
```

---

## Contact & Support

For issues with:
- **SEC EDGAR access**: Check `sec_edgar.py` rate limiter and user-agent
- **CFTC API access**: Check `cftc_cot.py` endpoint
- **FINRA access**: See `FINRA_ISSUE.md` (network-restricted)
- **Database**: Check Cloud SQL credentials and firewall
- **Scoring**: Check `scoring.py` logic and input data
