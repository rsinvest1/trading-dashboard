function parseDateTime(s) {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let [, mo, d, y, h, mn, sc, ap] = m;
  h = parseInt(h, 10);
  if (ap) {
    const u = ap.toUpperCase();
    if (u === 'PM' && h !== 12) h += 12;
    if (u === 'AM' && h === 12) h = 0;
  }
  return new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10),
                  h, parseInt(mn, 10), parseInt(sc || '0', 10));
}

function splitCsvLine(line) {
  // Naive split — Quantower exports don't quote commas in this format.
  return line.split(',');
}

export function parseQuantowerCsv(text) {
  // Strip UTF-8 BOM if present (Quantower exports include one).
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { fills: [], errors: ['Empty CSV'] };

  const header = splitCsvLine(lines[0]).map(h => h.trim());
  const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const cols = {
    account:   idx('Account'),
    datetime:  idx('Date/Time'),
    symbol:    idx('Symbol'),
    side:      idx('Side'),
    orderType: idx('Order type'),
    quantity:  idx('Quantity'),
    price:     idx('Price'),
    gross:     idx('Gross P/L'),
    fee:       idx('Fee'),
    net:       idx('Net P/L'),
    comment:   idx('Comment')
  };

  const required = ['account', 'datetime', 'symbol', 'side', 'quantity', 'price', 'net'];
  const missing = required.filter(k => cols[k] === -1);
  if (missing.length) {
    return { fills: [], errors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const fills = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const dt = parseDateTime(cells[cols.datetime]);
    if (!dt) { errors.push(`Row ${i + 1}: bad date "${cells[cols.datetime]}"`); continue; }
    const qty = Number(cells[cols.quantity]);
    if (isNaN(qty) || qty === 0) continue;

    fills.push({
      account:   cells[cols.account]?.trim(),
      datetime:  dt,
      symbol:    cells[cols.symbol]?.trim(),
      side:      cells[cols.side]?.trim(),
      orderType: cells[cols.orderType]?.trim() ?? '',
      quantity:  qty,
      price:     Number(cells[cols.price]),
      grossPnL:  Number(cells[cols.gross] ?? 0),
      fee:       Number(cells[cols.fee] ?? 0),
      netPnL:    Number(cells[cols.net]),
      comment:   cols.comment >= 0 ? (cells[cols.comment]?.trim() ?? '') : '',
      _row:      i
    });
  }
  return { fills, errors };
}

// ── Tradovate (Performance → Trades) support ──────────────────────────────

// Quote-aware CSV split. Tradovate quotes fields that contain commas
// (e.g. "$1,234.56"), which the naive splitter above would mangle.
function splitCsvLineQuoted(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// "$1,234.56" / "(45.00)" / "-12.3" → number. Parentheses mean negative.
function parseMoney(s) {
  if (s == null) return NaN;
  let t = String(s).trim();
  if (!t) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[$,\s]/g, '');
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  const n = Number(t);
  if (isNaN(n)) return NaN;
  return neg ? -n : n;
}

// Try the Quantower M/D/YYYY format first, then fall back to native Date
// parsing (handles ISO 8601 timestamps Tradovate may emit).
function parseFlexDateTime(s) {
  const d = parseDateTime(s);
  if (d) return d;
  if (!s) return null;
  const nd = new Date(String(s).trim());
  return isNaN(nd.getTime()) ? null : nd;
}

// Parse a Tradovate "Performance → Trades" export. Each row is a closed
// round-trip (buy fill paired with sell fill). We emit TWO fills per row — an
// opening buy and a closing sell — so the existing aggregateFills()/makeTrade()
// pipeline derives side, entry/exit, duration, P&L and the dedupe fingerprint
// exactly as it does for Quantower fills. P&L and fees ride the closing fill.
export function parseTradovateCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { fills: [], errors: ['Empty CSV'] };

  const header = splitCsvLineQuoted(lines[0]).map(h => h.trim());
  const idxOf = (...aliases) => {
    const set = aliases.map(a => a.toLowerCase());
    return header.findIndex(h => set.includes(h.toLowerCase()));
  };
  const cols = {
    symbol:  idxOf('symbol', 'Contract', 'Instrument'),
    qty:     idxOf('qty', 'Quantity', 'filledQty'),
    buy:     idxOf('buyPrice', 'Buy Price'),
    sell:    idxOf('sellPrice', 'Sell Price'),
    pnl:     idxOf('pnl', 'P&L', 'P/L', 'realizedPnl', 'Net P/L'),
    bought:  idxOf('boughtTimestamp', 'Bought Timestamp', 'Buy Time'),
    sold:    idxOf('soldTimestamp', 'Sold Timestamp', 'Sell Time'),
    account: idxOf('account', 'accountName'),
    fee:     idxOf('fee', 'commission')
  };

  const requiredKeys = ['symbol', 'qty', 'buy', 'sell', 'pnl', 'bought', 'sold'];
  const missing = requiredKeys.filter(k => cols[k] === -1);
  if (missing.length) {
    return { fills: [], errors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const fills = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLineQuoted(lines[i]);
    const qty = Math.abs(Number(cells[cols.qty]));
    if (isNaN(qty) || qty === 0) continue;
    const bought = parseFlexDateTime(cells[cols.bought]);
    const sold   = parseFlexDateTime(cells[cols.sold]);
    if (!bought || !sold) { errors.push(`Row ${i + 1}: bad timestamp`); continue; }
    const buyPrice  = Number(cells[cols.buy]);
    const sellPrice = Number(cells[cols.sell]);
    const pnl = parseMoney(cells[cols.pnl]);
    if (isNaN(buyPrice) || isNaN(sellPrice) || isNaN(pnl)) {
      errors.push(`Row ${i + 1}: bad price/pnl`); continue;
    }
    const symbol  = cells[cols.symbol]?.trim();
    const account = cols.account >= 0 ? (cells[cols.account]?.trim() || 'Tradovate') : 'Tradovate';
    const fee = cols.fee >= 0 ? (parseMoney(cells[cols.fee]) || 0) : 0;

    // Opening buy fill (+qty). Buy gets the higher _row so it sorts before the
    // sell on an exact-timestamp tie (aggregateFills tie-break is b._row - a._row).
    fills.push({
      account, datetime: bought, symbol, side: 'Buy', orderType: '',
      quantity: qty, price: buyPrice, grossPnL: 0, fee: 0, netPnL: 0,
      comment: '', _row: i * 2 + 1
    });
    // Closing sell fill (−qty), carrying the round-trip P&L and fees.
    fills.push({
      account, datetime: sold, symbol, side: 'Sell', orderType: '',
      quantity: -qty, price: sellPrice, grossPnL: pnl, fee, netPnL: pnl,
      comment: '', _row: i * 2
    });
  }
  return { fills, errors };
}

// Parse a Tradovate "Orders" / fills export (per-fill rows; no P&L column).
// Emits standard fills with netPnL:0 and computePnl:true so makeTrade derives
// gross P&L from price × contract point value during aggregation.
export function parseTradovateOrdersCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { fills: [], errors: ['Empty CSV'] };

  const header = splitCsvLineQuoted(lines[0]).map(h => h.trim());
  const idxOf = (...aliases) => {
    const set = aliases.map(a => a.toLowerCase());
    return header.findIndex(h => set.includes(h.toLowerCase()));
  };
  const cols = {
    account: idxOf('Account', 'accountName'),
    side:    idxOf('B/S', 'Buy/Sell', 'Side'),
    symbol:  idxOf('Contract', 'Symbol', 'Instrument'),
    price:   idxOf('Avg Fill Price', 'avgPrice', 'Fill Price', 'Price'),
    qty:     idxOf('Filled Qty', 'filledQty', 'Quantity', 'qty'),
    time:    idxOf('Fill Time', 'Timestamp', 'Date/Time'),
    status:  idxOf('Status')
  };

  const required = ['side', 'symbol', 'price', 'qty', 'time'];
  const missing = required.filter(k => cols[k] === -1);
  if (missing.length) {
    return { fills: [], errors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const fills = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLineQuoted(lines[i]);
    // Only filled orders contribute to round-trips.
    if (cols.status >= 0) {
      const st = (cells[cols.status] || '').trim().toLowerCase();
      if (st && st !== 'filled') continue;
    }
    const bs = (cells[cols.side] || '').trim().toLowerCase();
    const dir = bs.startsWith('b') ? 1 : bs.startsWith('s') ? -1 : 0;
    if (!dir) continue;
    const qty = Math.abs(Number(cells[cols.qty]));
    if (isNaN(qty) || qty === 0) continue;
    const price = Number(cells[cols.price]);
    if (isNaN(price)) { errors.push(`Row ${i + 1}: bad price`); continue; }
    const dt = parseFlexDateTime(cells[cols.time]);
    if (!dt) { errors.push(`Row ${i + 1}: bad time`); continue; }
    const symbol = (cells[cols.symbol] || '').trim();
    const account = cols.account >= 0 ? ((cells[cols.account] || '').trim() || 'Tradovate') : 'Tradovate';

    fills.push({
      account, datetime: dt, symbol, side: dir > 0 ? 'Buy' : 'Sell', orderType: '',
      quantity: dir * qty, price, grossPnL: 0, fee: 0, netPnL: 0,
      comment: '', computePnl: true, _row: i
    });
  }
  return { fills, errors };
}

// Sniff the header row and route to the matching parser.
export function detectAndParse(text) {
  let probe = text;
  if (probe.charCodeAt(0) === 0xFEFF) probe = probe.slice(1);
  const firstLine = (probe.split(/\r?\n/, 1)[0] || '').toLowerCase();
  // Tradovate Performance → Trades (realized P&L per round-trip)
  if (firstLine.includes('boughttimestamp') ||
      (firstLine.includes('buyprice') && firstLine.includes('sellprice'))) {
    return { ...parseTradovateCsv(text), format: 'tradovate-trades' };
  }
  // Tradovate Orders / fills export (per-fill; no P&L → computed from prices)
  if (firstLine.includes('b/s') && firstLine.includes('contract')) {
    return { ...parseTradovateOrdersCsv(text), format: 'tradovate-orders' };
  }
  return { ...parseQuantowerCsv(text), format: 'quantower' };
}
