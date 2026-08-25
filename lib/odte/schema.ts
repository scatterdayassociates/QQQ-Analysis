// Executable copy of migrations/001_odte_schema.sql, embedded as a string so it
// survives Vercel's serverless bundling (reading .sql files off disk from a
// bundled route is unreliable without output-tracing config). If you edit the
// DDL, edit BOTH files — this one is what /api/odte/migrate actually runs, the
// .sql file is the human-readable canonical copy for manual psql use.
//
// Every statement is idempotent (IF NOT EXISTS) so re-running is always safe.

export const ODTE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS odte_sessions (
    session_id        BIGSERIAL PRIMARY KEY,
    trade_date        DATE NOT NULL,
    underlying        TEXT NOT NULL DEFAULT 'QQQ',
    spot_open         NUMERIC(12,4),
    spot_close        NUMERIC(12,4),
    implied_move_open NUMERIC(10,6),
    realized_move     NUMERIC(10,6),
    im_percentile     NUMERIC(5,2),
    or_range          NUMERIC(10,6),
    gex_open          NUMERIC(20,2),
    regime            TEXT,
    iv_term_ratio     NUMERIC(8,4),
    catalyst          TEXT,
    gate_final_state  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (trade_date, underlying)
);

CREATE TABLE IF NOT EXISTS odte_chain_snapshots (
    snapshot_id   BIGSERIAL PRIMARY KEY,
    session_id    BIGINT REFERENCES odte_sessions(session_id),
    ts            TIMESTAMPTZ NOT NULL,
    api_ts        TIMESTAMPTZ,
    contract      TEXT NOT NULL,
    side          CHAR(1) NOT NULL,
    strike        NUMERIC(12,4) NOT NULL,
    bid           NUMERIC(10,4),
    ask           NUMERIC(10,4),
    mid           NUMERIC(10,4),
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

CREATE TABLE IF NOT EXISTS odte_im_series (
    point_id      BIGSERIAL PRIMARY KEY,
    session_id    BIGINT REFERENCES odte_sessions(session_id),
    ts            TIMESTAMPTZ NOT NULL,
    et_time       TEXT NOT NULL,
    spot          NUMERIC(12,4),
    im_remaining  NUMERIC(10,6),
    cem_remaining NUMERIC(10,6),
    cheapness     NUMERIC(10,4),
    iv_term_ratio NUMERIC(8,4),
    gex_total     NUMERIC(20,2)
);
CREATE INDEX IF NOT EXISTS idx_im_series_session ON odte_im_series (session_id, ts);

CREATE TABLE IF NOT EXISTS odte_contract_metrics (
    metric_id        BIGSERIAL PRIMARY KEY,
    session_id       BIGINT REFERENCES odte_sessions(session_id),
    ts               TIMESTAMPTZ NOT NULL,
    contract         TEXT NOT NULL,
    gamma_per_dollar NUMERIC(12,6),
    breakeven_move   NUMERIC(10,6),
    theta_cost_ratio NUMERIC(10,6),
    vega_pct_prem    NUMERIC(10,6),
    spread_pct       NUMERIC(10,6),
    cvs              NUMERIC(10,4),
    rank_in_band     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_metrics_session_ts ON odte_contract_metrics (session_id, ts);

CREATE TABLE IF NOT EXISTS odte_gate_events (
    gate_id     BIGSERIAL PRIMARY KEY,
    session_id  BIGINT REFERENCES odte_sessions(session_id),
    ts          TIMESTAMPTZ NOT NULL,
    state       TEXT NOT NULL,
    conditions  JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gate_session_ts ON odte_gate_events (session_id, ts);

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

CREATE TABLE IF NOT EXISTS odte_kv (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
