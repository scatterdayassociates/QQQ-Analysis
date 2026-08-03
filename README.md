# QQQ / TQQQ Dashboard

A lightweight Next.js dashboard with five tabs:

1. **Intraday Daypart** — QQQ/TQQQ intraday volume in 15-minute buckets across the regular
   session (9:30 AM–4:00 PM ET), with a realized-volatility proxy plotted alongside, plus an
   Overnight Gap sub-view (close-to-open moves, ranked and tagged against catalysts).
2. **Fundamental Analysis** — a 7-metric market strength/tactical model (macro, trend, credit,
   breadth, volatility) with a plain-English explanation of each metric.
3. **Catalyst Tracker** — the top 10 Nasdaq-100 components, their historical 1-day reactions to
   macro catalysts and their own earnings, and an upcoming-catalyst calendar.
4. **AI Earnings Analysis** — an AI-capex buyer fragility screen across a small tiered universe
   (Alphabet, Microsoft, Meta, Amazon, Oracle, CoreWeave), scoring whether each is still funding
   infrastructure spend from operating cash flow or increasingly from debt/equity issuance.
5. **T10Y2Y Regime** — classifies the 10Y-2Y Treasury yield curve on two independent axes: Regime
   (growth vs. term-premium steepening, bull vs. bear flattening — driven by recent change) and
   Level (inverted/flat/normal/steep — driven by today's absolute spread), tracks each Regime as a
   historical episode, and overlays QQQ/TQQQ price action against the timeline.

Powered by the [Massive](https://massive.com) (formerly Polygon.io) market data API, plus
free public [FRED](https://fred.stlouisfed.org) series for a couple of macro inputs (see below).
The T10Y2Y Regime tab additionally requires a MySQL database — see its own section below; every
other tab computes its data on demand and needs no database.

## Tab 1: Intraday Daypart

- **Volume** comes from the **Custom Bars** endpoint (`/v2/aggs/ticker/{ticker}/range/...`),
  requested as 15-minute intraday bars for the selected date, for both QQQ and TQQQ.
- **Volatility proxy** uses the Parkinson range estimator — computed from each 15-minute
  QQQ bar's own high/low and annualized to a percentage — as a stand-in for implied
  volatility. True IV belongs to individual option contracts (strike + expiry), not the
  underlying ticker, and a market index like VIX is billed as its own separate Indices
  subscription on Massive/Polygon; this proxy needs neither, since it's derived entirely
  from the QQQ bar data already being fetched for volume. It's *realized* (backward-looking,
  from price ranges), not *implied* (forward-looking, from option prices) volatility.
- **Date/time filters** let you pick any trading day and narrow the window within market hours.
- **Compare up to 5 dates at once** — the **+ Add date range** button appends another
  independent chart/table block (its own date, time range, and fetch) stacked below the
  current one, so you can eyeball, say, an earnings day against a normal day side by side.
- A sub-nav inside this tab switches to the **Overnight Gap** view (see below) — same tab,
  additive, doesn't touch the volume/volatility view above.

### Overnight Gap (inside Intraday Daypart)

- **Definition**: for trading day D, overnight gap % = `(Open[D] − Close[D-1]) / Close[D-1]`,
  where `Close[D-1]` is the prior trading day's 4:00 PM ET regular-session close and `Open[D]`
  is day D's 9:30 AM ET regular-session open — both read from Massive's daily Custom Bars.
  Confirmed live against Massive's dedicated Daily Open/Close endpoint (which separately labels
  `preMarket`/`afterHours`) that the daily aggregate's own `o`/`c` fields are already these exact
  regular-session values, not extended-hours prints — no separate endpoint call needed. This is
  deliberately **not** the regular-session (open-to-close) move.
- Covers **QQQ, TQQQ, and the same top-10 Nasdaq-100 components** used on Catalyst Tracker, over
  the same ~240-day lookback.
- **Catalyst tags**: FOMC/CPI/NFP dates reuse the same hardcoded macro calendar as Catalyst
  Tracker. Earnings tags come from Finnhub's free-tier Earnings Calendar, matched only when a
  report was after-market-close the prior day or before-market-open the gap day (reports during
  market hours, or with unlisted timing, aren't tagged — they don't map cleanly to an overnight
  window). **Finnhub's free tier silently truncates historical depth** to roughly the trailing
  month regardless of the date range requested — verified live — so Earnings tags on Overnight
  Gap only appear for recent dates; the UI discloses the actual cutoff it observed. FOMC/CPI/NFP
  tags aren't affected, since that calendar is hardcoded.
- Pairs spanning an unusually long calendar gap between two consecutive bars (a possible trading
  halt or data gap, not a routine weekend/holiday) are flagged (⚠) rather than silently averaged
  in — they're excluded from the weekday/catalyst summary stats but still shown in the ranked list.
- **Ranked table**: sortable by date, ticker, or gap %, defaulting to largest positive gap at
  top. **Weekday/catalyst summary**: average and max |gap %| grouped by weekday and dominant
  catalyst type. **Calendar picker**: click individual dates or shift-click to select a range;
  catalyst-tagged dates show a dot. Both the ranked table and summary scope to the current
  ticker filter and date selection.

## Tab 2: Fundamental Analysis

Replicates a 7-metric strength-scoring model (yield curve, 200-day trend, credit ratio,
sector breadth, VIX z-score, RSI-14, and a DeMark-style exhaustion count), plus the tactical
"NO TRADE / SELL PREMIUM / WAIT" decision and suggested allocation those metrics combine into.
Each metric is shown as its own card with a plain-English explanation of what it measures and
why it's weighted the way it is.

Two data-source substitutions versus the original model, both to avoid requiring another paid
subscription tier:

- **VIX** → FRED's `VIXCLS` series (daily CBOE VIX close), instead of Massive's `I:VIX` (which
  is billed under the separate Indices product line, not included in a Stocks plan).
- **U.S. Dollar Index** → FRED's `DTWEXBGS` (Nominal Broad U.S. Dollar Index), instead of
  Massive's `DX-Y.NYB` (same Indices-tier issue). This is a different (broader, trade-weighted)
  dollar index than the original ICE DXY, so treat it as a close proxy, not an identical series.
- The yield curve uses FRED's `T10Y2Y` series, same as the source model.

The source model's hardcoded "Red Folder" economic-event calendar (static Jan-2025 sample
dates) is **not** reproduced — it wasn't a live feed in the original either, and there's no
data source wired up here to keep one current.

