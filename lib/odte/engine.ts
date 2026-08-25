// 0DTE Convexity Scanner — Phase 1 engine (sessions, IM/CEM/cheapness, gate).
//
// Design notes vs. the spec (v1.1):
//  - "T-15 doctrine": every Massive value is treated as 15 minutes old. All
//    stored timestamps come from the API's own clocks (bar `t`, snapshot
//    `day.last_updated`) — never wall clock — and every pass logs the gap
//    between the two so the plan's real latency is verified empirically.
//  - Massive's option snapshot has NO bid/ask (confirmed live) — `day.close`
//    is the only per-contract price. It is used as the indicative premium;
//    spread-based checks (G4's spread leg) are therefore unverifiable on this
//    feed and replaced by volume-only liquidity, flagged in the UI.
//  - Vercel KV is replaced by a Postgres odte_kv table (same shape, no extra
//    infra) — round-trips are irrelevant at a 2-minute cadence.
//  - The spec's "Bear Steepening" regime multiplier maps to this app's yield
//    classifier label "Term Premium Steepening" (same phenomenon: long-end-led
//    rise in yields).
//
// This file must only be imported from server code.

import {
  getCustomBars,
  getOptionChainSnapshot,
  listOptionExpirations,
  type CustomBar,
  type OptionContractSnapshot,
} from "@/lib/massive";
import { MACRO_EVENTS } from "@/lib/catalysts";
import { getCurrentRegimeState } from "@/lib/yieldRegime";
import { pgQuery, kvGet, kvSet } from "./db";
import { etFromEpochMs, hhmmToMinutes, isEtWeekday, isMonthlyOpex, nowEt, type EtNow } from "./time";
import type {
  GateCondition,
  GateState,
  ImSeriesPoint,
  OdteContext,
  OdteSessionSummary,
  OdteStatus,
} from "./types";

const UNDERLYING = "QQQ";

// --- Config (env-overridable) ----------------------------------------------

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getOdteConfig() {
  return {
    riskBudgetUsd: envNum("ODTE_RISK_BUDGET_USD", 1500),
    efLookbackSessions: envNum("ODTE_EF_LOOKBACK_SESSIONS", 30),
    // Candidate band (spec §5)
    bandMinAbsDelta: 0.05,
    bandMaxAbsDelta: 0.35,
    bandMinPremium: 0.05,
    bandMinVolume: 100,
    // Gate thresholds (spec §7.2)
    gateCheapness: 0.85,
    gateCheapnessWithCatalyst: 1.0,
    gateMinBestVolume: 250,
    gateBlackoutMinutes: 25,
    gateMaxDataAgeMinutes: 18,
  };
}

// --- Small helpers ----------------------------------------------------------

/** pg returns NUMERIC columns as strings — normalize to number|null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentileRank(history: number[], x: number): number | null {
  if (history.length === 0) return null;
  const below = history.filter((v) => v < x).length;
  return Math.round((below / history.length) * 1000) / 10;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// EF(t) checkpoints — "remaining range multiplier" is estimated at these ET
// times; a live pass uses the next checkpoint at/after the current time
// (conservative: a slightly later checkpoint means slightly less remaining
// range).
const EF_CHECKPOINTS = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30"];

interface SessionMeta {
  date: string;
  has0dte: boolean;
  weeklyExpiry: string | null;
  catalyst: string | null;
  regime: string | null;
  efTable: Record<string, number>;
  efSessions: number;
  initAt: string;
}

interface SessionRow {
  session_id: string;
  trade_date: string;
  underlying: string;
  spot_open: string | null;
  spot_close: string | null;
  implied_move_open: string | null;
  realized_move: string | null;
  im_percentile: string | null;
  or_range: string | null;
  gex_open: string | null;
  regime: string | null;
  iv_term_ratio: string | null;
  catalyst: string | null;
  gate_final_state: string | null;
}

async function ensureSession(tradeDate: string, patch: { regime?: string | null; catalyst?: string | null } = {}): Promise<SessionRow> {
  await pgQuery(
    `INSERT INTO odte_sessions (trade_date, underlying, regime, catalyst)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (trade_date, underlying) DO UPDATE
       SET regime = COALESCE(EXCLUDED.regime, odte_sessions.regime),
           catalyst = COALESCE(EXCLUDED.catalyst, odte_sessions.catalyst),
           updated_at = now()`,
    [tradeDate, UNDERLYING, patch.regime ?? null, patch.catalyst ?? null]
  );
  const rows = await pgQuery<SessionRow>(
    "SELECT * FROM odte_sessions WHERE trade_date = $1 AND underlying = $2",
    [tradeDate, UNDERLYING]
  );
  return rows[0];
}

/** RTH minute bars for one ET date, ascending, with their ET times attached. */
async function getRthBars(date: string): Promise<Array<CustomBar & { etMinutes: number }>> {
  const bars = await getCustomBars(UNDERLYING, { multiplier: 1, timespan: "minute", from: date, to: date });
  const rth: Array<CustomBar & { etMinutes: number }> = [];
  for (const bar of bars) {
    const et = etFromEpochMs(bar.t);
    if (et.date !== date) continue;
    if (et.minutes < hhmmToMinutes("09:30") || et.minutes >= hhmmToMinutes("16:00")) continue;
    rth.push({ ...bar, etMinutes: et.minutes });
  }
  return rth;
}

