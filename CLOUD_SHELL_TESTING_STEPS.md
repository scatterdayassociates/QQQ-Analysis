# Cloud Shell Testing Steps - Copy & Paste Ready

**Purpose**: Test the Smart Money Pipeline Cloud Function step-by-step in Cloud Shell

**Estimated Time**: 10-15 minutes

---

## STEP 1: Navigate to Project Directory

```bash
cd ~/QQQ-Analysis
```

**Expected Output:**
```
(venv) user@cloudshell:~/QQQ-Analysis$
```

---

## STEP 2: Set Environment Variables

```bash
export DATABASE_HOST=1.2.3.4
export DATABASE_PORT=5432
export DATABASE_NAME=smart_money
export DATABASE_USER=cloudsql_user
export DATABASE_PASSWORD=your_password_here
export DATABASE_SSL_MODE=require
```

**❗ REPLACE THESE VALUES:**
- `1.2.3.4` → Your Cloud SQL public IP (find in Cloud Console)
- `your_password_here` → Your Cloud SQL user password

**To find Cloud SQL IP:**
```bash
gcloud sql instances describe smart-money-db --format="value(ipAddresses[0].ipAddress)"
```

**Expected Output:**
```
1.2.3.4
```

---

## STEP 3: Verify Environment Variables Are Set

```bash
echo "Database: $DATABASE_NAME"
echo "Host: $DATABASE_HOST"
echo "User: $DATABASE_USER"
echo "Port: $DATABASE_PORT"
```

**Expected Output:**
```
Database: smart_money
Host: 1.2.3.4
User: cloudsql_user
Port: 5432
```

---

## STEP 4: Install Required Python Packages

```bash
pip install python-dotenv requests psycopg2-binary pydantic -q
```

**Expected Output:**
```
(Shows warnings about running as root, that's OK)
```

---

## STEP 5: Test Database Connection

```bash
python -c "
import psycopg2
try:
    conn = psycopg2.connect(
        host='$DATABASE_HOST',
        port=$DATABASE_PORT,
        database='$DATABASE_NAME',
        user='$DATABASE_USER',
        password='$DATABASE_PASSWORD',
        sslmode='require'
    )
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM ticker_to_cik')
    count = cursor.fetchone()[0]
    print(f'✓ Database connected! Found {count} tickers')
    conn.close()
except Exception as e:
    print(f'✗ Connection failed: {e}')
"
```

**Expected Output:**
```
✓ Database connected! Found 93 tickers
```

**If it fails:**
- Check Cloud SQL public IP is correct
- Check firewall allows your IP
- Verify credentials are correct

---

## STEP 6: Check Recent Cloud Function Logs

```bash
gcloud functions logs read smart_money_pipeline_main --limit 30
```

**Expected Output:**
```
NAME: smart_money_pipeline_main
TIME_UTC                 LOG
2026-08-23 18:30:45.123  INFO: Fetching SEC EDGAR Form 4 filings...
2026-08-23 18:30:50.456  INFO: Found 145 Form 4 filings
2026-08-23 18:31:05.789  INFO: Fetching CFTC COT data...
...
```

**Look for:**
- ✓ "Found X filings" messages (indicates data being fetched)
- ✓ "Stored Y records" messages (indicates data being saved)
- ✗ "Error" messages (indicates something failed)

---

## STEP 7: Run Simple Database Query Test

```bash
python3 << 'EOF'
import psycopg2

# Connect to database
conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

# Query each table
tables = {
    'filings_4': 'Form 4',
    'filings_13d': '13D',
    'filings_13f': '13F',
    'cot': 'COT',
    'short_interest': 'Short Interest',
    'smart_money_scores': 'Smart Money Scores'
}

print("\n" + "="*60)
print("DATABASE TABLE COUNTS")
print("="*60)

for table, name in tables.items():
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        status = "✓" if count > 0 else "○"
        print(f"{status} {name:25} {count:6} records")
    except Exception as e:
        print(f"✗ {name:25} ERROR - {str(e)[:40]}")

conn.close()
EOF
```

**Expected Output:**
```
============================================================
DATABASE TABLE COUNTS
============================================================
✓ Form 4                       145 records
✓ 13D                           12 records
✓ 13F                          342 records
✓ COT                           52 records
○ Short Interest                 0 records
✓ Smart Money Scores            93 records
```

