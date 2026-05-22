import { pointValue } from './instruments';

export function totalPnL(trades) {
  return trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
}

export function winLossCounts(trades) {
  let w = 0, l = 0, be = 0;
  for (const t of trades) {
    const p = Number(t.pnl) || 0;
    if (p > 0) w++;
    else if (p < 0) l++;
    else be++;
  }
  return { wins: w, losses: l, breakeven: be, total: trades.length };
}

export function winRate(trades) {
  const { wins, losses } = winLossCounts(trades);
  const denom = wins + losses;
  return denom === 0 ? 0 : (wins / denom) * 100;
}

export function profitFactor(trades) {
  let gross = 0, lossSum = 0;
  for (const t of trades) {
    const p = Number(t.pnl) || 0;
    if (p > 0) gross += p;
    else if (p < 0) lossSum += -p;
  }
  if (lossSum === 0) return gross > 0 ? Infinity : 0;
  return gross / lossSum;
}

export function avgRR(trades) {
  // Hybrid: use the true realized R-multiple for any trade that has a stop /
  // planned risk defined. If no trade carries risk data, fall back to the
  // avg-win / |avg-loss| reward-to-risk ratio so the stat is never blank.
  const realized = trades
    .map(t => (t.rr_actual != null && !isNaN(Number(t.rr_actual)))
      ? Number(t.rr_actual)
      : realizedR(t))
    .filter(r => r != null && isFinite(r));
  if (realized.length) {
    return realized.reduce((s, r) => s + r, 0) / realized.length;
  }
  const aw = avgWin(trades);
  const al = Math.abs(avgLoss(trades));
  return al === 0 ? 0 : aw / al;
}

export function avgWin(trades) {
  const wins = trades.filter(t => Number(t.pnl) > 0);
  if (!wins.length) return 0;
  return wins.reduce((s, t) => s + Number(t.pnl), 0) / wins.length;
}

export function avgLoss(trades) {
  const losses = trades.filter(t => Number(t.pnl) < 0);
  if (!losses.length) return 0;
  return losses.reduce((s, t) => s + Number(t.pnl), 0) / losses.length;
}

export function expectancy(trades) {
  if (!trades.length) return 0;
  return totalPnL(trades) / trades.length;
}

export function bestTrade(trades) {
  if (!trades.length) return null;
  return trades.reduce((b, t) => (Number(t.pnl) > Number(b.pnl) ? t : b));
}

export function worstTrade(trades) {
  if (!trades.length) return null;
  return trades.reduce((w, t) => (Number(t.pnl) < Number(w.pnl) ? t : w));
}