## Tab 3: Catalyst Tracker

Replicates the intent of the source "Catalyst100" app: a top-10 Nasdaq-100 components table
(price, change, volume, market cap), a historical 1-day reactions table (how each of those 10
tickers actually moved close-to-close around past macro events *and* their own historical
earnings dates), and an upcoming-catalysts calendar.

- The **top-10 list** (NVDA, AAPL, MSFT, AMZN, GOOGL, AVGO, META, TSLA, MU, AMD) is a fixed
  snapshot of Nasdaq-100/QQQ weightings as of mid-2026 — QQQ's weights drift with price and the
  index rebalances quarterly, so this is "as of," not a live, continuously-rebalanced ranking.
  Re-verify periodically against Invesco's live QQQ holdings page.
- **Reactions are real, computed values** — the close price the trading day before each
  event/report vs. the close on the event/report day itself, from Massive's Custom Bars, not
  fabricated numbers. Covers Jan 2026–present.
- The **macro calendar** (FOMC rate decisions, CPI releases, jobs reports) is hardcoded from the
  Federal Reserve's and BLS's published 2026 schedules — real, verified dates, not the source
  app's placeholder-style calendar.
- **Market cap** is attempted via Massive's Ticker Details (reference) endpoint and shows "—" if
  unavailable on the current plan, rather than failing the whole table.
- **EV/EBITDA** (Enterprise Value ÷ EBITDA) comes from Alpha Vantage's `OVERVIEW` endpoint — one
  request per ticker (10 total, no bulk mode), cached 1 hour. Shows "—" when EBITDA is negative or
  unavailable. Chosen over P/E (which this column showed originally) since it accounts for each
  company's debt/cash and isn't distorted by differences in depreciation or capital structure,
  making it more comparable across the ten names here — the column header carries the same
  definition as a hover tooltip.
- **Upcoming earnings** for each top-10 ticker come from [Alpha Vantage's](https://www.alphavantage.co)
  free `EARNINGS_CALENDAR` endpoint — officially documented, free-tier accessible, returns CSV
  (not JSON, unlike most Alpha Vantage endpoints). Requires a free account and an
  `ALPHA_VANTAGE_API_KEY` (see setup below); without one, Upcoming Catalysts just won't show
  Earnings rows, everything else keeps working. Fetched once per load for the whole market (no
  per-ticker calls) and filtered down to the top 10 here.
  Three alternatives were tried and rejected or superseded first: Massive's own Benzinga earnings
  endpoint (`NOT_AUTHORIZED` on this account's plan, and a paid $99/mo add-on regardless — see
  [massive.com/partners/benzinga](https://massive.com/partners/benzinga)), Yahoo Finance's public
  `quoteSummary` endpoint (requires a session cookie + anti-bot "crumb" token), and Finnhub's
  free-tier calendar (confirmed live to have real coverage gaps for several top-10 tickers'
  current-quarter dates, e.g. GOOGL/TSLA/MSFT/META missing for a window where AAPL/AMZN were
  present) — see git history for all three. Finnhub is still used elsewhere, for the Overnight
  Gap view's historical earnings tags (see below), since Alpha Vantage's calendar has no
  historical mode and no before-open/after-close timing field.
- **Historical reactions cover macro events (FOMC/CPI/jobs reports) and each top-10 ticker's own
  historical earnings dates.** Earnings reaction dates come from Alpha Vantage's `EARNINGS`
  endpoint — a *different* endpoint from `EARNINGS_CALENDAR` above, since only this one carries
  genuine multi-year historical `reportedDate` values. Unlike `EARNINGS_CALENDAR`, it has no
  bulk/all-companies mode — one request per ticker, so populating all 10 costs 10 calls against
  the free tier's daily quota, not 1. Cached for 6 hours (vs. 1 hour for the single-call
  endpoint) to limit repeat spend. Neither Alpha Vantage endpoint distinguishes before-open vs.
  after-close timing, so earnings reactions are close-to-close over the report day itself, same
  as the macro rows. Benzinga (`NOT_AUTHORIZED`, $99/mo add-on) and Finnhub (free-tier historical
  depth only reaches ~1 month back, confirmed live) were both considered and ruled out for this
  specific "Jan 2026–present" need — Finnhub is still used for Overnight Gap's historical earnings
  tags (see its own section below), where a ~1-month window is less of a gap and the
  before-open/after-close distinction actually matters.

## Tab 4: AI Earnings Analysis

An AI-capex buyer fragility screen, ported from an uploaded reference implementation (a Python
CLI script with a synthetic-data-validated scoring model). Thesis: capex *level* isn't the
signal — funding *source* is. Screens a fixed, tiered universe on whether they're still funding
infrastructure spend from operating cash flow or increasingly from debt/equity issuance.

- **Universe**: Alphabet, Microsoft, Meta, Amazon (Tier 1 — hyperscalers funding capex mostly
  from operations, so far), Oracle (Tier 2 — leveraged buyer increasingly using debt/equity
  issuance), CoreWeave (Tier 3 — highest-beta/credit-risk name most exposed if the cycle
  cracks), SK Hynix (`SKHY`), Micron (`MU`), Sandisk (`SNDK`) (Tier 4 — "Memory Makers," the
  AI-capex memory/storage *suppliers* rather than buyers; a related but distinct cohort from
  Tiers 1-3, same fragility metrics computed the same way). This is a separate, purpose-built
  universe from Catalyst Tracker's top-10 list, not a subset of it. All four tiers share one
  cross-sectional Fragility Score — z-scores are computed across the whole universe together, not
  per tier, so adding Tier 4 shifts the comparison baseline for every ticker.
- **Metrics** (all computed from real quarterly statement data, not fabricated): capex coverage
  ratio (OCF ÷ capex, latest quarter), capex-to-revenue and financing dependency (debt+equity
  issued ÷ capex, both trailing 4-quarter averages so a single one-off raise doesn't outrank a
  name that's been persistently externally-funding capex for years), coverage trend (YoY
  direction), buyback Δ YoY (a cut is often the first lever pulled before touching capex), and a
  composite **Fragility Score** — a cross-sectional z-scored blend of all four, self-calibrating
  as tickers are added (no hardcoded thresholds).
- **EV/EBITDA** comes from Alpha Vantage's `OVERVIEW` endpoint, one request per ticker, cached 1
  hour, same endpoint (and same field) as Catalyst Tracker's EV/EBITDA column. Capital-structure-
  neutral valuation reference alongside the fragility metrics, not itself part of the Fragility
  Score — previously this column showed trailing P/E, swapped out per request. Shows "—" when
  EBITDA is negative or unavailable.
- **Latest Qtr** is displayed as `MM/DD/YYYY`.
- **Data source**: Alpha Vantage's `CASH_FLOW` and `INCOME_STATEMENT` endpoints (same
  `ALPHA_VANTAGE_API_KEY` already used elsewhere — no new key needed). Unlike everything else in
  this app, these have no bulk mode: **2 requests per ticker, 18 total per load (27 with
  EV/EBITDA)** — the most expensive external call in the app by request count. Fundamentals cached
  24 hours (`revalidate: 86400`) since they only change 4x/year; EV/EBITDA cached 1 hour. Every
  ticker in the universe always gets a row in the table — previously a rate-limited or missing
  fetch dropped that ticker's row entirely, which made the row count swing unpredictably (1, 2, 5
  tickers...) load to load purely based on which of the concurrent Alpha Vantage requests happened
  to clear the rate limit; now a failed fetch just leaves that ticker's affected columns as "—",
  so the table is always exactly 9 rows. Check the "Fetch diagnostics" disclosure under the table
  (or Vercel logs for `[ai-earnings]` lines) to see exactly which tickers/fetches failed and why.
