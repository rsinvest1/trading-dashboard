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
