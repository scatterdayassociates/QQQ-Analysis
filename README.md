# QQQ / TQQQ Dashboard

A lightweight Next.js dashboard with three tabs:

1. **Intraday Daypart** — QQQ/TQQQ intraday volume in 15-minute buckets across the regular
   session (9:30 AM–4:00 PM ET), with a realized-volatility proxy plotted alongside.
2. **Fundamental Analysis** — a 7-metric market strength/tactical model (macro, trend, credit,
   breadth, volatility) with a plain-English explanation of each metric.
3. **Catalyst Tracker** — the top 10 Nasdaq-100 components, their historical 1-day reactions to
   macro catalysts (FOMC/CPI/jobs reports), and an upcoming-catalyst calendar.

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
tickers actually moved close-to-close around past macro events), and an upcoming-catalysts
calendar.

- The **top-10 list** (NVDA, AAPL, MSFT, AMZN, GOOGL, AVGO, META, TSLA, COST, NFLX) is a fixed
  snapshot of Nasdaq-100/QQQ weightings as of mid-2026 — QQQ's weights drift with price and the
  index rebalances quarterly, so this is "as of," not a live, continuously-rebalanced ranking.
  Re-verify periodically against Invesco's live QQQ holdings page.
- **Reactions are real, computed values** — the close price the trading day before each macro
  event vs. the close on the event day itself, from Massive's Custom Bars, not fabricated
  numbers. Covers Jan 2026–present.
- The **macro calendar** (FOMC rate decisions, CPI releases, jobs reports) is hardcoded from the
  Federal Reserve's and BLS's published 2026 schedules — real, verified dates, not the source
  app's placeholder-style calendar.
- **Market cap** is attempted via Massive's Ticker Details (reference) endpoint and shows "—" if
  unavailable on the current plan, rather than failing the whole table.
- **Upcoming earnings** for each top-10 ticker come from [Finnhub's](https://finnhub.io) free-tier
  Earnings Calendar API — officially documented and intended for exactly this use case. Requires
  a free account and a `FINNHUB_API_KEY` (see setup below); without one, Upcoming Catalysts just
  won't show Earnings rows, everything else keeps working. Fetched once per load for the whole
  lookahead window (not per-ticker) and filtered down to the top 10 here.
  Two free, no-signup alternatives were tried and rejected first: Massive's own Benzinga earnings
  endpoint (`NOT_AUTHORIZED` on this account's plan) and Yahoo Finance's public `quoteSummary`
  endpoint (now requires a session cookie + anti-bot "crumb" token) — see git history for both.
- **Historical reactions cover macro events only** (FOMC/CPI/jobs reports), not past earnings —
  there's no verified *historical* earnings-date source wired up, and hardcoding past dates
  without a reliable feed risks showing stale or wrong dates. Upcoming earnings dates don't carry
  that risk since they're fetched live.

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
  api/catalysts/route.ts      server route: catalyst tracker tab, calls Massive
lib/massive.ts               Massive API client (server-only) + Parkinson volatility calc
lib/fundamentals.ts          7-metric scoring model + tactical decision logic (server-only)
lib/catalysts.ts             top-10 list + macro calendar + 1-day reaction calc (server-only)
components/DashboardTabs.tsx      tab switcher (Intraday Daypart / Fundamental Analysis / Catalyst Tracker)
components/DaypartPanel.tsx       manages the list of date-range entries (up to 5) + the add/remove UI
components/DaypartEntry.tsx       one date range's toolbar + readout strip, ties its chart and table together
components/DaypartChart.tsx       dependency-free SVG chart (volume bars + volatility line, dual axis)
components/DaypartTable.tsx       same data as an exact-value table, synced hover with the chart
components/FundamentalAnalysisPanel.tsx  tactical decision card, gauge, and the 7 metric cards
components/StrengthGauge.tsx      dependency-free SVG semicircle gauge
components/CatalystPanel.tsx      top-10 table, reactions table (with filters), upcoming-catalysts table
```

The Massive API key is **only ever read server-side** (inside `lib/massive.ts`, used by all
three API routes). It is never sent to the browser. FRED's CSV endpoint is public and needs no
key.

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

Optional: for Earnings rows on the Catalyst Tracker tab, sign up free at
https://finnhub.io/register, copy your API key from the dashboard, and add:

```
FINNHUB_API_KEY=your_finnhub_api_key_here
```

The app works fine without it — Upcoming Catalysts just won't show Earnings rows.

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
   - `FINNHUB_API_KEY` = your free Finnhub key, optional (see above) — only needed for Earnings
     rows on the Catalyst Tracker tab.
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
- **No Earnings rows in Upcoming Catalysts, no error shown** — most likely `FINNHUB_API_KEY`
  isn't set (`getUpcomingEarningsMap` in `lib/catalysts.ts` returns an empty map immediately if
  it's missing, by design). If it is set, test the endpoint directly:
  ```bash
  curl "https://finnhub.io/api/v1/calendar/earnings?from=2026-07-21&to=2026-10-19&token=YOUR_FINNHUB_KEY"
  ```
  A 401 means the key is wrong; an empty `earningsCalendar` array for that window is possible if
  none of the top-10 tickers report in the next ~90 days (unlikely, but not impossible depending
  on where in the quarterly cycle "today" falls).

Note: this app calls Massive's **Stocks** Custom Bars endpoint (Stocks Starter tier) for all
price/volume data, plus Finnhub's free-tier Earnings Calendar API for upcoming earnings dates
(a separate free account, no Massive entitlement involved) — it does not use Massive's Options or
Indices data (VIX and the Dollar Index come from FRED instead, see above).