- **Options Richness** (optional, computed only when an expiration date is entered in the tab):
  compares the options market's *implied* move into a given expiration against each ticker's own
  trailing *realized* earnings-day moves. **Implied Move** = ATM straddle price ÷ spot, from
  Massive's Options Chain Snapshot (`/v3/snapshot/options/{ticker}`) — this requires a separate
  Massive **Options** product subscription from the Stocks data the rest of this app uses, now
  confirmed live. The live response has no `last_quote`/bid-ask field at all; `day.close` (last
  traded price) is the only price used for each contract. **Avg Realized |Move|** = average
  absolute close-to-close move over the ticker's trailing 12 quarters of earnings report dates
  (Alpha Vantage `EARNINGS` + Massive daily bars, same pattern as Catalyst Tracker's historical
  reactions). **Richness** = Implied Move ÷ Avg Realized |Move| — above 1.0x means the market is
  pricing in a bigger move than history suggests. Adds up to 1 options-snapshot request + 1
  Alpha Vantage `EARNINGS` request per ticker (6 more of each per load) only when an expiration is
  supplied; omitting it skips this section and its extra calls entirely.

No charting library, no CSS framework — just React, plain CSS, and hand-rolled SVG (a combo
chart for volume + volatility, and a semicircle gauge for aggregate strength), to keep the
bundle small.

## Tab 5: T10Y2Y Regime Classification

Classifies the 10Y-2Y Treasury spread on **two independent axes**, tracks contiguous Regime
episodes as historical "episodes," and overlays both against QQQ/TQQQ price action.

- **Regime (Momentum axis)**: seven states driven purely by the *change* in the spread over a
  trailing lookback window — spread widening (steepening) splits into **Growth Steepening** (2Y
  falling faster than 10Y — rate-cut expectations, typically NDX-supportive) vs. **Term Premium
  Steepening** (10Y rising faster — inflation/fiscal concerns, typically an NDX headwind); spread
  narrowing (flattening) splits into **Bull Flattening** (10Y falling faster — growth/recession
  fear, ambiguous for NDX) vs. **Bear Flattening** (2Y rising faster — Fed hiking, classic
  late-cycle tightening); moves that don't clearly fit either sub-case land in **Steepening
  (Mixed)** / **Flattening (Mixed)**; moves smaller than the threshold land in **Range-bound / No
  Signal**. Threshold and lookback default to 5bps change in the spread over 10 trading days
  (`REGIME_THRESHOLD_BPS` / `REGIME_LOOKBACK_DAYS`).
- **Level (absolute axis)**: a second, independent classification of *today's spread value in
  isolation* — **Deeply Inverted** (< -50bps), **Inverted** (-50 to 0bps), **Flat** (0-50bps),
  **Normal** (50-150bps), or **Steep** (150bps+), each boundary configurable
  (`REGIME_LEVEL_DEEP_INVERSION_BPS` / `REGIME_LEVEL_NORMAL_BPS` / `REGIME_LEVEL_STEEP_BPS`). Level
  never looks at recent change, so it doesn't get folded into or override the Regime label — an
  elevated Level alongside a Range-bound Regime is two true, independent facts about the curve
  ("where is it?" vs. "is it currently moving?"), not a contradiction. Shown as its own chip next
  to Regime everywhere in the tab (Current State, chart hover readout, daily detail table) rather
  than blended into a single score, so neither axis dilutes the other.
