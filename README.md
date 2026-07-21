# QQQ / TQQQ Dashboard

A lightweight Next.js dashboard with two tabs:

1. **Intraday Daypart** — QQQ/TQQQ intraday volume in 15-minute buckets across the regular
   session (9:30 AM–4:00 PM ET), with a realized-volatility proxy plotted alongside.
2. **Fundamental Analysis** — a 7-metric market strength/tactical model (macro, trend, credit,
   breadth, volatility) with a plain-English explanation of each metric.

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
lib/massive.ts               Massive API client (server-only) + Parkinson volatility calc
lib/fundamentals.ts          7-metric scoring model + tactical decision logic (server-only)
components/DashboardTabs.tsx      tab switcher (Intraday Daypart / Fundamental Analysis)
components/DaypartPanel.tsx       date/time filters + readout strip, ties chart and table together
components/DaypartChart.tsx       dependency-free SVG chart (volume bars + volatility line, dual axis)
components/DaypartTable.tsx       same data as an exact-value table, synced hover with the chart
components/FundamentalAnalysisPanel.tsx  tactical decision card, gauge, and the 7 metric cards
components/StrengthGauge.tsx      dependency-free SVG semicircle gauge
```

The Massive API key is **only ever read server-side** (inside `lib/massive.ts`, used by both
API routes). It is never sent to the browser. FRED's CSV endpoint is public and needs no key.

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

Note: this app only calls Massive's **Stocks** Custom Bars endpoint — it does not use Massive's
Options or Indices data (VIX and the Dollar Index come from FRED instead, see above), so there's
no separate Massive entitlement to worry about beyond Stocks Starter.
