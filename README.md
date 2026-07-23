# QQQ / TQQQ Dashboard

A lightweight Next.js dashboard with four tabs:

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

Powered by the [Massive](https://massive.com) (formerly Polygon.io) market data API, plus
free public [FRED](https://fred.stlouisfed.org) series for a couple of macro inputs (see below).

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
  cracks). This is a separate, purpose-built universe from Catalyst Tracker's top-10 list, not
  a subset of it.
- **Metrics** (all computed from real quarterly statement data, not fabricated): capex coverage
  ratio (OCF ÷ capex, latest quarter), capex-to-revenue and financing dependency (debt+equity
  issued ÷ capex, both trailing 4-quarter averages so a single one-off raise doesn't outrank a
  name that's been persistently externally-funding capex for years), coverage trend (YoY
  direction), buyback Δ YoY (a cut is often the first lever pulled before touching capex), and a
  composite **Fragility Score** — a cross-sectional z-scored blend of all four, self-calibrating
  as tickers are added (no hardcoded thresholds).
- **Data source**: Alpha Vantage's `CASH_FLOW` and `INCOME_STATEMENT` endpoints (same
  `ALPHA_VANTAGE_API_KEY` already used elsewhere — no new key needed). Unlike everything else in
  this app, these have no bulk mode: **2 requests per ticker, 12 total per load** — the most
  expensive external call in the app by request count. Cached 24 hours (`revalidate: 86400`,
  longer than anywhere else) since quarterly fundamentals only change 4x/year. A rate-limited or
  missing ticker just drops out of the table rather than failing the page; check Vercel logs for
  `[ai-earnings]` lines to see exactly how many tickers came through.
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
lib/massive.ts               Massive API client (server-only) + Parkinson volatility calc
lib/fundamentals.ts          7-metric scoring model + tactical decision logic (server-only)
lib/catalysts.ts             top-10 list + macro calendar + 1-day reaction calc (server-only)
lib/overnightGap.ts          close-to-open gap calc + catalyst tagging, reuses catalysts.ts's list/calendar
lib/aiEarnings.ts            capex fragility screen: fundamentals fetch + cross-sectional scoring (server-only)
components/DashboardTabs.tsx      tab switcher (Intraday Daypart / Fundamental Analysis / Catalyst Tracker / AI Earnings Analysis)
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
```

The Massive API key is **only ever read server-side** (inside `lib/massive.ts`, used by all
routes that need it). It is never sent to the browser. FRED's CSV endpoint is public and needs
no key.

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
