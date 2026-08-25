-- 0DTE Convexity Scanner schema (Postgres 14, GCP Cloud SQL instance qqq-analysis-db,
-- database "smart_money" — same database the Smart Money pipeline uses, tables are
-- namespaced with the odte_ prefix so the two features never collide).
--
-- This file is the human-readable canonical copy of the DDL. The copy that actually
-- executes lives in lib/odte/schema.ts (embedded string, so it survives Vercel's
-- serverless bundling) — keep the two in sync if you edit either.
--
-- Apply either by hitting GET /api/odte/migrate?secret=<CRON_SECRET> once after deploy,
-- or manually:
--   psql "postgresql://pipeline_user:<PASSWORD>@35.192.68.127:5432/smart_money?sslmode=require" \
--        -f migrations/001_odte_schema.sql
--
-- Every statement is idempotent (IF NOT EXISTS) so re-running is always safe.

-- One row per trading session per underlying (v1: QQQ only)
CREATE TABLE IF NOT EXISTS odte_sessions (
    session_id        BIGSERIAL PRIMARY KEY,
    trade_date        DATE NOT NULL,
    underlying        TEXT NOT NULL DEFAULT 'QQQ',
    spot_open         NUMERIC(12,4),
    spot_close        NUMERIC(12,4),
    implied_move_open NUMERIC(10,6),             -- ATM straddle IM at first post-open snapshot, % of spot
    realized_move     NUMERIC(10,6),             -- (high-low)/spot_open, filled EOD
    im_percentile     NUMERIC(5,2),              -- IM vs trailing sessions recorded in this table
    or_range          NUMERIC(10,6),             -- (high-low of first 30 min)/spot_open, fixed ~10:15 under T-15
    gex_open          NUMERIC(20,2),             -- dealer gamma exposure ($ per 1% move) at first compute
    regime            TEXT,                      -- from yield curve classifier (TBill tab)
    iv_term_ratio     NUMERIC(8,4),              -- ATM_IV_0DTE / ATM_IV_~7DTE at open (chain-derived)
    catalyst          TEXT,                      -- 'FOMC','CPI','NFP','OPEX', NULL
    gate_final_state  TEXT,                      -- 'TRADE','NO_TRADE' (state when session closed)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (trade_date, underlying)
);

-- Thin chain snapshots: only the candidate band + ATM straddle legs each pass.
-- NOTE (v1 data reality): Massive's option-chain snapshot has NO bid/ask fields —
-- confirmed against the live API. bid/ask stay nullable for a possible v2 WebSocket
-- feed; `mid` in v1 holds day.close (last trade, T-15) as the indicative premium.
CREATE TABLE IF NOT EXISTS odte_chain_snapshots (
    snapshot_id   BIGSERIAL PRIMARY KEY,
    session_id    BIGINT REFERENCES odte_sessions(session_id),
    ts            TIMESTAMPTZ NOT NULL,          -- pass evaluation time (server clock)
    api_ts        TIMESTAMPTZ,                   -- API's own last_updated for the contract, when provided
    contract      TEXT NOT NULL,                 -- OCC symbol
    side          CHAR(1) NOT NULL,              -- 'C'/'P'
    strike        NUMERIC(12,4) NOT NULL,
    bid           NUMERIC(10,4),                 -- always NULL in v1 (not in snapshot payload)
    ask           NUMERIC(10,4),                 -- always NULL in v1
    mid           NUMERIC(10,4),                 -- v1: day.close — indicative last trade, T-15
    iv            NUMERIC(10,6),
    delta         NUMERIC(8,6),
    gamma         NUMERIC(10,8),
    theta         NUMERIC(10,6),
    vega          NUMERIC(10,6),
    volume        INTEGER,
    open_interest INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snap_session_ts ON odte_chain_snapshots (session_id, ts);
CREATE INDEX IF NOT EXISTS idx_snap_contract   ON odte_chain_snapshots (contract, ts);

-- IM vs CEM series — one row per tick pass, powers the convergence panel
CREATE TABLE IF NOT EXISTS odte_im_series (
    point_id      BIGSERIAL PRIMARY KEY,
    session_id    BIGINT REFERENCES odte_sessions(session_id),
    ts            TIMESTAMPTZ NOT NULL,
    et_time       TEXT NOT NULL,                 -- "HH:MM" ET, denormalized for charting
    spot          NUMERIC(12,4),
    im_remaining  NUMERIC(10,6),
    cem_remaining NUMERIC(10,6),
    cheapness     NUMERIC(10,4),
    iv_term_ratio NUMERIC(8,4),
    gex_total     NUMERIC(20,2)
);
CREATE INDEX IF NOT EXISTS idx_im_series_session ON odte_im_series (session_id, ts);

-- Computed per-contract metrics at each evaluation pass (populated in Phase 2)
CREATE TABLE IF NOT EXISTS odte_contract_metrics (
    metric_id        BIGSERIAL PRIMARY KEY,
    session_id       BIGINT REFERENCES odte_sessions(session_id),
    ts               TIMESTAMPTZ NOT NULL,
    contract         TEXT NOT NULL,
    gamma_per_dollar NUMERIC(12,6),
    breakeven_move   NUMERIC(10,6),
    theta_cost_ratio NUMERIC(10,6),
    vega_pct_prem    NUMERIC(10,6),
    spread_pct       NUMERIC(10,6),              -- NULL in v1 (no bid/ask in feed)
    cvs              NUMERIC(10,4),
    rank_in_band     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_metrics_session_ts ON odte_contract_metrics (session_id, ts);

-- Gate evaluations: audit trail for why the tab said TRADE or NO_TRADE
CREATE TABLE IF NOT EXISTS odte_gate_events (
    gate_id     BIGSERIAL PRIMARY KEY,
    session_id  BIGINT REFERENCES odte_sessions(session_id),
    ts          TIMESTAMPTZ NOT NULL,
    state       TEXT NOT NULL,                   -- 'TRADE','NO_TRADE'
    conditions  JSONB NOT NULL                   -- [{id, name, value, threshold, pass, note}]
);
CREATE INDEX IF NOT EXISTS idx_gate_session_ts ON odte_gate_events (session_id, ts);

-- EV ledger: every surfaced candidate, tracked to close (populated in Phase 2/3)
CREATE TABLE IF NOT EXISTS odte_ev_ledger (
    entry_id       BIGSERIAL PRIMARY KEY,
    session_id     BIGINT REFERENCES odte_sessions(session_id),
    contract       TEXT NOT NULL,
    surfaced_ts    TIMESTAMPTZ NOT NULL,
    surfaced_mid   NUMERIC(10,4),
    cvs_at_surface NUMERIC(10,4),
    max_mid_after  NUMERIC(10,4),
    close_value    NUMERIC(10,4),
    hypo_return    NUMERIC(10,4),
    traded         BOOLEAN DEFAULT FALSE,
    realized_pnl   NUMERIC(12,2)
);

-- Key/value hot state — stands in for Vercel KV (session meta, EF table, cadence
-- markers). Postgres round-trips are fine at a 2-minute cadence.
CREATE TABLE IF NOT EXISTS odte_kv (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