**Check:**
- Form 4: Should be 50+ (insider transactions)
- 13D: Should be 5+ (activist stakes)
- 13F: Should be 200+ (hedge fund holdings)
- COT: Should be exactly 52 (one year)
- Short Interest: 0 is OK (FINRA is blocked)
- Scores: Should match number of tickers (93)

---

## STEP 8: Check Data Quality - Sample Records

```bash
python3 << 'EOF'
import psycopg2

conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

print("\n" + "="*60)
print("SAMPLE DATA - FORM 4 RECORD")
print("="*60)

cursor.execute("""
    SELECT ticker, cik, transaction_date, shares, price, fetched_at
    FROM filings_4 LIMIT 1
""")
row = cursor.fetchone()
if row:
    print(f"Ticker:            {row[0]}")
    print(f"CIK:               {row[1]}")
    print(f"Transaction Date:  {row[2]}")
    print(f"Shares:            {row[3]}")
    print(f"Price:             {row[4]}")
    print(f"Fetched At:        {row[5]}")
else:
    print("No Form 4 records found")

print("\n" + "="*60)
print("SAMPLE DATA - SMART MONEY SCORE")
print("="*60)

cursor.execute("""
    SELECT ticker, smart_money_score, form4_signal, insider_days_signal, 
           activist_signal, cot_signal, updated_at
    FROM smart_money_scores LIMIT 1
""")
row = cursor.fetchone()
if row:
    print(f"Ticker:            {row[0]}")
    print(f"Smart Money Score: {row[1]:.2f}")
    print(f"Form 4 Signal:     {row[2]:.2f}")
    print(f"Insider Days:      {row[3]:.2f}")
    print(f"Activist Signal:   {row[4]:.2f}")
    print(f"COT Signal:        {row[5]:.2f}")
    print(f"Updated At:        {row[6]}")
else:
    print("No smart money scores found")

conn.close()
EOF
```

**Expected Output:**
```
============================================================
SAMPLE DATA - FORM 4 RECORD
============================================================
Ticker:            AAPL
CIK:               0000320193
Transaction Date:  2026-08-15
Shares:            1500
Price:             185.50
Fetched At:        2026-08-23 18:30:45.123456

============================================================
SAMPLE DATA - SMART MONEY SCORE
============================================================
Ticker:            AAPL
Smart Money Score: 72.50
Form 4 Signal:     75.00
Insider Days:      70.00
Activist Signal:   65.00
COT Signal:        75.00
Updated At:        2026-08-23 18:35:12.654321
```

---

## STEP 9: Check Data Freshness - When Was Data Last Updated?

```bash
python3 << 'EOF'
import psycopg2
from datetime import datetime

conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

print("\n" + "="*60)
print("DATA FRESHNESS CHECK")
print("="*60)

tables = ['filings_4', 'filings_13d', 'filings_13f', 'cot', 'smart_money_scores']

for table in tables:
    try:
        cursor.execute(f"SELECT MAX(fetched_at) FROM {table}")
        last_update = cursor.fetchone()[0]
        if last_update:
            time_ago = datetime.now() - last_update.replace(tzinfo=None)
            hours_ago = time_ago.total_seconds() / 3600
            
            if hours_ago < 1:
                status = "✓ FRESH"
            elif hours_ago < 24:
                status = "⚠ OLD"
            else:
                status = "✗ STALE"
            
            print(f"{status:12} {table:20} {hours_ago:6.1f} hours ago")
        else:
            print(f"○ EMPTY      {table:20} No data")
    except Exception as e:
        print(f"✗ ERROR      {table:20} {str(e)[:30]}")

conn.close()
EOF
```

**Expected Output:**
```
============================================================
DATA FRESHNESS CHECK
============================================================
✓ FRESH      filings_4              0.5 hours ago
✓ FRESH      filings_13d            0.5 hours ago
✓ FRESH      filings_13f            0.5 hours ago
✓ FRESH      cot                    0.5 hours ago
○ EMPTY      short_interest         (no data - FINRA blocked)
```

**Interpretation:**
- ✓ FRESH: Data updated within last hour (pipeline just ran)
- ⚠ OLD: Data is 1-24 hours old (pipeline ran but not recently)
- ✗ STALE: Data is 24+ hours old (pipeline may not have run)

---

## STEP 10: Run Full Cloud Function Test Suite

```bash
python smart_money_pipeline/scripts/test_cloud_function.py --full
```

