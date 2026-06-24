// instruments — tick-size table + bond metadata (Phase 6).
//
// Pure data + lookups, no I/O. Day-schedule asset configs can omit `tickSize`
// and let the builder fill it from here, so the journal stays consistent with
// the dashboard's instruments.js. Symbols are the base roots the scorecard and
// tee use (e.g. 'UB', 'NQ', 'RTY', 'GC', '6E') — not month/year contract codes.

export const TICK_SIZES: Record<string, number> = {
  // Bonds (ETF account only — see ETF_ONLY_SYMBOLS). 1/32 / 1/64 / 1/128 ticks.
  UB: 0.03125,   // Ultra T-Bond, 1/32, $31.25/tick — Ricardo's primary bond proxy
  ZB: 0.03125,   // 30Y T-Bond, 1/32
  ZN: 0.015625,  // 10Y T-Note, 1/64
  TN: 0.015625,  // Ultra 10Y, 1/64
  ZF: 0.0078125, // 5Y T-Note, 1/128
  ZT: 0.0078125, // 2Y T-Note, 1/128
  // Equity index
  NQ: 0.25, MNQ: 0.25, ES: 0.25, MES: 0.25, RTY: 0.1, M2K: 0.1, YM: 1, MYM: 1, NKD: 5,
  // Metals / energy
  GC: 0.1, MGC: 0.1, SI: 0.005, HG: 0.0005, CL: 0.01, MCL: 0.01, NG: 0.001,
  // FX
  '6E': 0.00005, '6C': 0.00005, '6B': 0.0001, '6J': 0.0000005, '6A': 0.00005,
};

// Bonds are tradable ONLY on the ETF (Elite Trader Funding) account. On the prop
// firms (Tradeify/Daytraders) they stay confirmation-only / banned. UB is the
// primary execution proxy; the rest are confirmation context.
export const ETF_ONLY_SYMBOLS = new Set(['UB', 'ZB', 'ZN', 'TN', 'ZF', 'ZT']);

// Normalize a journal/scorecard symbol to its TICK_SIZES key. Uppercases and, for
// equity-style roots with a trailing month/year code (e.g. 'NQM6'), falls back to
// the leading-letters root. FX roots ('6E') and exact matches pass through.
export function normalizeSymbol(symbol: string): string {
  const s = (symbol || '').toUpperCase().trim();
  if (TICK_SIZES[s] != null) return s;
  // Strip a trailing single month letter + 1-2 digit year (e.g. NQM26 → NQ).
  const m = s.match(/^([A-Z0-9]{1,3}?)[FGHJKMNQUVXZ]\d{1,2}$/);
  if (m && TICK_SIZES[m[1]] != null) return m[1];
  return s;
}

// Tick size for a symbol; `fallback` (default 1) when unknown so callers degrade
// gracefully rather than dividing by an undefined increment.
export function tickSizeFor(symbol: string, fallback = 1): number {
  return TICK_SIZES[normalizeSymbol(symbol)] ?? fallback;
}

// Whether a symbol is a bond future that may only be traded on the ETF account.
export function isEtfOnly(symbol: string): boolean {
  return ETF_ONLY_SYMBOLS.has(normalizeSymbol(symbol));
}
