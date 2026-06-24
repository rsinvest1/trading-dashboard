// Canonical high-impact economic-release event keys.
//
// These mirror the `name` values in C:\RSInvest\signals\release_definitions.json
// so a Playbook tagged with one of these keys can be matched, by the
// autonomous morning-prep agent, to today's scheduled release and its prior
// history. Keep this list loosely in sync with that definitions library.
//
// Matching is normalization-tolerant (see normalizeEventKey) so minor drift in
// punctuation / casing between the two sides still resolves.

export const EVENT_KEYS = [
  // US — labor & growth (financialjuice-exact names first, legacy aliases below)
  'US Nonfarm Payrolls',
  'Nonfarm Payrolls',
  'US CPI YoY',
  'US CPI MoM',
  'US CPI',
  'US Core CPI YoY',
  'US Core CPI MoM',
  'US Core CPI',
  'US PPI YoY',
  'US PPI MoM',
  'US PPI',
  'US PCE YoY',
  'US PCE MoM',
  'US PCE',
  'US Core PCE YoY',
  'US Core PCE MoM',
  'US Retail Sales MoM',
  'US Retail Sales',
  'US GDP QoQ',
  'US GDP',
  'JOLTS Job Openings',
  'US Initial Jobless Claims',
  'Initial Jobless Claims',
  'US Continued Jobless Claims',
  'US ADP Wkly Employment Change',
  'ADP Employment Change',
  // US — surveys
  'ISM Manufacturing PMI',
  'ISM Services PMI',
  'University of Michigan Sentiment',
  'US CB Consumer Confidence',
  'Consumer Confidence',
  'Chicago National Activity Index',
  'US House Price Index YoY',
  'US House Price Index MoM',
  'US CaseShiller 20 YoY',
  // US — Fed
  'FOMC Statement',
  'FOMC Minutes',
  'Fed Chair Press Conference',
  // Energy / agriculture
  'EIA Crude Oil Inventories',
  'EIA Natural Gas Storage',
  'WASDE',
  // Treasury auctions
  'US 2-Year Note Auction',
  'US 2-Year Note High Yield',
  'US 2-Year Note Bid-to-Cover',
  'US 10-Year Note Auction',
  'US 10-Year Note High Yield',
  'US 10-Year Note Bid-to-Cover',
  'US 20-Year Bond Auction',
  'US 30-Year Bond Auction',
  'US 6-Month Bill High Yield',
  'US 6-Month Bill Bid-to-Cover',
  'US 3-Month Bill High Yield',
  'US 3-Month Bill Bid-to-Cover',
  // International
  'Australian CPI YoY NSA',
  'Australian CPI Trimmed Mean YoY',
  'Australia Employment Report',
  'Australia CPI',
  'Japan GDP',
  'UK CPI',
  'Canada Employment Report',
  'ECB Rate Decision',
  'Dallas Fed Mfg Bus Index',
];

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,2}\s+(?:de\s+)?[a-z\u00c0-\u017f]+(?:\s+de)?\s+\d{4}$/i,
  /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+[a-z]+\s+\d{1,2},?\s+\d{4}$/i,
  /^[a-z]+\s+\d{1,2},?\s+\d{4}$/i,
];

const ALIASES = new Map([
  ['retail sales', 'US Retail Sales'],
  ['us retail sales mom may 2026', 'US Retail Sales MoM'],
  ['us pending home sales business inventories', 'US Pending Home Sales'],
  ['pending home sales', 'US Pending Home Sales'],
  ['business inventories', 'US Business Inventories'],
  ['fomc rate decision sep median rate forecasts', 'US Interest Rate Decision'],
  ['fomc rate decision sep median rate forecast', 'US Interest Rate Decision'],
  ['fomc rate statement sep', 'US Interest Rate Decision'],
  ['us interest rate decision', 'US Interest Rate Decision'],
  ['uk cpi inflation', 'UK CPI'],
  ['uk cpi yoy', 'UK CPI'],
]);

const EXTRA_EVENT_KEYS = [
  'US Pending Home Sales',
  'US Business Inventories',
  'US Interest Rate Decision',
];

export const CANONICAL_EVENT_KEYS = [...new Set([...EVENT_KEYS, ...EXTRA_EVENT_KEYS])];

// Normalize a free-text event label to a comparison key: lowercase, collapse
// any run of non-alphanumeric chars to a single underscore, trim edges.
export function normalizeEventKey(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isDateLikeEventKey(s) {
  const text = String(s || '').trim();
  if (!text) return false;
  if (DATE_PATTERNS.some(re => re.test(text))) return true;
  const ts = Date.parse(text.replace(/^\w+,?\s+/, ''));
  if (Number.isNaN(ts)) return false;
  const y = new Date(ts).getFullYear();
  return y >= 2000 && y <= 2100 && /\d{4}/.test(text);
}

export function resolveCanonicalEventKey(label, fallback = '') {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (!text || isDateLikeEventKey(text)) return fallback || '';

  const normalized = normalizeEventKey(text);
  for (const key of CANONICAL_EVENT_KEYS) {
    if (normalizeEventKey(key) === normalized) return key;
  }

  const alias = ALIASES.get(text.toLowerCase()) || ALIASES.get(normalized.replace(/_/g, ' '));
  if (alias) return alias;

  const scored = CANONICAL_EVENT_KEYS
    .map(key => ({ key, norm: normalizeEventKey(key) }))
    .filter(x => normalized.includes(x.norm) || x.norm.includes(normalized))
    .sort((a, b) => b.norm.length - a.norm.length);
  return scored[0]?.key || fallback || text;
}

// Legacy / bare event-key labels that mean the same recurring event as a primary
// financialjuice-style label. Used ONLY for display grouping so a manual playbook
// and an auto-journal that drifted to an equivalent-but-different key share one
// Playbook card. Does not change what is stored, resolved, or exported.
const DISPLAY_SYNONYM_PAIRS = [
  ['Nonfarm Payrolls', 'US Nonfarm Payrolls'],
  ['Initial Jobless Claims', 'US Initial Jobless Claims'],
  ['ADP Employment Change', 'US ADP Wkly Employment Change'],
  ['Consumer Confidence', 'US CB Consumer Confidence'],
  // Auto-journal worker emits "EIA Natural Gas Change BCF"; canonical is the
  // financialjuice "EIA Natural Gas Storage" (Thu 10:30 ET). BCE = common typo.
  ['EIA Natural Gas Change BCF', 'EIA Natural Gas Storage'],
  ['EIA Natural Gas Change BCE', 'EIA Natural Gas Storage'],
];
const SYNONYM_BY_NORM = new Map(
  DISPLAY_SYNONYM_PAIRS.map(([from, to]) => [normalizeEventKey(from), to])
);

// Fold an event_key to the label its Playbook card should group under: collapse
// punctuation/casing drift onto the matching canonical key, and map known legacy
// synonyms to their primary label. Returns the input unchanged when it matches
// nothing — custom keys stay distinct (no fuzzy merging here).
export function eventGroupLabel(eventKey) {
  const raw = String(eventKey || '').trim();
  if (!raw) return '';
  const norm = normalizeEventKey(raw);
  const synonym = SYNONYM_BY_NORM.get(norm);
  if (synonym) return synonym;
  for (const key of CANONICAL_EVENT_KEYS) {
    if (normalizeEventKey(key) === norm) return key;
  }
  return raw;
}