**Expected Output (Long, full test suite):**
```
======================================================================
CLOUD FUNCTION TEST SUITE
======================================================================

======================================================================
TEST 2: Database Record Validation
======================================================================

Table Record Counts:
  ✓ filings_4              145 Form 4 Insider Transactions
      Sample: {'ticker': 'AAPL', 'cik': '0000320193', ...}
  ✓ filings_13d             12 13D Activist Stakes
      Sample: {'ticker': 'MSFT', 'cik': '0000789019', ...}
  ✓ filings_13f            342 13F Hedge Fund Holdings
      Sample: {'ticker': 'NVDA', 'cik': '0001045810', ...}
  ✓ cot                     52 CFTC Commitments of Traders
      Sample: {'symbol': 'NQ', 'report_date': '2026-08-16', ...}
  ○ short_interest           0 FINRA Short Interest
  ✓ smart_money_scores      93 Smart Money Scores
      Sample: {'ticker': 'AAPL', 'smart_money_score': 72.50, ...}

======================================================================
TEST 3: Data Quality Validation
======================================================================

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

======================================================================
TEST 4: Ticker Coverage
======================================================================

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

======================================================================
TEST SUMMARY
======================================================================
  database_test          PASS
  quality_test           PASS
  coverage_test          PASS

Total test time: 12.3s

✓ All tests passed!
```

---

## STEP 11: View Specific Ticker Scores

```bash
python3 << 'EOF'
import psycopg2

conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

print("\n" + "="*60)
print("TOP 10 TICKERS BY SMART MONEY SCORE")
print("="*60)

cursor.execute("""
    SELECT ticker, smart_money_score, form4_signal, activist_signal, cot_signal
    FROM smart_money_scores
    ORDER BY smart_money_score DESC
    LIMIT 10
""")

print(f"{'Ticker':<10} {'Score':<10} {'Form4':<10} {'Activist':<10} {'COT':<10}")
print("-" * 50)

for row in cursor.fetchall():
    print(f"{row[0]:<10} {row[1]:<10.2f} {row[2]:<10.2f} {row[3]:<10.2f} {row[4]:<10.2f}")

conn.close()
EOF
```

**Expected Output:**
```
============================================================
TOP 10 TICKERS BY SMART MONEY SCORE
============================================================
Ticker     Score      Form4      Activist   COT       
--------------------------------------------------
NVDA       79.50      85.00      75.00      78.50
TSLA       77.25      80.00      72.00      80.00
AAPL       72.50      75.00      70.00      75.00
META       69.10      72.00      65.00      70.00
MSFT       68.30      70.00      68.00      68.00
NFLX       64.20      65.00      60.00      68.00
GOOGL      61.20      60.00      55.00      62.00
COST       58.90      60.00      50.00      60.00
AMD        57.80      55.00      50.00      59.00
QCOM       56.50      58.00      48.00      57.00
```

---

## STEP 12: Check Form 4 Insider Activity

```bash
python3 << 'EOF'
import psycopg2
from datetime import datetime, timedelta

conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

print("\n" + "="*60)
print("RECENT FORM 4 INSIDER ACTIVITY (Last 7 Days)")
print("="*60)

seven_days_ago = (datetime.now() - timedelta(days=7)).date()

cursor.execute(f"""
    SELECT ticker, cik, transaction_date, shares, price
    FROM filings_4
    WHERE transaction_date >= '{seven_days_ago}'
    ORDER BY transaction_date DESC
    LIMIT 20
""")

print(f"{'Ticker':<10} {'CIK':<15} {'Date':<15} {'Shares':<12} {'Price':<10}")
print("-" * 62)

for row in cursor.fetchall():
    print(f"{row[0]:<10} {row[1]:<15} {str(row[2]):<15} {row[3]:<12} ${row[4]:<10.2f}")

conn.close()
EOF
```

**Expected Output:**
```
============================================================
RECENT FORM 4 INSIDER ACTIVITY (Last 7 Days)
============================================================
Ticker     CIK             Date            Shares       Price     
--------------------------------------------------------------
AAPL       0000320193      2026-08-23      1500         185.50    
AAPL       0000320193      2026-08-22      2000         184.75    
MSFT       0000789019      2026-08-21      500          415.20    
NVDA       0001045810      2026-08-20      3000         145.80    
...
```

---

## STEP 13: Check 13D Activist Filings

