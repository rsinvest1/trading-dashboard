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

// Normalize a free-text event label to a comparison key: lowercase, collapse
// any run of non-alphanumeric chars to a single underscore, trim edges.
export function normalizeEventKey(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
