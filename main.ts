// Dip-ladder cbBTC swing bot for make.fun btc-race-24h-20261118-1444.
//
// Idea (measured on the kit's dev window, not guessed): cbBTC mean-reverts after
// sharp intraday dips. The bot buys a dip in two tiers against the rolling
// 60-bar high, exits on a take-profit or a stop-loss measured from the
// volume-weighted average entry, and — so it never ends a window with zero
// trades — falls back to a smaller dip (or a fresh 30-bar high) once only
// four hours of the window are left.
//
// The bot is a pure function of the bars the harness sends it: no clock, no
// environment, no randomness, no network. Every entry runs twice and the two
// action logs must match byte for byte, so nothing here may vary run to run.
//
// Costs the strategy is sized against (from the competition bundle): a full
// round trip pays about 26 bps (4 bps fee + 2 bps modelled slippage + price
// impact on the pool), so a trade has to catch a move clearly larger than
// that. The take-profit (+160 bps) and stop-loss (-220 bps) are both well
// clear of it; the entry dips (140 / 220 bps) are the bounce the exit needs.
// The fallback fires only when nothing has traded yet, so it can never drag
// down a window the ladder already paid on.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;

// --- strategy constants (all in basis points unless named otherwise) ---
const LOOKBACK_BARS = 60; // rolling high window
const TIER1_DIP_BPS = 140n; // tier 1: close >= 140 bps below the rolling-60 high
const TIER2_DIP_BPS = 220n; // tier 2: close >= 220 bps below the rolling-60 high
const FALLBACK_BAR = 1200; // anti-zero-trade fallback starts here (4h left of 1440)
const FALLBACK_DIP_BPS = 80n; // fallback entry dip
const MOMENTUM_BARS = 30; // fallback momentum: a fresh 30-bar high
const TAKE_PROFIT_BPS = 160n; // exit: +160 bps from the average entry
const STOP_LOSS_BPS = 220n; // exit: -220 bps from the average entry
const MAX_SLIPPAGE_BPS = 500; // modelled slip + impact is ~10-15 bps; 500 never blocks a real fill

// --- per-run state (rebuilt from the bars; nothing survives a restart) ---
const closes: bigint[] = []; // every close seen, in order (price_scale units)
let tier2Bought = false; // true once the ladder's second tier has fired for this position
let traded = false; // true once any of our orders has filled (the fallback's gate)

/** The highest close of the last `LOOKBACK_BARS` bars, current bar included. */
function rollingHigh(): bigint | null {
  if (closes.length === 0) return null;
  let high = closes[closes.length - 1]!;
  const start = Math.max(0, closes.length - LOOKBACK_BARS);
  for (let i = start; i < closes.length; i++) {
    if (closes[i]! > high) high = closes[i]!;
  }
  return high;
}

/** How far the latest close sits below the rolling high, in basis points. */
function dipBps(close: bigint): bigint | null {
  const high = rollingHigh();
  if (high === null || high === 0n) return null;
  if (close >= high) return 0n;
  return ((high - close) * BPS) / high;
}

/** True when the latest close is a fresh high over the previous `MOMENTUM_BARS` bars. */
function freshMomentumHigh(close: bigint): boolean {
  if (closes.length <= MOMENTUM_BARS) return false;
  let prevHigh = closes[closes.length - MOMENTUM_BARS - 1]!;
  for (let i = closes.length - MOMENTUM_BARS; i < closes.length - 1; i++) {
    if (closes[i]! > prevHigh) prevHigh = closes[i]!;
  }
  return close > prevHigh;
}

/**
 * The volume-weighted average entry price of the open position, in the
 * symbol's price_scale units, from the harness's own cost/qty accounting
 * (cost includes the fees already paid). Null when flat.
 */
function averageEntry(state: BarsState): bigint | null {
  const pos = state.positions.get(SYMBOL);
  if (!pos || pos.qty === 0n) return null;
  const sym = state.symbols.get(SYMBOL);
  if (!sym) return null;
  const quoteScale = BigInt(state.hello.capital.quote_scale);
  const num = pos.cost * 10n ** BigInt(sym.qty_scale + sym.price_scale);
  const den = pos.qty * 10n ** quoteScale;
  return num / den;
}

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  const close = state.close(SYMBOL);
  if (close === null) return [];
  // Build history on every bar, warm-up included: the rolling high needs it.
  closes.push(close);
  // The harness reports our last batch's fills here; a filled order means we
  // have traded, which closes the fallback (it exists only to guarantee a
  // first trade, never to add a losing extra trade to a window that already
  // paid).
  for (const fill of batch.fills) {
    if (fill.status === 'filled') traded = true;
  }
  // Warm-up batches reject every order, so there is nothing to decide yet.
  if (state.warmingUp) return [];

  const orders: OrderInput[] = [];
  const pos = state.positions.get(SYMBOL);
  const holding = pos !== undefined && pos.qty > 0n;

  if (holding) {
    // --- exit first: take-profit / stop-loss on the average entry ---
    const entry = averageEntry(state);
    if (entry !== null && entry > 0n) {
      const up = close * BPS >= entry * (BPS + TAKE_PROFIT_BPS);
      const down = close * BPS <= entry * (BPS - STOP_LOSS_BPS);
      if (up || down) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        tier2Bought = false;
        return orders;
      }
    }
    // --- otherwise, complete the ladder on a deeper dip ---
    const dip = dipBps(close);
    if (!tier2Bought && dip !== null && dip >= TIER2_DIP_BPS && state.cash > 0n) {
      orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
      tier2Bought = true;
    }
    return orders;
  }

  // --- flat: look for an entry ---
  const dip = dipBps(close);
  if (dip === null) return [];

  // Tier 1 of the ladder: half the cash on a real dip.
  if (dip >= TIER1_DIP_BPS) {
    const half = state.cash / 2n;
    if (half > 0n) {
      orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: half, max_slippage_bps: MAX_SLIPPAGE_BPS });
      tier2Bought = false;
    }
    return orders;
  }

  // Fallback: with four hours left and still no trade at all, take a smaller
  // dip — or a fresh 30-bar high in a rising window — so the window is never
  // a zero. It only fires when nothing has traded yet, so it can never drag
  // down a window the ladder already paid on.
  if (state.seq >= FALLBACK_BAR && !traded) {
    if (dip >= FALLBACK_DIP_BPS || freshMomentumHigh(close)) {
      if (state.cash > 0n) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
        tier2Bought = true; // fully invested; there is no second tier to add
      }
    }
  }
  return orders;
}

await runBars({ onBatch });
