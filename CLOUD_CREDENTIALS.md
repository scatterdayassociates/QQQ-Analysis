# Cloud SQL Credentials

**Instance**: qqq-analysis-db  
**Region**: us-central1  
**Type**: PostgreSQL 14.23

---

## Connection Details

| Parameter | Value |
|-----------|-------|
| **Host** | 35.192.68.127 |
| **Port** | 5432 |
| **Database** | smart_money |
| **User** | pipeline_user |
| **Password** | PipelinePassP2024Secure |
| **SSL Mode** | require |

---

## Quick Copy-Paste Setup

```bash
export DATABASE_HOST=35.192.68.127
export DATABASE_PORT=5432
export DATABASE_NAME=smart_money
export DATABASE_USER=pipeline_user
export DATABASE_PASSWORD='PipelinePassP2024Secure'
export DATABASE_SSL_MODE=require
```

---

## Connection Test

```bash
python -c "
import psycopg2
conn = psycopg2.connect(
    host='35.192.68.127',
    port=5432,
    database='smart_money',
    user='pipeline_user',
    password='PipelinePassP2024Secure',
    sslmode='require'
)
cursor = conn.cursor()
cursor.execute('SELECT COUNT(*) FROM ticker_to_cik')
print(f'✓ Connected! {cursor.fetchone()[0]} tickers found')
conn.close()
"
```

---

## gcloud Commands

```bash
# Connect to database via gcloud
gcloud sql connect qqq-analysis-db --user=pipeline_user

# List users
gcloud sql users list --instance=qqq-analysis-db

# Describe instance
gcloud sql instances describe qqq-analysis-db

# Get public IP
gcloud sql instances describe qqq-analysis-db --format="value(ipAddresses[0].ipAddress)"
```

---

## Usage in Code

**Python:**
```python
import psycopg2

conn = psycopg2.connect(
    host='35.192.68.127',
    port=5432,
    database='smart_money',
    user='pipeline_user',
    password='PipelinePassP2024Secure',
    sslmode='require'
)
```

**Environment Variables:**
```bash
DATABASE_HOST=35.192.68.127
DATABASE_PORT=5432
DATABASE_NAME=smart_money
DATABASE_USER=pipeline_user
DATABASE_PASSWORD=PipelinePassP2024Secure
DATABASE_SSL_MODE=require
```

---

## Security Notes

⚠️ **Keep password secure**
- Don't commit to git
- Use environment variables in production
- Rotate password regularly
- Restrict firewall access

📝 **Firewall Settings**
- Current: Allows from any IP (0.0.0.0/0)
- Recommendation: Whitelist specific IPs only

---

## Next Steps

1. Copy connection details above
2. Set environment variables
3. Test connection
4. Run Cloud Function tests

See `CLOUD_SHELL_TESTING_STEPS.md` for full testing guide.
