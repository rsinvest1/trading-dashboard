// Position-based aggregation for incoming deal events.
//
// Each event represents a single deal (fill). Multiple deals for the same
// `position_id` form a round-trip trade. We emit a *completed* trade only
// when a deal arrives with `is_closing: true` AND the running net quantity
// returns to zero.
//
// Pure functions — state is held by the caller (the store).

import { tickerFromSymbol } from './instruments';

/**
 * Aggregate a list of deals belonging to one position_id into a single
 * round-trip trade record matching our existing trade schema.
 */
export function aggregateDeals(deals) {
  if (!deals?.length) return null;
  const first = deals[0];
  const sorted = [...deals].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Determine net direction from the first deal (longs open with +qty, shorts with -qty).
  // Quantower events use direction: 'buy' | 'sell'. We treat opening direction as long if buy.
  const opening = sorted[0];
  const isLong = opening.direction === 'buy';
  const sideLabel = isLong ? 'Long' : 'Short';

  const opens  = sorted.filter(d => (isLong ? d.direction === 'buy'  : d.direction === 'sell'));
  const closes = sorted.filter(d => (isLong ? d.direction === 'sell' : d.direction === 'buy'));

  const openQty  = opens .reduce((s, d) => s + Math.abs(Number(d.quantity) || 0), 0);
  const closeQty = closes.reduce((s, d) => s + Math.abs(Number(d.quantity) || 0), 0);
  const entry = openQty
    ? opens .reduce((s, d) => s + Number(d.price) * Math.abs(Number(d.quantity)), 0) / openQty
    : null;
  const exit  = closeQty
    ? closes.reduce((s, d) => s + Number(d.price) * Math.abs(Number(d.quantity)), 0) / closeQty
    : null;

  const pnl  = sorted.reduce((s, d) => s + (Number(d.pnl)  || 0), 0);
  const fees = sorted.reduce((s, d) => s + (Number(d.fees) || 0), 0);

  const dt = new Date(opening.timestamp);
  const date = dt.toISOString().slice(0, 10);
  const time = dt.toTimeString().slice(0, 5);

  return {
    position_id: first.position_id,
    event_ids:   sorted.map(d => d.event_id),
    date,
    time,
    ticker:    tickerFromSymbol(first.instrument),
    symbol:    first.instrument,
    side:      sideLabel,
    contracts: openQty,
    entry:     entry != null ? Number(entry.toFixed(4)) : null,
    exit:      exit  != null ? Number(exit.toFixed(4))  : null,
    pnl:       Number(pnl.toFixed(2)),
    fees:      Number(fees.toFixed(2)),
    fills_count: sorted.length,
    source:    'webhook',
    notes:     null
  };
}

/**
 * Process a batch of newly-arrived events against a `positions` map
 * (keyed by position_id) and return:
 *   - updated positions map
 *   - completed trades emitted by this batch
 *
 * `positions[id] = { deals: [...], net_qty: number }`
 *
 * A position emits a completed trade when a deal with `is_closing: true`
 * arrives AND the running net qty drops to zero. This handles partial
 * scale-outs (multiple closing deals before flat).
 */
export function applyEvents(positions, events) {
  const out = { ...positions };
  const completed = [];

  for (const ev of events) {
    if (ev.type && ev.type !== 'deal') continue;
    const pid = ev.position_id;
    if (!pid) continue;

    const sign = ev.direction === 'buy' ? 1 : -1;
    const qty  = Math.abs(Number(ev.quantity) || 0);

    let pos = out[pid];
    if (!pos) {
      pos = { deals: [], net_qty: 0, opened_at: ev.timestamp };
      out[pid] = pos;
    }

    pos.deals.push(ev);
    pos.net_qty += sign * qty;

    const flat = Math.abs(pos.net_qty) < 1e-9;
    if (ev.is_closing && flat) {
      const trade = aggregateDeals(pos.deals);
      if (trade) completed.push(trade);
      delete out[pid];
    }
  }

  return { positions: out, completed };
}
