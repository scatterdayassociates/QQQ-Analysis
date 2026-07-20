# QQQ / TQQQ Dashboard

A lightweight Next.js dashboard showing QQQ and TQQQ price, volume, and
% change (day-over-day and day-over-last-week), powered by the
[Massive](https://massive.com) (formerly Polygon.io) market data API.

- **Volume** comes from the **Custom Bars** endpoint (`/v2/aggs/ticker/{ticker}/range/...`),
  pulled as a 30-day daily series and rendered as a bar chart.
- **% change (Day over Day / Day over Last Week)** is computed from the
  **Daily Ticker Summary** endpoint (`/v1/open-close/{ticker}/{date}`), using
  the Custom Bars series to identify the correct real trading dates (so
  weekends/holidays are skipped automatically).

No charting library, no CSS framework — just React, plain CSS, and a
hand-rolled SVG bar chart, to keep the bundle small.

## Project structure

```
app/
  page.tsx                 client page: fetches data, renders cards
  layout.tsx, globals.css  shell + styling
  api/ticker-data/route.ts server route: calls Massive, keeps the API key secret
lib/massive.ts              Massive API client (server-only)
components/TickerCard.tsx   price/% change card
components/VolumeChart.tsx  dependency-free SVG volume chart
```

The API key is **only ever read server-side** (inside `lib/massive.ts`,
used by the `/api/ticker-data` route). It is never sent to the browser.

## 1. Local setup

Requirements: Node.js 18.18+ (Node 20/22 recommended).

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

Open http://localhost:3000 — you should see cards for QQQ and TQQQ with
price, % change, and a volume chart. If you see a red error box, it's
almost always a missing/incorrect `MASSIVE_API_KEY` or a plan that doesn't
include equities (stocks) data — see "Troubleshooting" below.

`.env.local` is gitignored — your key never gets committed.

## 2. Push to GitHub

This project already lives in the `scatterdayassociates/QQQ-Analysis`
repo. If you're setting this up somewhere else from scratch:

```bash
git init
git add .
git commit -m "Add QQQ/TQQQ dashboard"
git branch -M main
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
```

**Never commit `.env.local` or your real API key.** The `.gitignore` in
this repo already excludes it.

## 3. Deploy to Vercel (step by step)

Vercel deployment requires your own Vercel account and GitHub authorization
— this is not something that can be done on your behalf without your login,
so here's the full walkthrough:

1. **Create/sign in to a Vercel account:** go to https://vercel.com/signup
   and choose **Continue with GitHub**. Authorize Vercel to access your
   GitHub account when prompted.
2. **Import the repo:** from the Vercel dashboard, click **Add New… →
   Project**. Under "Import Git Repository", find and select
   `scatterdayassociates/QQQ-Analysis`. If it's not listed, click
   **Adjust GitHub App Permissions** and grant Vercel access to that repo
   (either "All repositories" or select it individually).
3. **Configure the project:**
   - Framework Preset: Vercel will auto-detect **Next.js** — leave it as is.
   - Root Directory: leave as `.` (the app is at the repo root).
   - Build Command / Output Directory: leave the Next.js defaults.
4. **Add the environment variable (this is the key auth step):**
   - In the same import screen, expand **Environment Variables**.
   - Name: `MASSIVE_API_KEY`
   - Value: your Massive API key
   - Apply it to **Production**, **Preview**, and **Development** environments.
   - (Optional) Also add `MASSIVE_API_BASE_URL` only if Massive ever asks
     you to point at a different base URL — otherwise leave it unset, it
     defaults to `https://api.massive.com`.
5. **Deploy:** click **Deploy**. Vercel will install dependencies, run
   `next build`, and give you a live URL (e.g.
   `qqq-analysis.vercel.app`) once it finishes — usually well under a minute.
6. **Verify:** open the deployed URL and confirm QQQ/TQQQ data loads. If it
   doesn't, check **Project → Settings → Environment Variables** to confirm
   `MASSIVE_API_KEY` is set for the Production environment, then redeploy
   (Vercel does not retroactively inject new env vars into old deployments —
   use **Deployments → ⋯ → Redeploy** after adding/changing a variable).

After the first import, every future `git push` to the connected branch
automatically triggers a new Vercel deployment — no extra steps needed.

### Rotating/protecting the API key

If this key was ever pasted somewhere outside of Vercel's encrypted
environment variable store (e.g. chat, a doc, a local file that got
committed), treat it as exposed and rotate it from your Massive dashboard
(Settings → API Keys), then update the value in Vercel **Project →
Settings → Environment Variables**.

## Troubleshooting

- **"MASSIVE_API_KEY is not set"** — the env var isn't configured for the
  environment you're running (local `.env.local` or Vercel project
  settings for that specific deployment environment).
- **502 / Massive API error 401 or 403** — the key is invalid, or your
  Massive plan's entitlements don't cover equities (stocks) data for QQQ
  and TQQQ. Custom Bars and Daily Ticker Summary exist under both the
  Options and Stocks REST APIs — since QQQ/TQQQ are ETF tickers (not
  option contracts), this app calls the **Stocks** versions of those
  endpoints. Check your plan's entitlements at https://massive.com if you
  get an authorization error here specifically.
- **Data looks stale** — the app caches each ticker's server response for
  60 seconds (`revalidate: 60`) and Massive's own data (especially
  Daily Ticker Summary) is end-of-day, not real-time streaming. Use the
  **Refresh** button to force a re-fetch.
