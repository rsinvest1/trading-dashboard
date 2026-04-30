// Analytics aggregations used by Strengths panel + charts.

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dowOf(iso) {
  return new Date(iso + 'T00:00:00').getDay();
}

function hourOf(time) {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):/);
  return m ? parseInt(m[1], 10) : null;
}

function summarize(trades) {
  let pnl = 0, w = 0, l = 0, gross = 0, lossSum = 0;
  for (const t of trades) {
    const p = Number(t.pnl) || 0;
    pnl += p;
    if (p > 0) { w++; gross += p; }
    else if (p < 0) { l++; lossSum += -p; }
  }
  const wr = (w + l) ? (w / (w + l)) * 100 : 0;
  const pf = lossSum === 0 ? (gross > 0 ? Infinity : 0) : gross / lossSum;
  const exp = trades.length ? pnl / trades.length : 0;
  return { count: trades.length, pnl, wins: w, losses: l, winRate: wr, profitFactor: pf, expectancy: exp };
}

export function groupByKey(trades, getKey) {
  const groups = new Map();
  for (const t of trades) {
    const k = getKey(t);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const result = [];
  for (const [key, list] of groups) {
    result.push({ key, ...summarize(list) });
  }
  return result;
}

export function pnlByTicker(trades) {
  return groupByKey(trades, t => t.ticker)
    .sort((a, b) => b.pnl - a.pnl);
}

export function pnlBySide(trades) {
  return groupByKey(trades, t => t.side);
}

export function pnlByDayOfWeek(trades) {
  const grouped = groupByKey(trades, t => dowOf(t.date));
  const map = new Map(grouped.map(g => [g.key, g]));
  // Mon→Fri only (skip weekends in trading view)
  return [1, 2, 3, 4, 5].map(d => ({
    day: DOW_NAMES[d],
    dow: d,
    ...(map.get(d) || { count: 0, pnl: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0, expectancy: 0 })
  }));
}

export function pnlByHour(trades) {
  const grouped = groupByKey(trades, t => hourOf(t.time));
  const map = new Map(grouped.map(g => [g.key, g]));
  // Hours 6-16 (covers RTH for futures)
  return Array.from({ length: 11 }, (_, i) => i + 6).map(h => ({
    hour: h,
    label: `${h.toString().padStart(2, '0')}:00`,
    ...(map.get(h) || { count: 0, pnl: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0, expectancy: 0 })
  }));
}

export function intradayHeatmap(trades) {
  // 5 days (Mon-Fri) × hours
  const grid = {};
  for (const t of trades) {
    const d = dowOf(t.date);
    if (d < 1 || d > 5) continue;
    const h = hourOf(t.time);
    if (h == null) continue;
    const key = `${d}|${h}`;
    if (!grid[key]) grid[key] = [];
    grid[key].push(t);
  }
  const cells = {};
  for (const [k, list] of Object.entries(grid)) {
    cells[k] = summarize(list);
  }
  return cells;
}

export function pnlByAccount(trades, accounts) {
  const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
  const grouped = groupByKey(trades, t => t.account_id);
  return grouped.map(g => ({
    accountId: g.key,
    label: byId[g.key]?.firm_name?.split(' ')[0] ?? 'Unknown',
    ...g
  })).sort((a, b) => b.pnl - a.pnl);
}

/**
 * Pick the top performer across dimensions to surface as a "strength".
 * Filters out low-sample buckets to avoid flukes.
 */
export function computeStrengths(trades, accounts) {
  if (trades.length < 5) return [];

  const out = [];

  // Best ticker
  const tickers = pnlByTicker(trades).filter(t => t.count >= 5);
  if (tickers.length) {
    const best = tickers[0];
    if (best.pnl > 0) {
      out.push({
        dim: 'Best ticker',
        value: best.key,
        sub: `${best.count} trades · ${best.winRate.toFixed(0)}% WR`,
        pnl: best.pnl,
        tone: 'pos'
      });
    }
  }

  // Best day of week
  const dows = pnlByDayOfWeek(trades).filter(d => d.count >= 5);
  if (dows.length) {
    const best = [...dows].sort((a, b) => b.pnl - a.pnl)[0];
    if (best.pnl > 0) {
      out.push({
        dim: 'Best day',
        value: best.day,
        sub: `${best.count} trades · ${best.winRate.toFixed(0)}% WR`,
        pnl: best.pnl,
        tone: 'pos'
      });
    }
  }

  // Best hour window
  const hours = pnlByHour(trades).filter(h => h.count >= 5);
  if (hours.length) {
    const best = [...hours].sort((a, b) => b.pnl - a.pnl)[0];
    if (best.pnl > 0) {
      out.push({
        dim: 'Best hour',
        value: best.label,
        sub: `${best.count} trades · ${best.winRate.toFixed(0)}% WR`,
        pnl: best.pnl,
        tone: 'pos'
      });
    }
  }

  // Best side
  const sides = pnlBySide(trades).filter(s => s.count >= 5);
  if (sides.length >= 2) {
    const sorted = [...sides].sort((a, b) => b.pnl - a.pnl);
    const best = sorted[0];
    if (best.pnl > 0) {
      out.push({
        dim: 'Best side',
        value: best.key,
        sub: `${best.count} trades · ${best.winRate.toFixed(0)}% WR`,
        pnl: best.pnl,
        tone: 'pos'
      });
    }
  }

  // Best account
  const accs = pnlByAccount(trades, accounts).filter(a => a.count >= 5 && a.accountId);
  if (accs.length >= 2) {
    const best = accs[0];
    if (best.pnl > 0) {
      out.push({
        dim: 'Best account',
        value: best.label,
        sub: `${best.count} trades · ${best.winRate.toFixed(0)}% WR`,
        pnl: best.pnl,
        tone: 'pos'
      });
    }
  }

  // Best ticker × side combo (specific edge)
  const comboGroups = groupByKey(trades, t => `${t.ticker}|${t.side}`).filter(g => g.count >= 5);
  if (comboGroups.length) {
    const best = [...comboGroups].sort((a, b) => b.expectancy - a.expectancy)[0];
    if (best.expectancy > 0 && best.pnl > 0) {
      const [tk, sd] = best.key.split('|');
      out.push({
        dim: 'Top combo',
        value: `${tk} · ${sd}`,
        sub: `${best.count} trades · ${best.winRate.toFixed(0)}% WR`,
        pnl: best.pnl,
        tone: 'pos'
      });
    }
  }

  return out;
}