export function maxDrawdown(trades) {
  const sorted = [...trades].sort((a, b) =>
    new Date(`${a.date}T${a.time || '00:00'}`) - new Date(`${b.date}T${b.time || '00:00'}`)
  );
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of sorted) {
    equity += Number(t.pnl) || 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

export function sharpeRatio(trades) {
  if (trades.length < 2) return 0;
  const returns = trades.map(t => Number(t.pnl) || 0);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}

export function streaks(trades) {
  const sorted = [...trades].sort((a, b) =>
    new Date(`${a.date}T${a.time || '00:00'}`) - new Date(`${b.date}T${b.time || '00:00'}`)
  );
  let curr = 0, currType = null;
  let bestWin = 0, worstLoss = 0;
  let runWin = 0, runLoss = 0;
  for (const t of sorted) {
    const p = Number(t.pnl) || 0;
    if (p > 0) {
      runWin++; runLoss = 0;
      if (runWin > bestWin) bestWin = runWin;
      currType = 'win'; curr = runWin;
    } else if (p < 0) {
      runLoss++; runWin = 0;
      if (runLoss > worstLoss) worstLoss = runLoss;
      currType = 'loss'; curr = runLoss;
    }
  }
  return { current: curr, currentType: currType, bestWin, worstLoss };
}

export function pnlByDay(trades) {
  const map = {};
  for (const t of trades) {
    map[t.date] = (map[t.date] || 0) + (Number(t.pnl) || 0);
  }
  return map;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Add one calendar day to a 'YYYY-MM-DD' string via UTC arithmetic (no TZ drift).
function addDayStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Futures session date. The CME session runs 18:00 ET (previous calendar day)
// → 17:00 ET. A trade timestamped at hour >= 18 ET belongs to the NEXT
// calendar day's session. `hour` is the ET hour of the trade (0-23).
export function sessionDateOf(dateStr, hour) {
  if (!dateStr) return dateStr;
  return hour >= 18 ? addDayStr(dateStr) : dateStr;
}

// Session date for a stored trade (date + 'HH:MM' time, both in ET).
export function tradeSessionDate(t) {
  const hour = t.time ? (parseInt(String(t.time).slice(0, 2), 10) || 0) : 0;
  return sessionDateOf(t.date, hour);
}

// Current futures session date, computed explicitly in America/New_York so it
// is correct regardless of the timezone of the machine viewing the dashboard.
export function currentSessionDate() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // some engines emit '24' at midnight
  return sessionDateOf(`${parts.year}-${parts.month}-${parts.day}`, hour);
}

export function filterByPeriod(trades, period) {
  if (period === 'all') return trades;
  if (period === 'day') {
    const current = currentSessionDate();
    return trades.filter(t => tradeSessionDate(t) === current);
  }
  const now = new Date();
  const start = new Date(now);
  if (period === 'week') start.setDate(now.getDate() - 7);
  else if (period === 'month') start.setMonth(now.getMonth() - 1);
  const startStr = localDateStr(start);
  return trades.filter(t => t.date >= startStr);
}

export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function fmtPct(n, digits = 1) {
  if (n == null || isNaN(n)) return '0%';
  return `${n.toFixed(digits)}%`;
}

export function fmtNum(n, digits = 2) {
  if (n == null || isNaN(n)) return '0';
  if (!isFinite(n)) return '∞';
  return n.toFixed(digits);
}

// ── Multi-TP / Multi-SL R-Multiple math ─────────────────────────────────
// Each level: { id, price, contracts, percent }. We compute $ from the
// distance to entry × point value × contracts. Helpers handle missing data.

function levelDollarsAbs(level, entry, ticker) {
  if (level == null || level.price == null || entry == null) return 0;
  const pv  = pointValue(ticker);
  const qty = Number(level.contracts) || 0;
  const dist = Math.abs(Number(level.price) - Number(entry));
  return dist * pv * qty;
}

/** Total $ at the planned profit targets (sum across levels). */
export function tpDollars(trade) {
  if (!trade?.tp_levels?.length || trade.entry == null) return 0;
  return trade.tp_levels.reduce(
    (s, lvl) => s + levelDollarsAbs(lvl, trade.entry, trade.ticker),
    0
  );
}

/** Total $ at risk if all stops hit (sum across SL levels). Returns positive value. */
export function slDollars(trade) {
  if (!trade?.sl_levels?.length || trade.entry == null) return 0;
  return trade.sl_levels.reduce(
    (s, lvl) => s + levelDollarsAbs(lvl, trade.entry, trade.ticker),
    0
  );
}

/** Initial trade target in $ (manual override OR computed from TP levels). */
export function initialTargetDollars(trade) {
  if (trade?.planned_target_dollars != null) return Number(trade.planned_target_dollars);
  return tpDollars(trade);
}

/** Trade risk in $ (manual override OR computed from SL levels). Always positive. */
export function tradeRiskDollars(trade) {
  if (trade?.planned_risk_dollars != null) return Math.abs(Number(trade.planned_risk_dollars));
  return slDollars(trade);
}

/** Planned R-multiple: target ÷ risk. */
export function plannedR(trade) {
  const risk = tradeRiskDollars(trade);
  if (!risk) return null;
  return initialTargetDollars(trade) / risk;
}

/** Realized R-multiple: actual P&L ÷ risk. */
export function realizedR(trade) {
  const risk = tradeRiskDollars(trade);
  if (!risk || trade?.pnl == null) return null;
  return Number(trade.pnl) / risk;
}

export function fmtR(n) {
  if (n == null || !isFinite(n)) return '—';
  const sign = n >= 0 ? '' : '-';
  return `${sign}${Math.abs(n).toFixed(2)}R`;
}
