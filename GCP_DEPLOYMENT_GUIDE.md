# GCP Cloud Functions Deployment Guide

Smart Money Pipeline on Google Cloud Platform using Cloud Functions + Cloud Scheduler.

---

## Architecture Overview

```
Cloud Scheduler (2 AM UTC Daily)
    ↓ HTTPS POST /run_pipeline
Cloud Function (Python 3.11)
    ├─ Form 4 Ingestor
    ├─ 13D Filings Ingestor
    ├─ COT Positions Ingestor
    ├─ Short Interest Ingestor
    └─ 13F Holdings Ingestor
    ↓ Database Connection
Cloud SQL (PostgreSQL 14)
    └─ qqq_analysis database
```

---

## Step 1: Create Cloud SQL PostgreSQL Instance

### 1.1 Create the instance

```bash
gcloud sql instances create qqq-analysis-db \
    --database-version=POSTGRES_14 \
    --tier=db-f1-micro \
    --region=us-central1 \
    --availability-type=REGIONAL \
    --backup-start-time=02:00 \
    --enable-bin-log
```

### 1.2 Create the database

```bash
gcloud sql databases create qqq_analysis \
    --instance=qqq-analysis-db
```

### 1.3 Create database user

```bash
gcloud sql users create pipeline_user \
    --instance=qqq-analysis-db \
    --password=STRONG_PASSWORD_HERE
```

Keep this password for environment variables later.

### 1.4 Get the connection details

```bash
gcloud sql instances describe qqq-analysis-db \
    --format="value(ipAddresses[0].ipAddress)"
```

Note the **public IP address** - you'll need it for connection strings.

### 1.5 Create tables in Cloud SQL

Use the SQL from `/home/user/QQQ-Analysis/db_schema.sql`:

```bash
gcloud sql connect qqq-analysis-db \
    --user=postgres
```

Then paste the SQL from `db_schema.sql` to create all tables.

Alternatively, use Cloud SQL Editor in the GCP Console to paste the SQL.

---

## Step 2: Create Cloud Function

### 2.1 Prerequisites

```bash
# Set your GCP project
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
gcloud services enable sqladmin.googleapis.com
```

### 2.2 Create the Cloud Function

```bash
gcloud functions deploy run-pipeline \
    --gen2 \
    --runtime=python311 \
    --region=us-central1 \
    --source=/path/to/QQQ-Analysis \
    --entry-point=run_pipeline \
    --trigger-http \
    --allow-unauthenticated \
    --memory=512MB \
    --timeout=540 \
    --set-env-vars=DATABASE_HOST=CLOUD_SQL_IP,DATABASE_PORT=5432,DATABASE_NAME=qqq_analysis,DATABASE_USER=pipeline_user,DATABASE_PASSWORD=YOUR_PASSWORD,DATABASE_SSLMODE=require,SEC_USER_AGENT=SmartMoneyPipeline david@scatterdayassociates.com,SEC_RATE_LIMIT=2,LOG_LEVEL=INFO
```

**Key parameters:**
- `--gen2`: Use Cloud Functions 2nd gen (better performance)
- `--runtime=python311`: Python 3.11
- `--entry-point=run_pipeline`: Function name in `cloud_function_main.py`
- `--trigger-http`: Callable via HTTP (needed for Cloud Scheduler)
- `--allow-unauthenticated`: Allow Cloud Scheduler to call it
- `--memory=512MB`: Sufficient for pipeline work
- `--timeout=540`: 9 minutes (some ingestors are slow)

### 2.3 Verify the deployment

```bash
gcloud functions describe run-pipeline --gen2 --region=us-central1
```

You'll see the **trigger URL**. Save it - you'll need it for Cloud Scheduler.

---

## Step 3: Create Cloud Scheduler Job

### 3.1 Enable Cloud Scheduler

```bash
gcloud services enable cloudscheduler.googleapis.com
```

### 3.2 Create the scheduled job

```bash
gcloud scheduler jobs create http run-pipeline-daily \
    --location=us-central1 \
    --schedule="0 2 * * *" \
    --uri=CLOUD_FUNCTION_TRIGGER_URL \
    --http-method=POST \
    --message-body="{}" \
    --oidc-service-account-email=cloud-functions@YOUR_PROJECT_ID.iam.gserviceaccount.com \
    --time-zone=UTC
```

**Parameters:**
- `--schedule="0 2 * * *"`: 2 AM UTC daily (cron format)
- `--uri`: The trigger URL from Cloud Function
- `--oidc-service-account-email`: Uses default Cloud Functions service account

