export const INSTRUMENTS = {
  NQ:  { name: 'Nasdaq-100',   pointValue: 20 },
  MNQ: { name: 'Micro Nasdaq', pointValue: 2 },
  ES:  { name: 'S&P 500',      pointValue: 50 },
  MES: { name: 'Micro S&P',    pointValue: 5 },
  RTY: { name: 'Russell 2000', pointValue: 50 },
  M2K: { name: 'Micro Russell',pointValue: 5 },
  YM:  { name: 'Dow',          pointValue: 5 },
  MYM: { name: 'Micro Dow',    pointValue: 0.5 },
  GC:  { name: 'Gold',         pointValue: 100 },
  MGC: { name: 'Micro Gold',   pointValue: 10 },
  SI:  { name: 'Silver',       pointValue: 5000 },
  SIL: { name: 'Mini Silver',  pointValue: 1000 },
  CL:  { name: 'Crude Oil',    pointValue: 1000 },
  MCL: { name: 'Micro Crude',  pointValue: 100 },
  ZS:  { name: 'Soybeans',     pointValue: 50 },
  ZC:  { name: 'Corn',         pointValue: 50 },
  ZW:  { name: 'Wheat',        pointValue: 50 },
  NG:  { name: 'Natural Gas',  pointValue: 10000 },
  NKD: { name: 'Nikkei 225 ($)', pointValue: 5 },
  HG:  { name: 'Copper',       pointValue: 25000 },
  // US Treasury futures (ETF allows bonds). 1.0 price point = pointValue $.
  ZT:  { name: '2-Year T-Note',  pointValue: 2000 },
  ZF:  { name: '5-Year T-Note',  pointValue: 1000 },
  ZN:  { name: '10-Year T-Note', pointValue: 1000 },
  TN:  { name: 'Ultra 10Y T-Note', pointValue: 1000 },
  ZB:  { name: '30-Year T-Bond', pointValue: 1000 },
  UB:  { name: 'Ultra T-Bond',   pointValue: 1000 },
  '6A': { name: 'AUD/USD',     pointValue: 100000 },
  '6J': { name: 'JPY/USD',     pointValue: 12500000 },
  '6B': { name: 'GBP/USD',     pointValue: 62500 },
  '6E': { name: 'EUR/USD',     pointValue: 125000 },
  '6C': { name: 'CAD/USD',     pointValue: 100000 },
  '6S': { name: 'CHF/USD',     pointValue: 125000 },
  '6N': { name: 'NZD/USD',     pointValue: 100000 }
};

export const TICKERS = Object.keys(INSTRUMENTS);

export function pointValue(ticker) {
  return INSTRUMENTS[ticker]?.pointValue ?? 1;
}

// Elite Trader Funding futures commission — charged PER SIDE, PER CONTRACT (USD).
// Used to convert the gross P&L computed from a Tradovate Orders export into net
// (entry fill + exit fill are each one side). Tickers not listed default to 0,
// so P&L stays gross until a rate is filled in. <<FILL FROM ETF SCHEDULE>>
export const COMMISSION_PER_SIDE = {
  // e.g. MNQ: 0.37, NQ: 0.85, RTY: 0.85, ZN: 0.90, ...
};

export function commissionPerSide(ticker) {
  return COMMISSION_PER_SIDE[ticker] ?? 0;
}

// Ordered longest-first so prefix matching prefers micros and multi-letter roots.
const TICKER_PREFIXES = [
  'MNQ', 'MGC', 'MCL', 'MES', 'MYM', 'M2K', 'SIL', 'NKD',
  'NQ', 'ES', 'GC', 'CL', 'YM', 'ZS', 'ZC', 'ZW', 'SI', 'RTY', 'NG', 'HG',
  'ZT', 'ZF', 'ZN', 'TN', 'ZB', 'UB',
  '6A', '6J', '6B', '6E', '6C', '6S', '6N'
];

export function tickerFromSymbol(symbol) {
  if (!symbol) return symbol;
  const s = symbol.toUpperCase();
  for (const p of TICKER_PREFIXES) {
    if (s.startsWith(p)) return p;
  }
  return s;
}
