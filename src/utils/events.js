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
  // US — labor & growth
  'Nonfarm Payrolls',
  'US CPI',
  'US Core CPI',
  'US PPI',
  'US PCE',
  'US Retail Sales',
  'US GDP',
  'JOLTS Job Openings',
  'Initial Jobless Claims',
  'US Continued Jobless Claims',
  'ADP Employment Change',
  // US — surveys
  'ISM Manufacturing PMI',
  'ISM Services PMI',
  'University of Michigan Sentiment',
  'Consumer Confidence',
  // US — Fed (text releases: manual playbook)
  'FOMC Statement',
  'FOMC Minutes',
  'Fed Chair Press Conference',
  // Energy / agriculture
  'EIA Crude Oil Inventories',
  'EIA Natural Gas Storage',
  'WASDE',
  // Treasury auctions
  'US 2-Year Note Auction',
  'US 10-Year Note Auction',
  'US 20-Year Bond Auction',
  'US 30-Year Bond Auction',
  // International
  'Australia Employment Report',
  'Australia CPI',
  'Japan GDP',
  'UK CPI',
  'Canada Employment Report',
  'ECB Rate Decision'
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