- Both axes get their own **Regime Definitions** reference tables (strict bps thresholds + which
  leg — 2Y or 10Y — has to dominate for Regime; strict bps cutoffs for Level), built dynamically
  from the live config values so they can't drift from what the server actually applies. The
  Current State card also shows the actual Δ Spread/Δ10Y/Δ2Y driving today's Regime classification
  alongside the levels, so neither label needs to be taken on faith.
- **Data source**: FRED's public `DGS10`/`DGS2` series (no API key, no rate limit) as the primary
  source — the same free, key-free convention this app already uses for VIX/USD-index proxies on
  the Fundamental Analysis tab, extended here to also capture each observation's date. A day only
  counts toward the regime calculation if both series have a real observation that day; weekends
  and the bond market's own holiday calendar (which differs slightly from the equity calendar) are
  excluded rather than forward-filled.
- **Backup data source**: if FRED's own latest observation is more than 24 hours old (a genuine
  outage/delay — not the routine weekend/holiday gap, which just resolves once FRED posts), each
  refresh also tries Alpha Vantage's `TREASURY_YIELD` endpoint (same `ALPHA_VANTAGE_API_KEY`
  already used elsewhere in this app) for whatever dates FRED hasn't covered yet. FRED stays
  authoritative for every date it does have; Alpha Vantage only ever supplements strictly newer
  dates and gets automatically superseded once FRED itself catches up (every refresh recomputes
  from scratch). Throttled to at most once every 6 hours even under the hourly cron, so an
  extended FRED outage can't burn through Alpha Vantage's free-tier quota and starve the other
  Alpha-Vantage-dependent tabs (Catalyst Tracker, AI Earnings Analysis). The Current State card's
  "Last refresh check" line distinguishes three outcomes so a silent no-op doesn't look identical
  to a broken key: the fallback supplied newer data and was used; the fallback ran but Alpha
  Vantage's own Treasury yield data had nothing newer than FRED either (a genuine data-availability
  gap on AV's side, not a config problem); or the fallback ran and failed (missing
  `ALPHA_VANTAGE_API_KEY`, an HTTP error, or AV's own rate limit — reported inline rather than only
  logged server-side). If FRED isn't yet 24h stale, or the 6h cooldown is still active, none of
  these fire and the line is simply omitted.
- **T10Y2Y cross-check.** Every refresh also fetches FRED's own pre-computed `T10Y2Y` series
  (non-fatal if it fails) purely to compare its latest date against `DGS10`/`DGS2`'s. FRED has
  been directly observed publishing `T10Y2Y` a day *ahead* of the individual `DGS10`/`DGS2` series
  it's computed from — confirmed by downloading FRED's own `DGS10`/`DGS2` CSV exports directly,
  which showed the same "one day behind T10Y2Y" gap this app did, ruling out any caching/fetch bug
  here. This is a FRED-side publish-ordering quirk between its component and derived series, not
  something fixable from the consuming side; the app can only fetch `DGS10`/`DGS2` (needed for
  leg-attribution — which of the two yields is driving a spread move) and wait for FRED to publish
  them. When the two disagree, the "Last refresh check" line says so explicitly instead of looking
  like stale data.
- **Persistence — the one tab in this app with a database.** Every other tab computes its data
  fresh on each request; this one is backed by MySQL because its episode table is derived by
  walking the *entire* yield history, which is too expensive to redo on every page load. See
  "T10Y2Y Regime database setup" below for the connection string and schema. Data is kept fresh
  automatically — every read checks whether the newest stored trading day is current and
  re-fetches/recomputes if not — so correctness never depends on the optional Vercel Cron job
  (`vercel.json`, hits `/api/yield-regime/refresh` **hourly**) actually firing; that cron just
  means new FRED data gets picked up within the hour without needing a page visit to trigger it,
  rather than being a requirement for correctness. Note that hourly polling only closes the gap
  between "FRED has published it" and "this app noticed" — it can't make FRED itself publish
  faster; DGS10/DGS2 both carry FRED's own ~1-business-day publication lag, so a same-day value
  showing up isn't guaranteed even with hourly checks. The tab's Current State card shows a "Last
  refresh check" line (newest FRED date seen, and any error) so a genuine staleness bug is visible
  without digging through Vercel logs. Backfill starts 2000-01-01 by default (covers QQQ's full
  trading history), overridable via `REGIME_BACKFILL_START` — FRED itself has `DGS10` data back to
  1962.