interface ParsedContract {
  contract: string;
  side: "C" | "P";
  strike: number;
  close: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  volume: number | null;
  openInterest: number | null;
  apiTsMs: number | null;
}

function parseChain(snapshots: OptionContractSnapshot[]): ParsedContract[] {
  return snapshots.map((s) => ({
    contract: s.details.ticker,
    side: s.details.contract_type === "call" ? "C" : "P",
    strike: s.details.strike_price,
    close: s.day?.close && s.day.close > 0 ? s.day.close : null,
    iv: s.implied_volatility ?? null,
    delta: s.greeks?.delta ?? null,
    gamma: s.greeks?.gamma ?? null,
    theta: s.greeks?.theta ?? null,
    vega: s.greeks?.vega ?? null,
    volume: s.day?.volume ?? null,
    openInterest: s.open_interest ?? null,
    // day.last_updated is nanoseconds when present
    apiTsMs: s.day?.last_updated ? Math.round(s.day.last_updated / 1_000_000) : null,
  }));
}

/** Log the empirically observed feed delay — spec §12.6 asks for exactly this. */
function logFeedDelay(label: string, contracts: ParsedContract[]): number | null {
  const tsList = contracts.map((c) => c.apiTsMs).filter((t): t is number => t !== null);
  if (tsList.length === 0) {
    console.error(`[odte] ${label}: API provided no per-contract last_updated timestamps (delay unverifiable from chain)`);
    return null;
  }
  const nowMs = Date.now();
  const newest = Math.max(...tsList);
  const oldest = Math.min(...tsList);
  console.error(
    `[odte] ${label}: chain last_updated newest=${new Date(newest).toISOString()} ` +
      `(${((nowMs - newest) / 60000).toFixed(1)}m behind wall clock), oldest=${new Date(oldest).toISOString()}, n=${tsList.length}`
  );
  return newest;
}

/** ATM straddle from a parsed chain: nearest strike to spot with both legs priced. */
function findAtmStraddle(contracts: ParsedContract[], spot: number): { strike: number; call: ParsedContract; put: ParsedContract } | null {
  const byStrike = new Map<number, { call?: ParsedContract; put?: ParsedContract }>();
  for (const c of contracts) {
    const entry = byStrike.get(c.strike) ?? {};
    if (c.side === "C") entry.call = c;
    else entry.put = c;
    byStrike.set(c.strike, entry);
  }
  let best: { strike: number; call: ParsedContract; put: ParsedContract } | null = null;
  for (const [strike, legs] of byStrike) {
    if (!legs.call?.close || !legs.put?.close) continue;
    if (!best || Math.abs(strike - spot) < Math.abs(best.strike - spot)) {
      best = { strike, call: legs.call, put: legs.put };
    }
  }
  return best;
}