### 3.3 Test the scheduler job

```bash
gcloud scheduler jobs run run-pipeline-daily --location=us-central1
```

Monitor the Cloud Function logs to see it execute.

---

## Step 4: Monitor Execution

### 4.1 View Cloud Function logs

```bash
gcloud functions logs read run-pipeline \
    --gen2 \
    --region=us-central1 \
    --limit=50
```

Or use Cloud Console:
```
Cloud Functions → run-pipeline → Logs
```

### 4.2 View Cloud Scheduler execution

```bash
Cloud Console → Cloud Scheduler → run-pipeline-daily → Execution history
```

### 4.3 Query results in Cloud SQL

```bash
gcloud sql connect qqq-analysis-db --user=pipeline_user

# Check latest scores
SELECT ticker, as_of_date, composite_score 
FROM scores 
ORDER BY as_of_date DESC 
LIMIT 20;
```

---

## Step 5: Connect Frontend to Live Backend (Optional)

If you want the Vercel frontend to display live scores:

### 5.1 Create a Cloud Run API (Optional)

To serve the dashboard from the scores in the database:

```bash
gcloud run deploy qqq-api \
    --source=/path/to/QQQ-Analysis \
    --entry-point=app \
    --runtime=python311 \
    --memory=512MB \
    --region=us-central1 \
    --allow-unauthenticated
```

Then set `BACKEND_API_URL` in Vercel to the Cloud Run URL.

---

## Environment Variables Reference

| Variable | Value | Example |
|----------|-------|---------|
| `DATABASE_HOST` | Cloud SQL IP | `35.192.xxx.xxx` |
| `DATABASE_PORT` | PostgreSQL port | `5432` |
| `DATABASE_NAME` | Database name | `qqq_analysis` |
| `DATABASE_USER` | DB user | `pipeline_user` |
| `DATABASE_PASSWORD` | DB password | *(generate strong)* |
| `DATABASE_SSLMODE` | SSL mode | `require` |
| `SEC_USER_AGENT` | User agent | `SmartMoneyPipeline david@scatterdayassociates.com` |
| `SEC_RATE_LIMIT` | Rate limit | `2` |
| `LOG_LEVEL` | Log level | `INFO` |

---

## Cost Estimate

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Cloud Function | ~1,440 invocations/month (daily) | $0.40 |
| Cloud Scheduler | 1 job, 30 executions/month | $0.10 |
| Cloud SQL | db-f1-micro (0.6GB, shared) | $10-15 |
| Storage | ~50GB data per month | $1 |
| **Total** | | **~$11-16/month** |

---

## Troubleshooting

### Cloud Function fails with "ModuleNotFoundError"

**Solution:** Ensure `cloud-function-requirements.txt` is in the source directory and all imports are listed.

### Database connection times out

**Solution:** Check Cloud SQL instance is configured to allow public IP access. Go to Cloud SQL → Connections → Public IP.

### Scheduler job never runs

**Solution:** 
1. Check Cloud Scheduler job status in console
2. Verify service account has permission to invoke Cloud Function
3. Check Cloud Function URL is correct

### Scores not updating in database

**Solution:**
1. Check Cloud Function logs for errors
2. Verify database credentials are correct
3. Test database connection manually

---

## Next Steps

1. ✅ Create Cloud SQL instance
2. ✅ Create Cloud Function
3. ✅ Create Cloud Scheduler job
4. ✅ Test execution
5. (Optional) Create Cloud Run API
6. (Optional) Connect Vercel frontend

---

## Useful Commands

```bash
# Monitor all executions
gcloud scheduler jobs run run-pipeline-daily --location=us-central1

# View function logs in real-time
gcloud alpha functions logs read run-pipeline --gen2 --region=us-central1 --follow

# Update function code
gcloud functions deploy run-pipeline --gen2 --region=us-central1 --source=/path

# Delete everything when done
gcloud sql instances delete qqq-analysis-db
gcloud functions delete run-pipeline --gen2 --region=us-central1
gcloud scheduler jobs delete run-pipeline-daily --location=us-central1
```

---

## Architecture Advantages

✅ **Separated concerns**: Pipeline runs independently from API  
✅ **Cost-effective**: Pay only for execution time (~$0.40/month)  
✅ **Highly reliable**: Google-managed scheduling with 99.95% uptime  
✅ **Auto-scaling**: Handles load automatically  
✅ **Better monitoring**: Cloud Logging integration  
✅ **No cold start delays**: Cloud Scheduler waits for function to be ready  

---

Let me know if you need help with any step!
