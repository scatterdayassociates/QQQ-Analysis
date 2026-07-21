# Intraday Daypart — QQQ / TQQQ

A lightweight Next.js tool showing QQQ and TQQQ intraday volume in 15-minute
buckets across the regular session (9:30 AM–4:00 PM ET), with VIX plotted
alongside as a market-wide implied-volatility proxy. Powered by the
[Massive](https://massive.com) (formerly Polygon.io) market data API.

- **Volume** comes from the **Custom Bars** endpoint (`/v2/aggs/ticker/{ticker}/range/...`),
  requested as 15-minute intraday bars for the selected date.
- **VIX** (CBOE Volatility Index, ticker `I:VIX`) is pulled the same way and plotted as an
  implied-volatility proxy, since IV itself is a property of individual option contracts
  (strike + expiry), not the underlying ticker — there's no single "QQQ IV" value to plot directly.
- **Date/time filters** let you pick any trading day and narrow the window within market hours.

No charting library, no CSS framework — just React, plain CSS, and a hand-rolled SVG chart
(grouped volume bars + a VIX line on an independent axis), to keep the bundle small.

## Project structure

```
app/
  page.tsx                 renders the header + DaypartPanel
  layout.tsx, globals.css  shell + design tokens (dark by default, light via prefers-color-scheme)
  api/daypart/route.ts     server route: calls Massive, keeps the API key secret
lib/massive.ts              Massive API client (server-only)
components/DaypartPanel.tsx date/time filters + readout strip, ties chart and table together
components/DaypartChart.tsx  dependency-free SVG chart (volume bars + VIX line, dual axis)
components/DaypartTable.tsx  same data as an exact-value table, synced hover with the chart
```

The API key is **only ever read server-side** (inside `lib/massive.ts`, used by the
`/api/daypart` route). It is never sent to the browser.

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

Open http://localhost:3000 — you should see the toolbar (date + from/to time pickers), a
volume/VIX chart, and a matching data table. Hovering either the chart or a table row
highlights the same bucket in both. If you see a red error box, see "Troubleshooting" below.

`.env.local` is gitignored — your key never gets committed.

## 2. Push to GitHub

This project lives in the `scatterdayassociates/QQQ-Analysis` repo. If you're setting this
up somewhere else from scratch:

```bash
git init
git add .
git commit -m "Add intraday daypart tool"
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
  subscription — Stocks and Options (and Indices, which covers `I:VIX`) are separate product
  lines on Massive/Polygon.
- **VIX column/line is empty but QQQ/TQQQ volume works** — your plan may cover Stocks
  intraday data but not Indices data. `I:VIX` is billed under the Indices product line.
- **Data looks stale** — the app caches each request for 60 seconds (`revalidate: 60`), and
  Massive's aggregates are delayed (not real-time) on the Starter tier. Use **Apply** to force
  a re-fetch.