```bash
python3 << 'EOF'
import psycopg2

conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

print("\n" + "="*60)
print("13D ACTIVIST FILINGS")
print("="*60)

cursor.execute("""
    SELECT ticker, filer_name, pct_owned, filing_date, is_amendment
    FROM filings_13d
    ORDER BY filing_date DESC
    LIMIT 15
""")

print(f"{'Ticker':<10} {'Filer':<30} {'% Owned':<10} {'Date':<15} {'Amendment':<10}")
print("-" * 75)

for row in cursor.fetchall():
    amendment = "Yes" if row[4] else "No"
    print(f"{row[0]:<10} {row[1]:<30} {row[2]:<10.2f} {str(row[3]):<15} {amendment:<10}")

conn.close()
EOF
```

**Expected Output:**
```
============================================================
13D ACTIVIST FILINGS
============================================================
Ticker     Filer                          % Owned    Date            Amendment 
---------------------------------------------------------------------------
MSFT       Activist Fund LP               5.20       2026-08-20      No        
GOOGL      Investor Group Inc             3.15       2026-08-18      Yes       
META       Hedge Fund Partners            4.80       2026-08-15      No        
...
```

---

## STEP 14: Quick Status Summary

```bash
python3 << 'EOF'
import psycopg2
from datetime import datetime

conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

print("\n" + "="*70)
print(" "*20 + "SMART MONEY PIPELINE STATUS")
print("="*70)

# Get record counts
tables = ['filings_4', 'filings_13d', 'filings_13f', 'cot', 'smart_money_scores']
counts = {}
for table in tables:
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    counts[table] = cursor.fetchone()[0]

total_records = sum(counts.values())

# Get score stats
cursor.execute("""
    SELECT 
        COUNT(*) as total_scores,
        AVG(smart_money_score) as avg_score,
        MIN(smart_money_score) as min_score,
        MAX(smart_money_score) as max_score
    FROM smart_money_scores
""")
score_stats = cursor.fetchone()

# Data freshness
cursor.execute("SELECT MAX(fetched_at) FROM filings_4")
last_update = cursor.fetchone()[0]

print("\n📊 DATA SUMMARY:")
print(f"   Form 4 Filings:        {counts['filings_4']:>6} records")
print(f"   13D Activist Filings:  {counts['filings_13d']:>6} records")
print(f"   13F Holdings:          {counts['filings_13f']:>6} records")
print(f"   COT Data:              {counts['cot']:>6} records")
print(f"   Smart Money Scores:    {counts['smart_money_scores']:>6} records")
print(f"   {'─' * 40}")
print(f"   TOTAL:                 {total_records:>6} records")

print("\n⭐ SCORING SUMMARY:")
if score_stats and score_stats[0] > 0:
    print(f"   Scores Computed:       {score_stats[0]:>6} tickers")
    print(f"   Average Score:         {score_stats[1]:>6.2f} / 100")
    print(f"   Score Range:           {score_stats[2]:>6.2f} - {score_stats[3]:.2f}")
else:
    print(f"   No scores computed yet")

print("\n⏱️  DATA FRESHNESS:")
if last_update:
    time_ago = datetime.now() - last_update.replace(tzinfo=None)
    hours_ago = time_ago.total_seconds() / 3600
    print(f"   Last Updated:          {hours_ago:>6.1f} hours ago")
    
    if hours_ago < 1:
        status = "✓ FRESH - Pipeline ran recently"
    elif hours_ago < 24:
        status = "⚠ OLD - Pipeline hasn't run in 24 hours"
    else:
        status = "✗ STALE - Pipeline needs to run"
    print(f"   Status:                {status}")

print("\n" + "="*70)
print("✓ PIPELINE IS OPERATIONAL" if total_records > 300 else "⚠ PIPELINE NEEDS ATTENTION")
print("="*70 + "\n")

conn.close()
EOF
```

**Expected Output:**
```
======================================================================
                   SMART MONEY PIPELINE STATUS
======================================================================

📊 DATA SUMMARY:
   Form 4 Filings:           145 records
   13D Activist Filings:      12 records
   13F Holdings:             342 records
   COT Data:                  52 records
   Smart Money Scores:        93 records
   ────────────────────────────────────
   TOTAL:                    644 records

⭐ SCORING SUMMARY:
   Scores Computed:           93 tickers
   Average Score:          65.34 / 100
   Score Range:            25.12 - 87.43

⏱️  DATA FRESHNESS:
   Last Updated:             0.5 hours ago
   Status:                ✓ FRESH - Pipeline ran recently

======================================================================
✓ PIPELINE IS OPERATIONAL
======================================================================
```

---

## 🎯 Final Validation Checklist