- **QQQ/TQQQ overlay**: QQQ's % change is precomputed per episode (via Massive's Custom Bars, same
  `MASSIVE_API_KEY` used elsewhere) during the refresh job and stored as a column on the episode
  table. TQQQ is available as a chart overlay toggle but deliberately isn't a second episode-table
  column, to keep that table focused on the regime signal itself rather than TQQQ's own decay
  characteristics. NDX-100 index-level data isn't used as the equity proxy since Massive's Indices
  product tier isn't included on this account's current plan (confirmed unavailable, same
  constraint noted on the Intraday Daypart tab's VIX proxy) — QQQ tracks NDX-100 closely enough,
  with a small, well-known expense-ratio drag over long lookbacks.
- **API routes**: `GET /api/yield-regime?range=1Y` (bundled current state + daily series + episode
  table, self-healing), `GET /api/yield-regime/overlay?symbol=QQQ&range=1Y` (price overlay, lazily
  fetched only when a toggle is on), `GET /api/yield-regime/refresh` (the cron/manual trigger,
  protected by `CRON_SECRET` when set).

No charting library here either — the T10Y2Y chart is the same hand-rolled, dependency-free SVG
approach as the rest of the app (background regime bands, dual-axis for spread vs. price overlay).

## Project structure

```
app/
  page.tsx                 renders the shared eyebrow + DashboardTabs
  layout.tsx, globals.css  shell + design tokens (dark by default, light via prefers-color-scheme)
  api/daypart/route.ts        server route: daypart tab, calls Massive, keeps the API key secret
  api/fundamentals/route.ts   server route: fundamentals tab, calls Massive + FRED
  api/catalysts/route.ts      server route: catalyst tracker tab, calls Massive + Alpha Vantage
  api/overnight-gap/route.ts  server route: overnight gap view, calls Massive + Finnhub
  api/ai-earnings/route.ts    server route: AI earnings analysis tab, calls Alpha Vantage
  api/yield-regime/route.ts           server route: T10Y2Y regime tab, reads MySQL (self-healing from FRED)
  api/yield-regime/overlay/route.ts   server route: QQQ/TQQQ price overlay for the regime chart, calls Massive
  api/yield-regime/refresh/route.ts   server route: the regime refresh job, triggered by vercel.json's cron or manually
lib/massive.ts               Massive API client (server-only) + Parkinson volatility calc
lib/fundamentals.ts          7-metric scoring model + tactical decision logic (server-only)
lib/catalysts.ts             top-10 list + macro calendar + 1-day reaction calc (server-only)
lib/overnightGap.ts          close-to-open gap calc + catalyst tagging, reuses catalysts.ts's list/calendar
lib/aiEarnings.ts            capex fragility screen: fundamentals fetch + cross-sectional scoring (server-only)
lib/db.ts                    MySQL pool + schema setup (server-only) — used only by the T10Y2Y Regime tab
lib/yieldRegime.ts           FRED fetch + regime classification + episode roll-up + MySQL read/write (server-only)
components/DashboardTabs.tsx      tab switcher (Intraday Daypart / Fundamental Analysis / Catalyst Tracker / AI Earnings Analysis / T10Y2Y Regime)
components/DaypartPanel.tsx       manages the list of date-range entries (up to 5), the add/remove UI, and the sub-nav to Overnight Gap
components/DaypartEntry.tsx       one date range's toolbar + readout strip, ties its chart and table together
components/DaypartChart.tsx       dependency-free SVG chart (volume bars + volatility line, dual axis)
components/DaypartTable.tsx       same data as an exact-value table, synced hover with the chart
components/OvernightGapPanel.tsx  ticker filter, calendar picker, weekday summary, and ranked table for the gap view
components/GapCalendarPicker.tsx  dependency-free multi-select/range calendar, flags catalyst-tagged dates
components/OvernightGapSummary.tsx  weekday x catalyst-type aggregate (avg/max |gap %|)
components/OvernightGapTable.tsx  sortable ranked gap table
components/FundamentalAnalysisPanel.tsx  tactical decision card, gauge, and the 7 metric cards
components/StrengthGauge.tsx      dependency-free SVG semicircle gauge
components/CatalystPanel.tsx      top-10 table, reactions table (with filters), upcoming-catalysts table
components/AIEarningsPanel.tsx    ranked fragility-score table for the AI capex buyer universe
components/YieldRegimePanel.tsx   current-state panel, range selector + overlay toggles, episode table, collapsible daily detail table
components/RegimeChart.tsx        dependency-free SVG chart: spread line + regime background bands + QQQ/TQQQ/yield overlays
```

The Massive API key is **only ever read server-side** (inside `lib/massive.ts`, used by all
routes that need it). It is never sent to the browser. FRED's CSV endpoint is public and needs
no key. MySQL (`DATABASE_URL`) is only ever read server-side too (inside `lib/db.ts`).

## 1. Local setup

Requirements: Node.js 20.9+ (Next.js 16 requirement).

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` and set your key:

```
MASSIVE_API_KEY=your_massive_api_key_here
```

Optional: for Earnings rows on the Catalyst Tracker tab's Upcoming Catalysts table, sign up free
at https://www.alphavantage.co/support/#api-key, copy your API key, and add:

```
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key_here
```

Optional: for historical Earnings tags on the Overnight Gap view (under Intraday Daypart), sign
up free at https://finnhub.io/register, copy your API key from the dashboard, and add:

```
FINNHUB_API_KEY=your_finnhub_api_key_here
```

The app works fine without either — Upcoming Catalysts just won't show Earnings rows, and
Overnight Gap just won't tag historical earnings dates.

### T10Y2Y Regime database setup (required only for that tab)

Every other tab computes its data fresh on each request; the T10Y2Y Regime tab is the one
exception — it needs MySQL to store the regime episode history (see the tab's own section above
for why). Point it at any MySQL 8 instance — a managed one (DigitalOcean, PlanetScale, RDS) or
local — via a single connection-string env var:

```
DATABASE_URL=mysql://user:password@host:3306/dbname
```

#### Step by step, using a DigitalOcean Managed MySQL database

1. In the DigitalOcean control panel (or a client like DbVisualizer, TablePlus, MySQL Workbench),
   confirm your cluster's connection details — **Host**, **Port**, **Database** (DigitalOcean
   defaults this to `defaultdb`), **Username** (defaults to `doadmin`), and **Password**. DbVisualizer
   shows these under the connection's **Connection** tab (Database Server / Database Port /
   Database / Database Userid / Database Password).
2. Build your `DATABASE_URL` from those four pieces, URL-encoding the password if it contains
   special characters (`@`, `:`, `/`, etc. — DigitalOcean's generated passwords usually don't, but
   check):
   ```
   DATABASE_URL=mysql://doadmin:YOUR_PASSWORD@your-cluster-host.db.ondigitalocean.com:25060/defaultdb
   ```
   (DigitalOcean's default MySQL port is `25060`, not the usual `3306` — use whatever port your
   cluster's connection details actually show.)
3. Add that line to `.env.local` for local development, and add `DATABASE_URL` as an Environment
   Variable in your Vercel project (Production and Preview both, if you use both) for the deployed
   app.
4. That's it — no separate "create database" step needed. DigitalOcean's managed MySQL always
   provisions a `defaultdb` database and a `doadmin` user with full privileges on it, which is all
   `CREATE TABLE`/`INSERT`/`SELECT` on the two tables below needs. SSL is mandatory on DigitalOcean's
   managed MySQL; `lib/db.ts` already sends `ssl: { rejectUnauthorized: false }` for any non-`localhost`
   `DATABASE_URL`, which satisfies that requirement without needing DigitalOcean's downloadable CA
   certificate.
5. Start the app (`npm run dev` locally, or open the deployed Vercel URL) and load the **T10Y2Y
   Regime** tab — the first request creates both tables and runs the initial FRED/QQQ backfill
   automatically (see below).

The two tables it needs (`yield_regime_daily`, `yield_regime_episodes`) are created automatically
on first use (`lib/db.ts`'s `ensureRegimeTables()` runs idempotent `CREATE TABLE IF NOT EXISTS`
statements before any query) — no manual migration step required. If you'd rather create them
yourself first (e.g. by running this directly in DbVisualizer's SQL editor against the connection
in your screenshot), here's the exact DDL it runs:

```sql
CREATE TABLE IF NOT EXISTS yield_regime_daily (
  `date` DATE PRIMARY KEY,
  y10 DECIMAL(6,3) NOT NULL,
  y2 DECIMAL(6,3) NOT NULL,
  spread DECIMAL(6,3) NOT NULL,
  d10y DECIMAL(6,3),
  d2y DECIMAL(6,3),
  dspread DECIMAL(6,3),
  regime VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS yield_regime_episodes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  regime VARCHAR(64) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  duration_trading_days INT NOT NULL,
  spread_change DECIMAL(6,3) NOT NULL,
  qqq_pct_change DECIMAL(8,4),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX yield_regime_episodes_start_date_idx (start_date DESC)
);
```

The first request to `/api/yield-regime` after setting `DATABASE_URL` triggers a full backfill
(FRED history from `REGIME_BACKFILL_START`, default 2000-01-01, through today) — this can take a
few seconds the very first time since it also fetches QQQ's full daily history from Massive to
compute each episode's % change, but every subsequent load is fast (it only recomputes when the
newest stored trading day isn't current). `vercel.json` also schedules an hourly cron hitting
`/api/yield-regime/refresh` so newly-published FRED data gets picked up without waiting for a page
visit — note Vercel's Hobby plan restricts Cron Jobs to once per day regardless of what
`vercel.json` requests, so hourly firing requires at least the Pro plan. Optionally, also set:

```
CRON_SECRET=some_random_string
```

...and add the matching value to your Vercel project's Environment Variables — this lets
`vercel.json`'s hourly cron job (`/api/yield-regime/refresh`) authenticate, so newly-published
FRED data gets picked up within the hour without needing a page visit to trigger it. It's
optional: without a `CRON_SECRET`, the refresh route is left open rather than rejecting the cron
(same graceful-degradation pattern as everywhere else), and the read path
(`ensureFreshRegimeData` in `lib/yieldRegime.ts`) still self-heals stale data on every request
regardless of whether the cron ever fires — but setting one is recommended so the endpoint can't
be spammed by anyone who finds the URL, especially now that it's meant to fire every hour.

Every other tab works with no `DATABASE_URL` at all — omitting it just means the T10Y2Y Regime
tab shows a red error box (see "Troubleshooting" below) while every other tab is unaffected.

Then run the dev server:

```bash
npm run dev
```

Open http://localhost:3000. The **Intraday Daypart** tab is active by default: a toolbar
(date + from/to time pickers), a volume/volatility chart, and a matching data table — hovering
either the chart or a table row highlights the same bucket in both. Switch to **Fundamental
Analysis** for the tactical decision card, aggregate strength gauge, and the 7 metric cards.
If you see a red error box on either tab, see "Troubleshooting" below.

`.env.local` is gitignored — your key never gets committed.

## 2. Push to GitHub

This project lives in the `scatterdayassociates/QQQ-Analysis` repo. If you're setting this
up somewhere else from scratch:

```bash
git init
git add .
git commit -m "Add QQQ/TQQQ dashboard"
git branch -M main
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
```

**Never commit `.env.local` or your real API key.** The `.gitignore` in this repo already
excludes it.

## 3. Deploy to Vercel

1. Go to https://vercel.com/signup → **Continue with GitHub**, and authorize access to this repo.
2. **Add New… → Project** → import `scatterdayassociates/QQQ-Analysis`. Vercel auto-detects Next.js.
3. Before deploying, expand **Environment Variables** and add:
   - `MASSIVE_API_KEY` = your Massive key (apply to Production, Preview, and Development).
   - `ALPHA_VANTAGE_API_KEY` = your free Alpha Vantage key, optional (see above) — only needed
     for Earnings rows on the Catalyst Tracker tab.
   - `FINNHUB_API_KEY` = your free Finnhub key, optional (see above) — only needed for
     historical Earnings tags on the Overnight Gap view.
4. Click **Deploy**.
5. After any change to an environment variable, you must **Deployments → ⋯ → Redeploy** —
   Vercel does not retroactively inject new env vars into an already-running deployment.

## Troubleshooting

- **"MASSIVE_API_KEY is not set"** — the env var isn't configured for the environment you're
  running (local `.env.local`, or the Vercel project settings for that deployment environment).
- **401 "Unknown API Key"** — the key value itself doesn't match anything on Massive's side.
  This is almost always a copy-paste issue (stray trailing space/newline). Clear the field in
  Vercel entirely and re-paste fresh, save, then redeploy. You can confirm a key works in
  isolation with:
  ```bash
  curl "https://api.massive.com/v2/aggs/ticker/QQQ/range/1/day/2024-01-02/2024-01-03?apiKey=YOUR_KEY"
  ```
- **403 "NOT_AUTHORIZED" / "Your plan doesn't include this data timeframe"** — your Massive
  plan doesn't include intraday minute-level bars. The free/Basic Stocks tier only covers
  end-of-day (daily) aggregates; intraday `Custom Bars` at minute granularity requires at
  least the **Stocks Starter** tier. Note this is billed separately from an Options-line
  subscription — Stocks and Options are separate product lines on Massive/Polygon.
- **Data looks stale (Daypart tab)** — the app caches each request for 60 seconds
  (`revalidate: 60`), and Massive's aggregates are delayed (not real-time) on the Starter tier.
  Use **Apply** to force a re-fetch.
- **Fundamentals tab errors** — check whether the error mentions "Massive" (equity data issue,
  see above) or "FRED" (FRED's CSV endpoint was unreachable or returned no usable data for that
  series — rare, but if it happens, retry via **Refresh**).
- **Only 13 (or some small number) of intraday bars come back for a date** — Massive paginates
  Custom Bars responses via `next_url` regardless of the requested `limit`; `getCustomBars`
  follows pagination automatically, so if you see this, check you're not calling the endpoint
  directly outside the app's client.
- **No Earnings rows in Upcoming Catalysts, no error shown** — the page never surfaces this as an
  error by design (missing/failed earnings lookup just omits those rows), so check **Vercel →
  your project → Logs**, filter to the `/api/catalysts` function, and look for a `[catalysts]`
  line — `getUpcomingEarningsMap` in `lib/catalysts.ts` now logs exactly why it returned nothing
  (key missing, Alpha Vantage's HTTP status + response body, a rate-limit/non-CSV response, or a
  thrown error). Common causes:
  - `ALPHA_VANTAGE_API_KEY` isn't set for the environment actually serving the request (Production
    vs. Preview are separate — check both, and confirm you redeployed *after* adding it).
  - Alpha Vantage's free tier is rate-limited (a handful of requests per minute, and a daily cap —
    the exact numbers have changed over time, check your account dashboard). A rate-limited
    request comes back as a 200 with a plain "Information"/"Thank you for using Alpha Vantage"
    message instead of CSV rows; the log line calls this out explicitly rather than silently
    parsing it as empty data.
  - Test the endpoint directly to confirm the key and data are good on Alpha Vantage's side:
    ```bash
    curl "https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=YOUR_ALPHA_VANTAGE_KEY"
    ```
    This returns CSV, not JSON — the first line is the header row
    (`symbol,name,reportDate,fiscalDateEnding,estimate,currency`). If GOOGL/TSLA/MSFT/META
    genuinely aren't in the output for the current quarter, that's Alpha Vantage's own coverage at
    that moment, not a bug here.
  - You can also hit the deployed app's own `/api/catalysts` route directly in a browser and check
    the `upcoming` array in the raw JSON for any `"eventType":"Earnings"` entries — this tells you
    whether the problem is server-side (fix via the logs above) or a frontend rendering issue.
- **No Earnings tags on Overnight Gap** — separate feature, separate source. Check the
  `/api/overnight-gap` function's logs for a `[overnight-gap]` line instead — see that view's
  troubleshooting notes; it uses `FINNHUB_API_KEY`, not Alpha Vantage.
- **No Earnings rows in Historical 1-Day Reactions** — check the `/api/catalysts` logs for a
  `[catalysts] Alpha Vantage historical earnings: N/10 tickers returned data, ...` line. Since
  this makes 10 separate requests (one per ticker, no bulk mode), individual tickers can fail
  independently — a rate-limited or errored ticker just contributes zero historical reactions
  rather than breaking the others, so `N` may legitimately be less than 10 even with a working
  key, especially on a quota-constrained free tier. Test one ticker directly:
  ```bash
  curl "https://www.alphavantage.co/query?function=EARNINGS&symbol=NVDA&apikey=YOUR_ALPHA_VANTAGE_KEY"
  ```
  Look for a top-level `"Information"` or `"Note"` field in the JSON — that's Alpha Vantage's
  rate-limit/quota message, not real data, and the app's logs call this out per-ticker rather
  than silently treating it as "no earnings."
- **T10Y2Y Regime tab shows a red error box** — almost always `DATABASE_URL` isn't set for the
  environment serving the request (this is the one tab in the app that needs it; every other tab
  is unaffected). Confirm it's set for the right Vercel environment (Production vs. Preview are
  separate) and that you redeployed after adding it. If `DATABASE_URL` is set but you still see an
  error, check **Vercel → your project → Logs**, filter to the `/api/yield-regime` function, and
  look for a `[yield-regime]` line — `refreshRegimeData`/`ensureFreshRegimeData` in
  `lib/yieldRegime.ts` log exactly what failed (FRED fetch, MySQL connection, or the QQQ overlay
  fetch for episode % changes). Test the MySQL connection directly with the `mysql` CLI (parse your
  `DATABASE_URL` into its pieces, e.g. for DigitalOcean:
  `mysql -h your-cluster-host.db.ondigitalocean.com -P 25060 -u doadmin -p --ssl-mode=REQUIRED defaultdb -e "select 1"`),
  and confirm FRED itself is reachable with:
  ```bash
  curl "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10" | head -3
  ```
- **"Access denied for user 'doadmin'@'x.x.x.x' (using password: YES)"** — this error comes from
  MySQL itself rejecting the login (error 1045), which means the connection reached the database
  fine — this is a credentials problem, not a network/firewall one (DigitalOcean's Trusted Sources
  restriction would instead show as a connection timeout, never getting this far). Since this
  error implies the connection reached the server, first rule out the DB side: if a client like
  DbVisualizer or the `mysql` CLI already connects successfully with the same username/password to
  the same host, the credentials themselves are correct and the bug is in how `DATABASE_URL` was
  built. Most common causes, in order of likelihood:
  - **A special character in the password wasn't percent-encoded** in the connection string.
    `DATABASE_URL=mysql://user:password@host:port/db` is parsed as a URL — a password containing
    `@`, `:`, `/`, `%`, `#`, `?`, etc. needs those characters percent-encoded (e.g. `@` → `%40`,
    `:` → `%3A`) or the URL parser misreads where the password ends. `lib/db.ts` parses
    `DATABASE_URL` with Node's standard `URL` class and decodes the username/password, so a
    *correctly* percent-encoded password now works reliably — but the encoding still has to be done
    on the way in. Quick way to build the encoded value correctly:
    ```bash
    node -e "console.log(encodeURIComponent('YOUR_RAW_PASSWORD'))"
    ```
    then use that output in place of the raw password in `DATABASE_URL`.
  - **Stray whitespace or a trailing newline** pasted into Vercel's environment variable field —
    same failure mode already called out for `MASSIVE_API_KEY` above. Clear the field and re-paste.
  - **A stale/wrong password** — e.g. the DigitalOcean database password was reset after
    `DATABASE_URL` was last set, or a different (old) password got copied in by mistake. Re-check
    the current password directly in the DigitalOcean control panel and rebuild `DATABASE_URL`
    from scratch rather than editing the existing value.
- **T10Y2Y Regime tab loads but the episode table is empty while the daily detail table has
  rows** — this means the regime computation ran but every day so far falls in the first
  `REGIME_LOOKBACK_DAYS` rows of your configured `REGIME_BACKFILL_START` (which have no
  `regime` yet, since there isn't enough trailing history for a lookback comparison) — wait for
  more days to accumulate, or move `REGIME_BACKFILL_START` earlier so there's already 10+ trading
  days of history before the range you care about.
- **T10Y2Y Regime data looks stale (showing a date more than ~1 business day old)** — check the
  "Last refresh check" line under the Current State card first; it shows when this server instance
  last attempted a refresh, what the newest FRED observation it saw was, and any error. Two
  different things can cause this, and that line tells you which:
  - If **newest FRED observation seen** is itself old (e.g. only 2 days newer than what's
    displayed), FRED simply hasn't published anything more recent yet — DGS10/DGS2 both carry
    FRED's own ~1-business-day publication lag, and neither the hourly cron nor the read-path
    self-heal can produce data FRED hasn't published. This isn't a bug; it'll catch up
    automatically once FRED posts the next value (checked hourly via `vercel.json`'s cron, or on
    the next page load either way).
  - If there's a **failed:** message on that line, that's the actual error from the last refresh
    attempt (FRED unreachable, a MySQL write failure, etc.) — same detail also lands in Vercel's
    function logs for `/api/yield-regime` and `/api/yield-regime/refresh` under a `[yield-regime]`
    line if you'd rather check there.
  - If **Last refresh check** never appears at all, no refresh has been attempted by this server
    instance yet (e.g. right after a cold start before the cron's next tick) — reload the page,
    which triggers `ensureFreshRegimeData` itself, or manually hit `/api/yield-regime/refresh`
    (add `?secret=YOUR_CRON_SECRET` if you've set one) to force an immediate attempt.

Note: this app calls Massive's **Stocks** Custom Bars endpoint (Stocks Starter tier) for all
price/volume data, plus Alpha Vantage's free `EARNINGS_CALENDAR` and `EARNINGS` endpoints for
upcoming and historical earnings dates on Catalyst Tracker, and Finnhub's free-tier calendar for
Overnight Gap's historical earnings tags (two separate free accounts, no Massive entitlement
involved for either) — it does not use Massive's Options or Indices data (VIX and the Dollar
Index come from FRED instead, see above).

**Cost/rate-limit note for Catalyst Tracker's historical earnings**: unlike every other external
call in this app (one request covering all tracked tickers), Alpha Vantage's `EARNINGS` endpoint
has no bulk mode — populating Historical 1-Day Reactions' Earnings rows costs **10 separate
requests** (one per top-10 ticker) against the free tier's daily quota, on top of the 1 call
`EARNINGS_CALENDAR` already uses for Upcoming Catalysts. Cached for 6 hours specifically to limit
how often that's re-spent. If you're watching quota closely, this is the most expensive external
call this app makes.

**Cost/rate-limit note for Overnight Gap**: this view fetches daily bars for 12 tickers (QQQ,
TQQQ, top 10) over the ~240-day lookback — same Stocks Starter entitlement already used
elsewhere, no new plan tier. It also makes one Finnhub call (historical earnings, unrelated to
Catalyst Tracker's Alpha Vantage-based upcoming-earnings call) — same free API key already set up
for that, no extra signup.

**Cost/rate-limit note for T10Y2Y Regime**: FRED's `DGS10`/`DGS2` CSV endpoints have no published
rate limit and need no API key, so the daily refresh (whether triggered by the cron or by a
stale-data read) costs nothing there. The refresh also fetches QQQ's full daily history once
(same Stocks Starter entitlement as everywhere else) to compute each episode's % change — cheap,
but the *first* backfill after setting `DATABASE_URL` fetches QQQ's entire history since
`REGIME_BACKFILL_START`, which is the slowest part of that one-time run. Every subsequent refresh
only recomputes when there's a genuinely new trading day. The Alpha Vantage `TREASURY_YIELD`
backup only fires when FRED is genuinely stale (>24h), and even then is throttled to at most once
every 6 hours (2 requests when it does fire) regardless of how often the hourly cron ticks during
that outage — protecting the daily quota shared with Catalyst Tracker and AI Earnings Analysis.
