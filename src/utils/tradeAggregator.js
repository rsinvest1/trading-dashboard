import { tickerFromSymbol } from './instruments';

export function tradeFingerprint(t) {
  return [
    t.symbol ?? '',
    t.date   ?? '',
    t.time   ?? '',
    t.side   ?? '',
    t.contracts ?? '',
    t.entry  ?? '',
    t.exit   ?? '',
    t.pnl    ?? ''
  ].join('|');
}

function pad(n) { return String(n).padStart(2, '0'); }

function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStr(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeTrade(fills, account, symbol, side) {
  const opens  = fills.filter(f => (side === 'long' ? f.quantity > 0 : f.quantity < 0));
  const closes = fills.filter(f => (side === 'long' ? f.quantity < 0 : f.quantity > 0));

  const openContracts  = opens.reduce((s, f) => s + Math.abs(f.quantity), 0);
  const closeContracts = closes.reduce((s, f) => s + Math.abs(f.quantity), 0);

  const entryPrice = openContracts
    ? opens.reduce((s, f) => s + f.price * Math.abs(f.quantity), 0) / openContracts
    : null;
  const exitPrice = closeContracts
    ? closes.reduce((s, f) => s + f.price * Math.abs(f.quantity), 0) / closeContracts
    : null;

  const totalNet = fills.reduce((s, f) => s + f.netPnL, 0);
  const totalFee = fills.reduce((s, f) => s + f.fee, 0);
  const first = fills[0];

  const comments = [...new Set(
    fills.map(f => (f.comment || '').trim()).filter(c => c.length > 0)
  )];

  const date = dateStr(first.datetime);
  const time = timeStr(first.datetime);
  // Hold time: first fill (open) → last fill (close). Fills arrive chronological.
  const last = fills[fills.length - 1];
  const duration_sec = (first?.datetime && last?.datetime)
    ? Math.max(0, Math.round((last.datetime - first.datetime) / 1000))
    : null;
  const entry = entryPrice != null ? Number(entryPrice.toFixed(4)) : null;
  const exit  = exitPrice  != null ? Number(exitPrice.toFixed(4))  : null;
  const pnl   = Number(totalNet.toFixed(2));

  // Stable fingerprint for dedupe across re-imports.
  // Account-independent so we can recompute it for legacy trades that pre-date this field.
  const fingerprint = tradeFingerprint({
    symbol, date, time,
    side: side === 'long' ? 'Long' : 'Short',
    contracts: openContracts, entry, exit, pnl
  });

  return {
    account_id_raw: account,
    fingerprint,
    date,
    time,
    ticker:  tickerFromSymbol(symbol),
    symbol,
    side:    side === 'long' ? 'Long' : 'Short',
    contracts: openContracts,
    entry,
    exit,
    duration_sec,
    stop_loss_dollars: null,
    pnl,
    fees:    Number(totalFee.toFixed(2)),
    rr_actual: null,
    setup_id: null,
    execution_rating: null,
    screenshot: null,
    notes:   comments.join(' · ') || null,
    fills_count: fills.length,
    source: 'csv',
    // ── New schema fields (v1) ─────────────────────────────────────────
    tp_levels: [],
    sl_levels: [],
    planned_target_dollars: null,
    planned_risk_dollars: null,
    tags: {},                 // { [categoryId]: [tagId, ...] }
    strategy_id: null,
    rules_followed: [],
    playbook_id: null
  };
}

/**
 * Aggregate per-fill rows into round-trip trades.
 * Position tracker per (account, symbol). A trade is the span of fills from
 * flat → flat. Reversal in a single fill is not split; rare in Quantower exports.
 */
export function aggregateFills(fills) {
  const sorted = [...fills].sort((a, b) => {
    const dt = a.datetime - b.datetime;
    if (dt !== 0) return dt;
    // CSV is newest-first → invert original row index for stable chrono order within ties
    return b._row - a._row;
  });

  const positions = new Map();
  const trades = [];

  for (const fill of sorted) {
    const key = `${fill.account}|${fill.symbol}`;
    let pos = positions.get(key);

    if (!pos) {
      positions.set(key, {
        qty: fill.quantity,
        side: fill.quantity > 0 ? 'long' : 'short',
        fills: [fill]
      });
      continue;
    }

    pos.fills.push(fill);
    pos.qty += fill.quantity;

    if (pos.qty === 0) {
      trades.push(makeTrade(pos.fills, fill.account, fill.symbol, pos.side));
      positions.delete(key);
    }
  }

  // Open positions (no flat close yet) — emit as "open" trades with null exit.
  for (const [key, pos] of positions) {
    const [account, symbol] = key.split('|');
    const t = makeTrade(pos.fills, account, symbol, pos.side);
    t.exit = null;
    t.open = true;
    trades.push(t);
  }

  return trades;
}

/**
 * Auto-map raw account strings from CSV to seeded account ids.
 * FRTL... → Tradeify; S2F-DT-... → Daytraders.
 */
export function defaultAccountMap(rawAccounts, accounts) {
  const map = {};
  const tradeify   = accounts.find(a => /tradeify/i.test(a.firm_name));
  const daytraders = accounts.find(a => /daytraders/i.test(a.firm_name));
  for (const raw of rawAccounts) {
    if (/^FRTL/i.test(raw) && tradeify)   map[raw] = tradeify.id;
    else if (/^S2F-DT/i.test(raw) && daytraders) map[raw] = daytraders.id;
    else map[raw] = accounts[0]?.id ?? null;
  }
  return map;
}