function atmIv(contracts: ParsedContract[], spot: number): number | null {
  const straddle = findAtmStraddle(contracts, spot);
  if (!straddle) return null;
  const ivs = [straddle.call.iv, straddle.put.iv].filter((v): v is number => v !== null && v > 0);
  if (ivs.length === 0) return null;
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

/**
 * Dealer gamma exposure, standard convention (spec §12.4: dealers long calls,
 * short puts — an estimate, flagged as such in the UI):
 *   GEX_$ per 1% move = Σ gamma × OI × 100 × spot² × 0.01 × (call: +1, put: −1)
 */
function computeGex(contracts: ParsedContract[], spot: number): { total: number; flipStrike: number | null } {
  const perStrike = new Map<number, number>();
  let total = 0;
  for (const c of contracts) {
    if (c.gamma === null || c.openInterest === null) continue;
    const sign = c.side === "C" ? 1 : -1;
    const gex = sign * c.gamma * c.openInterest * 100 * spot * spot * 0.01;
    total += gex;
    perStrike.set(c.strike, (perStrike.get(c.strike) ?? 0) + gex);
  }
  // Flip strike: where cumulative (strike-ascending) net GEX crosses zero.
  const strikes = [...perStrike.keys()].sort((a, b) => a - b);
  let cumulative = 0;
  let flipStrike: number | null = null;
  let previousSign = 0;
  for (const strike of strikes) {
    cumulative += perStrike.get(strike) ?? 0;
    const sign = Math.sign(cumulative);
    if (previousSign !== 0 && sign !== 0 && sign !== previousSign) {
      flipStrike = strike;
      break;
    }
    if (sign !== 0) previousSign = sign;
  }
  return { total, flipStrike };
}

function findCatalyst(date: string): string | null {
  const macro = MACRO_EVENTS.find((e) => e.date === date && (e.type === "FOMC" || e.type === "CPI" || e.type === "NFP"));
  if (macro) return macro.type;
  if (isMonthlyOpex(date)) return "OPEX";
  return null;
}

// ET release times for the blackout gate (G6). CPI/NFP print pre-open, so
// their 25-minute window only matters for the session's first minutes.
const RELEASE_TIME_ET: Record<string, string> = { FOMC: "14:00", CPI: "08:30", NFP: "08:30" };

// --- session-init -----------------------------------------------------------

export async function runSessionInit(options: { force?: boolean } = {}): Promise<{ ok: boolean; skipped?: string; meta?: SessionMeta }> {
  const et = nowEt();
  console.error(`[odte] session-init fired: wall=${new Date().toISOString()} et=${et.date} ${et.hhmm}`);
  if (!isEtWeekday(et) && !options.force) {
    console.error("[odte] session-init: weekend in ET — skipping");
    return { ok: true, skipped: "weekend" };
  }
  const today = et.date;
  const config = getOdteConfig();

  // 1. Expiry universe: does a 0DTE expiry exist today, and which expiry is
  //    the ~weekly leg for the chain-derived IV term structure (D6)?
  const expirations = await listOptionExpirations(UNDERLYING, today);
  const has0dte = expirations.includes(today);
  const dteOf = (expiry: string) => Math.round((Date.parse(expiry) - Date.parse(today)) / 86_400_000);
  const weeklyExpiry = expirations.find((e) => dteOf(e) >= 5 && dteOf(e) <= 9) ?? expirations.find((e) => dteOf(e) >= 3) ?? null;
  console.error(`[odte] session-init: expirations near-term=${expirations.slice(0, 8).join(",")} has0dte=${has0dte} weekly=${weeklyExpiry}`);

  // 2. Conditioning inputs
  const catalyst = findCatalyst(today);
  let regime: string | null = null;
  try {
    regime = (await getCurrentRegimeState()).regime;
  } catch (err) {
    console.error(`[odte] session-init: regime lookup failed (yield DB unreachable?) — continuing with null: ${err instanceof Error ? err.message : err}`);
  }

  // 3. EF(t) table from recent minute-bar history (spec §5.4). Sequential
  //    fetches with a courtesy delay; unlimited-call plan, so cadence is not
  //    the constraint — session-init just needs to finish inside maxDuration.
  const historyDays = await getCustomBars(UNDERLYING, {
    timespan: "day",
    from: new Date(Date.now() - (config.efLookbackSessions * 2 + 15) * 86_400_000).toISOString().slice(0, 10),
    to: today,
  });
  const historyDates = historyDays
    .map((bar) => etFromEpochMs(bar.t).date)
    .filter((d) => d < today)
    .slice(-config.efLookbackSessions);

  const ratiosByCheckpoint = new Map<string, number[]>();
  let usedSessions = 0;
  for (const date of historyDates) {
    try {
      const bars = await getRthBars(date);
      if (bars.length < 60) continue;
      const dayOpen = bars[0].o;
      const orBars = bars.filter((b) => b.etMinutes < hhmmToMinutes("10:00"));
      if (orBars.length < 10 || dayOpen <= 0) continue;
      const orRange = (Math.max(...orBars.map((b) => b.h)) - Math.min(...orBars.map((b) => b.l))) / dayOpen;
      if (orRange <= 0) continue;
      for (const checkpoint of EF_CHECKPOINTS) {
        const remaining = bars.filter((b) => b.etMinutes >= hhmmToMinutes(checkpoint));
        if (remaining.length === 0) continue;
        const remainingRange = (Math.max(...remaining.map((b) => b.h)) - Math.min(...remaining.map((b) => b.l))) / dayOpen;
        const list = ratiosByCheckpoint.get(checkpoint) ?? [];
        list.push(remainingRange / orRange);
        ratiosByCheckpoint.set(checkpoint, list);
      }
      usedSessions += 1;
      await sleep(100);
    } catch (err) {
      console.error(`[odte] session-init: EF history fetch failed for ${date}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const efTable: Record<string, number> = {};
  for (const checkpoint of EF_CHECKPOINTS) {
    const value = median(ratiosByCheckpoint.get(checkpoint) ?? []);
    if (value !== null) efTable[checkpoint] = Math.round(value * 10000) / 10000;
  }
  console.error(`[odte] session-init: EF table from ${usedSessions} sessions: ${JSON.stringify(efTable)}`);

  const meta: SessionMeta = {
    date: today,
    has0dte,
    weeklyExpiry,
    catalyst,
    regime,
    efTable,
    efSessions: usedSessions,
    initAt: new Date().toISOString(),
  };
  await kvSet("odte:meta", meta);

  const session = await ensureSession(today, { regime, catalyst });
  // Default state is NO TRADE, argued into TRADE by the tick passes (spec §7.1)
  await pgQuery("INSERT INTO odte_gate_events (session_id, ts, state, conditions) VALUES ($1, now(), 'NO_TRADE', $2::jsonb)", [
    session.session_id,
    JSON.stringify([
      {
        id: "INIT",
        name: "Session initialized",
        pass: false,
        value: has0dte ? "awaiting first evaluation pass" : "no 0DTE expiry listed today",
        threshold: "gate re-evaluates every 2 min during RTH",
      },
    ]),
  ]);
  console.error(`[odte] session-init complete for ${today} (session_id=${session.session_id})`);
  return { ok: true, meta };
}

// --- tick (chain snapshot → metrics → gate) ---------------------------------

export async function runTick(): Promise<{ ok: boolean; skipped?: string; state?: string }> {
  const wallStart = Date.now();
  const et = nowEt();
  if (!isEtWeekday(et) || et.minutes < hhmmToMinutes("09:31") || et.minutes > hhmmToMinutes("16:20")) {
    return { ok: true, skipped: `outside RTH (et=${et.hhmm})` };
  }
  const today = et.date;
  const config = getOdteConfig();
  console.error(`[odte] tick fired: wall=${new Date().toISOString()} et=${today} ${et.hhmm}`);

  // Session meta — self-heal if the 9:15 init was missed (deploy, cold start,
  // holiday-shifted schedule): run init inline, it's idempotent.
  let meta = await kvGet<SessionMeta>("odte:meta");
  if (!meta || meta.date !== today) {
    console.error(`[odte] tick: session meta missing/stale (${meta?.date ?? "none"}) — running init inline`);
    const initResult = await runSessionInit({ force: true });
    meta = initResult.meta ?? null;
    if (!meta) return { ok: false, skipped: "init failed" };
  }
  const session = await ensureSession(today, { regime: meta.regime, catalyst: meta.catalyst });
  const sessionId = session.session_id;

  if (!meta.has0dte) {
    await writeGate(sessionId, "NO_TRADE", [
      cond("G0", "0DTE expiry exists", false, "no expiry listed today", "QQQ daily expiry required"),
    ], null);
    return { ok: true, state: "NO_TRADE" };
  }

  // 1. Underlying bars (D4) — spot, OR range, freshness
  const bars = await getRthBars(today);
  if (bars.length === 0) {
    console.error("[odte] tick: no RTH bars yet (T-15 delay at the open) — NO_TRADE, feed not ready");
    await writeGate(sessionId, "NO_TRADE", [
      cond("G7", "Data freshness", false, "no delayed bars received yet", `≤ ${config.gateMaxDataAgeMinutes} min old`),
    ], null);
    return { ok: true, state: "NO_TRADE" };
  }
  const spotOpen = bars[0].o;
  const spot = bars[bars.length - 1].c;
  const latestBarEndMs = bars[bars.length - 1].t + 60_000;
  const dataAgeMinutes = (Date.now() - latestBarEndMs) / 60000;
  console.error(
    `[odte] tick: bars=${bars.length} spotOpen=${spotOpen} spot=${spot} latestBar=${new Date(latestBarEndMs).toISOString()} age=${dataAgeMinutes.toFixed(1)}m`
  );

  const orComplete = bars.some((b) => b.etMinutes >= hhmmToMinutes("10:00"));
  let orRange = num(session.or_range);
  if (orRange === null && orComplete) {
    const orBars = bars.filter((b) => b.etMinutes < hhmmToMinutes("10:00"));
    if (orBars.length > 0 && spotOpen > 0) {
      orRange = (Math.max(...orBars.map((b) => b.h)) - Math.min(...orBars.map((b) => b.l))) / spotOpen;
      console.error(`[odte] tick: OR finalized at ${et.hhmm} ET: ${(orRange * 100).toFixed(3)}% of open`);
    }
  }

  // 2. 0DTE chain snapshot (D1)
  const chainRaw = await getOptionChainSnapshot(UNDERLYING, { expirationDate: today });
  const chain = parseChain(chainRaw);
  const chainApiTs = logFeedDelay(`tick chain(${today})`, chain);
  console.error(`[odte] tick: 0DTE chain contracts=${chain.length}`);

  // 3. IM from the ATM straddle (D1 → spec §5.3). day.close is indicative T-15.
  const straddle = findAtmStraddle(chain, spot);
  const imRemaining = straddle && straddle.call.close && straddle.put.close ? (straddle.call.close + straddle.put.close) / spot : null;
  const iv0 = atmIv(chain, spot);

  // 4. GEX — recompute every 30 min (OI only updates daily; spec D7)
  let gexState = await kvGet<{ ts: number; total: number; flipStrike: number | null; date: string }>("odte:gex");
  if (!gexState || gexState.date !== today || Date.now() - gexState.ts > 28 * 60_000) {
    const gex = computeGex(chain, spot);
    gexState = { ts: Date.now(), total: gex.total, flipStrike: gex.flipStrike, date: today };
    await kvSet("odte:gex", gexState);
    console.error(`[odte] tick: GEX recomputed: total=$${(gex.total / 1e9).toFixed(2)}B/1% flip=${gex.flipStrike}`);
  }

  // 5. IV term structure — refresh every 15 min (D6, chain-derived VIX stand-in)
  let ivTermState = await kvGet<{ ts: number; ratio: number | null; iv0: number | null; ivW: number | null; date: string }>("odte:ivterm");
  if (!ivTermState || ivTermState.date !== today || Date.now() - ivTermState.ts > 14 * 60_000) {
    let ratio: number | null = null;
    let ivW: number | null = null;
    if (meta.weeklyExpiry && iv0 !== null) {
      try {
        const weeklyChain = parseChain(await getOptionChainSnapshot(UNDERLYING, { expirationDate: meta.weeklyExpiry }));
        logFeedDelay(`tick weekly-chain(${meta.weeklyExpiry})`, weeklyChain);
        ivW = atmIv(weeklyChain, spot);
        if (ivW !== null && ivW > 0) ratio = iv0 / ivW;
      } catch (err) {
        console.error(`[odte] tick: weekly chain fetch failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    ivTermState = { ts: Date.now(), ratio, iv0, ivW, date: today };
    await kvSet("odte:ivterm", ivTermState);
    console.error(`[odte] tick: iv_term_ratio=${ratio?.toFixed(3) ?? "n/a"} (0dte=${iv0?.toFixed(3) ?? "?"} weekly=${ivW?.toFixed(3) ?? "?"})`);
  }
  const ivTermRatio = ivTermState.ratio;

  // 6. CEM (spec §5.4): OR_range × EF(t) × RM, capped multipliers
  const gexOpen = num(session.gex_open) ?? gexState.total;
  let cemRemaining: number | null = null;
  if (orRange !== null && orRange > 0) {
    const checkpoint = EF_CHECKPOINTS.find((c) => hhmmToMinutes(c) >= et.minutes) ?? EF_CHECKPOINTS[EF_CHECKPOINTS.length - 1];
    const ef = meta.efTable[checkpoint];
    if (ef !== undefined) {
      let rm = 1.0;
      if (gexOpen < 0) rm *= 1.15;
      if (ivTermRatio !== null && ivTermRatio > 1.03) rm *= 1.1;
      if (meta.catalyst === "FOMC" || meta.catalyst === "CPI" || meta.catalyst === "NFP") rm *= 1.1;
      if (meta.regime === "Term Premium Steepening") rm *= 1.05; // = spec's "Bear Steepening"
      rm = Math.min(rm, 1.45);
      cemRemaining = orRange * ef * rm;
    }
  }
  const cheapness = imRemaining !== null && cemRemaining !== null && cemRemaining > 0 ? imRemaining / cemRemaining : null;

  // 7. Candidate band (Phase 2 ranks these; Phase 1 only needs G4's liquidity read)
  const band = chain.filter(
    (c) =>
      c.delta !== null &&
      Math.abs(c.delta) >= config.bandMinAbsDelta &&
      Math.abs(c.delta) <= config.bandMaxAbsDelta &&
      c.close !== null &&
      c.close >= config.bandMinPremium &&
      (c.volume ?? 0) >= config.bandMinVolume
  );
  const bestBandVolume = band.reduce((max, c) => Math.max(max, c.volume ?? 0), 0);

  // 8. Gate evaluation (spec §7.2 — ALL conditions ANDed)
  const conditions: GateCondition[] = [];
  const catalystActive = meta.catalyst === "FOMC" || meta.catalyst === "CPI" || meta.catalyst === "NFP";

  conditions.push(
    cheapness === null
      ? cond("G1", "Cheapness (IM/CEM)", false, orComplete ? "not computable (chain/EF gap)" : `n/a — opening range completes ~10:15 under T-15`, "need < 0.85")
      : cond(
          "G1",
          "Cheapness (IM/CEM)",
          cheapness < config.gateCheapness || (cheapness < config.gateCheapnessWithCatalyst && catalystActive),
          `cheapness ${cheapness.toFixed(2)}`,
          catalystActive ? "need < 0.85 (or < 1.00 with catalyst)" : "need < 0.85"
        )
  );

  conditions.push(
    cond(
      "G2",
      "Volatility mechanism",
      gexOpen < 0 || (ivTermRatio !== null && ivTermRatio > 1.0) || catalystActive,
      `GEX ${gexOpen < 0 ? "short" : "long"} $${(Math.abs(gexOpen) / 1e9).toFixed(1)}B · term ${ivTermRatio?.toFixed(2) ?? "n/a"} · catalyst ${meta.catalyst ?? "none"}`,
      "GEX < 0 OR term ratio > 1.0 OR catalyst"
    )
  );

  const inMorningWindow = et.minutes >= hhmmToMinutes("10:05") && et.minutes <= hhmmToMinutes("11:30");
  const inAfternoonWindow = et.minutes >= hhmmToMinutes("13:45") && et.minutes <= hhmmToMinutes("15:00");
  conditions.push(cond("G3", "Decision window", inMorningWindow || inAfternoonWindow, `now ${et.hhmm} ET`, "10:05–11:30 or 13:45–15:00 ET"));

  conditions.push(
    cond(
      "G4",
      "Liquidity",
      bestBandVolume >= config.gateMinBestVolume,
      `best band volume ${bestBandVolume}`,
      `≥ ${config.gateMinBestVolume}`,
      "spread unverifiable on this feed (no bid/ask) — confirm live in TOS"
    )
  );

  // Phase 1 has no trade-entry mechanism, so the budget is never consumed here;
  // the condition still renders so the risk frame is visible from day one.
  conditions.push(cond("G5", "Risk budget", true, `$0 of $${config.riskBudgetUsd} used`, "budget not exhausted"));

  let blackout = false;
  if (meta.catalyst && RELEASE_TIME_ET[meta.catalyst]) {
    const sinceRelease = et.minutes - hhmmToMinutes(RELEASE_TIME_ET[meta.catalyst]);
    blackout = sinceRelease >= 0 && sinceRelease < config.gateBlackoutMinutes;
  }
  conditions.push(
    cond(
      "G6",
      "Event blackout",
      !blackout,
      meta.catalyst ? `${meta.catalyst} released ${RELEASE_TIME_ET[meta.catalyst] ?? "?"} ET` : "no binary event today",
      `no release < ${config.gateBlackoutMinutes} min ago`
    )
  );

  conditions.push(
    cond(
      "G7",
      "Data freshness",
      dataAgeMinutes <= config.gateMaxDataAgeMinutes,
      `latest data ${dataAgeMinutes.toFixed(0)} min old`,
      `≤ ${config.gateMaxDataAgeMinutes} min (delayed feed itself must not stall)`
    )
  );

  const state = conditions.every((c) => c.pass) ? "TRADE" : "NO_TRADE";

  let recommendation: string | null = null;
  if (cheapness !== null && cheapness > 1.1) {
    recommendation = "Vol overpriced today — long premium is negative EV; stand down.";
  } else if (gexOpen > 0 && !catalystActive) {
    recommendation = "Dealer long gamma pins price; range-bound base case.";
  }

  // 9. Persist everything
  const updates: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  const push = (fragment: string, value: unknown) => {
    params.push(value);
    updates.push(`${fragment} $${params.length}`);
  };
  if (num(session.spot_open) === null) push("spot_open =", spotOpen);
  if (num(session.or_range) === null && orRange !== null) push("or_range =", orRange);
  if (num(session.gex_open) === null) push("gex_open =", gexState.total);
  if (num(session.iv_term_ratio) === null && ivTermRatio !== null) push("iv_term_ratio =", ivTermRatio);
  if (num(session.implied_move_open) === null && imRemaining !== null) {
    push("implied_move_open =", imRemaining);
    const history = await pgQuery<{ implied_move_open: string }>(
      "SELECT implied_move_open FROM odte_sessions WHERE implied_move_open IS NOT NULL AND trade_date < $1 AND underlying = $2",
      [today, UNDERLYING]
    );
    const pct = percentileRank(history.map((h) => Number(h.implied_move_open)), imRemaining);
    if (pct !== null) push("im_percentile =", pct);
    console.error(`[odte] tick: opening IM=${(imRemaining * 100).toFixed(3)}% percentile=${pct ?? "n/a"} (history n=${history.length})`);
  }
  params.push(sessionId);
  await pgQuery(`UPDATE odte_sessions SET ${updates.join(", ")} WHERE session_id = $${params.length}`, params);

  await pgQuery(
    `INSERT INTO odte_im_series (session_id, ts, et_time, spot, im_remaining, cem_remaining, cheapness, iv_term_ratio, gex_total)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
    [sessionId, et.hhmm, spot, imRemaining, cemRemaining, cheapness, ivTermRatio, gexState.total]
  );

  await writeGate(sessionId, state, conditions, recommendation);

  // Thin chain persistence: band + ATM legs only (full chains would be ~40k
  // rows/day for no Phase-1 benefit; retention cleanup runs at session-close)
  const toStore = [...band];
  if (straddle) {
    for (const leg of [straddle.call, straddle.put]) {
      if (!toStore.some((c) => c.contract === leg.contract)) toStore.push(leg);
    }
  }
  if (toStore.length > 0) {
    const values: string[] = [];
    const insertParams: unknown[] = [];
    for (const c of toStore) {
      const base = insertParams.length;
      insertParams.push(
        sessionId,
        c.apiTsMs ? new Date(c.apiTsMs).toISOString() : null,
        c.contract,
        c.side,
        c.strike,
        c.close,
        c.iv,
        c.delta,
        c.gamma,
        c.theta,
        c.vega,
        c.volume,
        c.openInterest
      );
      values.push(
        `($${base + 1}, now(), $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`
      );
    }
    await pgQuery(
      `INSERT INTO odte_chain_snapshots (session_id, ts, api_ts, contract, side, strike, mid, iv, delta, gamma, theta, vega, volume, open_interest)
       VALUES ${values.join(", ")}`,
      insertParams
    );
  }

  await kvSet("odte:freshness", {
    barTs: latestBarEndMs,
    chainApiTs,
    wall: Date.now(),
  });

  console.error(
    `[odte] tick done in ${Date.now() - wallStart}ms: state=${state} IM=${imRemaining !== null ? (imRemaining * 100).toFixed(3) + "%" : "n/a"} ` +
      `CEM=${cemRemaining !== null ? (cemRemaining * 100).toFixed(3) + "%" : "n/a"} cheapness=${cheapness?.toFixed(2) ?? "n/a"} band=${band.length}`
  );
  return { ok: true, state };
}

function cond(id: string, name: string, pass: boolean, value: string, threshold: string, note?: string): GateCondition {
  return { id, name, pass, value, threshold, ...(note ? { note } : {}) };
}

async function writeGate(sessionId: string, state: "TRADE" | "NO_TRADE", conditions: GateCondition[], recommendation: string | null): Promise<void> {
  await pgQuery("INSERT INTO odte_gate_events (session_id, ts, state, conditions) VALUES ($1, now(), $2, $3::jsonb)", [
    sessionId,
    state,
    JSON.stringify(conditions),
  ]);
  await kvSet("odte:gate", { state, conditions, recommendation, evaluatedAt: new Date().toISOString() });
}

// --- session-close ----------------------------------------------------------

export async function runSessionClose(): Promise<{ ok: boolean; skipped?: string }> {
  const et = nowEt();
  console.error(`[odte] session-close fired: wall=${new Date().toISOString()} et=${et.date} ${et.hhmm}`);
  if (!isEtWeekday(et) || et.minutes < hhmmToMinutes("16:15") || et.minutes > hhmmToMinutes("17:00")) {
    return { ok: true, skipped: `outside close window (et=${et.hhmm})` };
  }
  const today = et.date;
  const sessions = await pgQuery<SessionRow>("SELECT * FROM odte_sessions WHERE trade_date = $1 AND underlying = $2", [today, UNDERLYING]);
  const session = sessions[0];
  if (!session) return { ok: true, skipped: "no session row today" };

  const bars = await getRthBars(today);
  if (bars.length > 0) {
    const spotOpen = num(session.spot_open) ?? bars[0].o;
    const realizedMove = spotOpen > 0 ? (Math.max(...bars.map((b) => b.h)) - Math.min(...bars.map((b) => b.l))) / spotOpen : null;
    const lastGate = await pgQuery<{ state: string }>(
      "SELECT state FROM odte_gate_events WHERE session_id = $1 ORDER BY ts DESC LIMIT 1",
      [session.session_id]
    );
    await pgQuery(
      `UPDATE odte_sessions SET spot_close = $1, realized_move = $2, gate_final_state = $3, updated_at = now() WHERE session_id = $4`,
      [bars[bars.length - 1].c, realizedMove, lastGate[0]?.state ?? "NO_TRADE", session.session_id]
    );
    console.error(
      `[odte] session-close: spot_close=${bars[bars.length - 1].c} realized=${realizedMove !== null ? (realizedMove * 100).toFixed(3) + "%" : "n/a"} ` +
        `vs IM_open=${num(session.implied_move_open) !== null ? (Number(session.implied_move_open) * 100).toFixed(3) + "%" : "n/a"}`
    );
  }

  // Retention: thin chain rows are only needed for a couple of weeks of debug
  // context; series/gate audit stays longer for EV tuning.
  const deletedChain = await pgQuery<{ count: string }>(
    "WITH d AS (DELETE FROM odte_chain_snapshots WHERE ts < now() - interval '14 days' RETURNING 1) SELECT count(*) FROM d"
  );
  const deletedSeries = await pgQuery<{ count: string }>(
    "WITH d AS (DELETE FROM odte_im_series WHERE ts < now() - interval '90 days' RETURNING 1) SELECT count(*) FROM d"
  );
  console.error(`[odte] session-close: retention deleted chain=${deletedChain[0]?.count ?? 0} series=${deletedSeries[0]?.count ?? 0}`);
  return { ok: true };
}

// --- status (UI) ------------------------------------------------------------

export async function getOdteStatus(): Promise<OdteStatus> {
  const et = nowEt();
  const config = getOdteConfig();
  const marketClosed = !isEtWeekday(et) || et.minutes < hhmmToMinutes("09:30") || et.minutes > hhmmToMinutes("16:15");

  const sessions = await pgQuery<SessionRow>(
    "SELECT * FROM odte_sessions WHERE underlying = $1 ORDER BY trade_date DESC LIMIT 1",
    [UNDERLYING]
  );
  const session = sessions[0] ?? null;
  if (!session) {
    return {
      session: null,
      gate: null,
      series: [],
      context: null,
      riskBudget: { totalUsd: config.riskBudgetUsd, usedUsd: 0 },
      dataAsOf: null,
      dataAgeMinutes: null,
      marketClosed,
    };
  }

  const meta = await kvGet<SessionMeta>("odte:meta");
  const gateKv = await kvGet<{ state: "TRADE" | "NO_TRADE"; conditions: GateCondition[]; recommendation: string | null; evaluatedAt: string }>("odte:gate");
  const gexState = await kvGet<{ total: number; flipStrike: number | null; date: string }>("odte:gex");
  const freshness = await kvGet<{ barTs: number | null; chainApiTs: number | null }>("odte:freshness");

  const seriesRows = await pgQuery<{ et_time: string; spot: string | null; im_remaining: string | null; cem_remaining: string | null; cheapness: string | null }>(
    "SELECT et_time, spot, im_remaining, cem_remaining, cheapness FROM odte_im_series WHERE session_id = $1 ORDER BY ts ASC",
    [session.session_id]
  );
  const series: ImSeriesPoint[] = seriesRows.map((r) => ({
    etTime: r.et_time,
    spot: num(r.spot),
    imRemaining: num(r.im_remaining),
    cemRemaining: num(r.cem_remaining),
    cheapness: num(r.cheapness),
  }));

  const historyCount = await pgQuery<{ n: string }>(
    "SELECT count(*) AS n FROM odte_sessions WHERE implied_move_open IS NOT NULL AND trade_date < $1 AND underlying = $2",
    [session.trade_date, UNDERLYING]
  );

  const latestSpot = series.length > 0 ? series[series.length - 1].spot : null;
  const dataTs = Math.max(freshness?.barTs ?? 0, freshness?.chainApiTs ?? 0) || null;

  // DATE comes back as "YYYY-MM-DD" (see the type parser in db.ts)
  const tradeDate = String(session.trade_date).slice(0, 10);
  const sessionSummary: OdteSessionSummary = {
    tradeDate,
    underlying: session.underlying,
    spotOpen: num(session.spot_open),
    spot: latestSpot,
    impliedMoveOpen: num(session.implied_move_open),
    orRange: num(session.or_range),
    expiry0dteAvailable: meta !== null && meta.date === tradeDate ? meta.has0dte : true,
    weeklyExpiry: meta?.weeklyExpiry ?? null,
  };

  const context: OdteContext = {
    gexTotal: gexState?.total ?? num(session.gex_open),
    gexFlipStrike: gexState?.flipStrike ?? null,
    ivTermRatio: num(session.iv_term_ratio),
    regime: session.regime,
    catalyst: session.catalyst,
    imPercentile: num(session.im_percentile),
    imPercentileSessions: Number(historyCount[0]?.n ?? 0),
  };

  return {
    session: sessionSummary,
    gate: gateKv
      ? { state: gateKv.state, conditions: gateKv.conditions, evaluatedAt: gateKv.evaluatedAt, recommendation: gateKv.recommendation ?? null }
      : null,
    series,
    context,
    riskBudget: { totalUsd: config.riskBudgetUsd, usedUsd: 0 },
    dataAsOf: dataTs ? new Date(dataTs).toISOString() : null,
    dataAgeMinutes: dataTs ? Math.round((Date.now() - dataTs) / 60000) : null,
    marketClosed,
  };
}
