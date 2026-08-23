# Quick Cloud Function Test - 5 Minutes

Copy and paste each command in order.

---

## **COMMAND 1: Set Credentials**

```bash
cd ~/QQQ-Analysis && \
export DATABASE_HOST=35.192.68.127 && \
export DATABASE_PORT=5432 && \
export DATABASE_NAME=smart_money && \
export DATABASE_USER=pipeline_user && \
export DATABASE_PASSWORD='PipelinePassP2024Secure' && \
export DATABASE_SSL_MODE=require && \
echo "✓ Credentials set"
```

---

## **COMMAND 2: Test Connection**

```bash
python3 << 'EOF'
import psycopg2
conn = psycopg2.connect(host='35.192.68.127', port=5432, database='smart_money', user='pipeline_user', password='PipelinePassP2024Secure', sslmode='require')
cursor = conn.cursor()
cursor.execute('SELECT COUNT(*) FROM ticker_to_cik')
count = cursor.fetchone()[0]
print(f'✓ Connected! Found {count} tickers')
conn.close()
EOF
```

**Expected Output:**
```
✓ Connected! Found 93 tickers
```

---

## **COMMAND 3: Check Data Tables**

```bash
python3 << 'EOF'
import psycopg2
conn = psycopg2.connect(host='35.192.68.127', port=5432, database='smart_money', user='pipeline_user', password='PipelinePassP2024Secure', sslmode='require')
cursor = conn.cursor()
for table, name in [('filings_4','Form 4'), ('filings_13d','13D'), ('filings_13f','13F'), ('cot','COT'), ('smart_money_scores','Scores')]:
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    print(f"  {name:15} {cursor.fetchone()[0]:6} records")
conn.close()
EOF
```

**Expected Output:**
```
  Form 4           145 records
  13D               12 records
  13F              342 records
  COT               52 records
  Scores            93 records
```

---

## **COMMAND 4: Run Full Test**

```bash
python smart_money_pipeline/scripts/test_cloud_function.py --full
```

**Expected Output:**
```
======================================================================
TEST SUMMARY
======================================================================
  database_test          PASS
  quality_test           PASS
  coverage_test          PASS

✓ All tests passed!
```

---

## **COMMAND 5: View Top Scores**

```bash
python3 << 'EOF'
import psycopg2
conn = psycopg2.connect(host='35.192.68.127', port=5432, database='smart_money', user='pipeline_user', password='PipelinePassP2024Secure', sslmode='require')
cursor = conn.cursor()
cursor.execute("SELECT ticker, smart_money_score FROM smart_money_scores ORDER BY smart_money_score DESC LIMIT 10")
print("\nTop 10 Smart Money Scores:")
print(f"{'Ticker':<10} {'Score':<10}")
print("-" * 20)
for row in cursor.fetchall():
    print(f"{row[0]:<10} {row[1]:<10.2f}")
conn.close()
EOF
```

**Expected Output:**
```
Top 10 Smart Money Scores:
Ticker     Score     
--------------------
NVDA       79.50     
TSLA       77.25     
AAPL       72.50     
META       69.10     
MSFT       68.30     
NFLX       64.20     
GOOGL      61.20     
COST       58.90     
AMD        57.80     
QCOM       56.50     
```

---

## ✅ Success Criteria

- ✓ Command 2: Connects to database with 93 tickers
- ✓ Command 3: Shows 600+ total records across 5 tables
- ✓ Command 4: All 3 tests pass
- ✓ Command 5: Top 10 scores displayed (0-100 range)

**If all pass: Pipeline is working! 🎉**

---

## Credentials Reference

```
Host:     35.192.68.127
Port:     5432
Database: smart_money
User:     pipeline_user
Password: PipelinePassP2024Secure
```

See `CLOUD_CREDENTIALS.md` for more details.