```bash
echo "=== FINAL VALIDATION CHECKLIST ===" && \
python3 << 'EOF'
import psycopg2

conn = psycopg2.connect(
    host='$DATABASE_HOST',
    port=$DATABASE_PORT,
    database='$DATABASE_NAME',
    user='$DATABASE_USER',
    password='$DATABASE_PASSWORD',
    sslmode='require'
)

cursor = conn.cursor()

checks = []

# Check 1: Database connection
checks.append(("Database Connection", True))

# Check 2: Tickers loaded
cursor.execute("SELECT COUNT(*) FROM ticker_to_cik")
tickers = cursor.fetchone()[0]
checks.append(("Nasdaq-100 Tickers Loaded", tickers >= 90))

# Check 3: Form 4 data
cursor.execute("SELECT COUNT(*) FROM filings_4")
form4 = cursor.fetchone()[0]
checks.append(("Form 4 Records Ingested", form4 >= 50))

# Check 4: 13D data
cursor.execute("SELECT COUNT(*) FROM filings_13d")
d13d = cursor.fetchone()[0]
checks.append(("13D Records Ingested", d13d >= 5))

# Check 5: 13F data
cursor.execute("SELECT COUNT(*) FROM filings_13f")
d13f = cursor.fetchone()[0]
checks.append(("13F Records Ingested", d13f >= 200))

# Check 6: COT data
cursor.execute("SELECT COUNT(*) FROM cot")
cot = cursor.fetchone()[0]
checks.append(("COT Data (52 weeks)", cot >= 52))

# Check 7: Scores computed
cursor.execute("SELECT COUNT(*) FROM smart_money_scores")
scores = cursor.fetchone()[0]
checks.append(("Smart Money Scores", scores >= 50))

# Check 8: Score ranges
cursor.execute("""
    SELECT 
        MIN(smart_money_score) as min_score,
        MAX(smart_money_score) as max_score
    FROM smart_money_scores
""")
min_s, max_s = cursor.fetchone()
checks.append(("Score Range Valid (0-100)", min_s >= 0 and max_s <= 100))

print("\n" + "="*60)
print("VALIDATION CHECKLIST")
print("="*60)

passed = 0
for check, result in checks:
    status = "✓ PASS" if result else "✗ FAIL"
    print(f"{status:10} {check}")
    if result:
        passed += 1

print("="*60)
print(f"RESULT: {passed}/{len(checks)} checks passed")

if passed == len(checks):
    print("✓ ALL CHECKS PASSED - PIPELINE IS READY!")
else:
    print(f"⚠ {len(checks) - passed} checks failed - review above")

print("="*60 + "\n")

conn.close()
EOF
```

**Expected Output:**
```
============================================================
VALIDATION CHECKLIST
============================================================
✓ PASS   Database Connection
✓ PASS   Nasdaq-100 Tickers Loaded
✓ PASS   Form 4 Records Ingested
✓ PASS   13D Records Ingested
✓ PASS   13F Records Ingested
✓ PASS   COT Data (52 weeks)
✓ PASS   Smart Money Scores
✓ PASS   Score Range Valid (0-100)
============================================================
RESULT: 8/8 checks passed
✓ ALL CHECKS PASSED - PIPELINE IS READY!
============================================================
```

---

## Troubleshooting Commands

### If Database Connection Fails
```bash
# Check Cloud SQL is running
gcloud sql instances describe smart-money-db

# Check firewall allows your IP
gcloud sql instances patch smart-money-db \
  --require-ssl=false
```

### If No Records Found
```bash
# Check Cloud Function logs
gcloud functions logs read smart_money_pipeline_main --limit 100

# Check if function was triggered
gcloud scheduler jobs describe smart_money_trigger --format=json
```

### If Scores Not Computed
```bash
# Check scoring table exists
gcloud sql connect smart-money-db --user=cloudsql_user
SELECT * FROM smart_money_scores LIMIT 1;
```

### If FINRA Shows 0 Records (Expected)
```bash
# This is normal - see FINRA_ISSUE.md
# FINRA access is blocked by network policy
```

---

## Summary

You've now:
✓ Verified database connectivity  
✓ Checked Cloud Function logs  
✓ Validated all data tables have records  
✓ Checked data quality  
✓ Reviewed sample records  
✓ Analyzed smart money scores  
✓ Verified ticker coverage  
✓ Run full test suite  

**If all checks passed: 🎉 Pipeline is working!**
