// Release Journal schema (dashboard side).
//
// This project is plain JS, so the schema lives here as JSDoc typedefs +
// runtime constants + defensive normalizers. The canonical TypeScript copy
// (the contract the separate worker emits) is at:
//   release-journal-worker/schema/releaseJournalSchema.ts
// Keep the two loosely in sync. The dashboard only *consumes* completed
// journal packages — it never records screenshots / market data itself.
//
// Phase 1 scope: types + a safe normalizer so the viewer can't crash on
// partial sample data, plus a small per-event aggregator for the Playbook
// cards. No screenshot / headline automation here.

import { normalizeEventKey } from './events';

// ── Enumerations (mirror the worker schema) ─────────────────────────────────
export const RELEASE_TEMPLATES = [
  'inflation_release', 'labor_release', 'pmi_release', 'growth_release',
  'central_bank', 'auction', 'mixed_macro', 'custom'
];
export const IMPORTANCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'A_PLUS'];
export const ASSET_ROLES = ['PRIMARY', 'SECONDARY', 'CONFIRMATION', 'SPREAD_LEG'];
export const GRADES = ['A+', 'A', 'B', 'C', 'D'];
export const SCREENSHOT_TYPES = [
  'PRE_RELEASE', 'RELEASE_NUMBERS', 'RELEASE_IMPULSE', 'PEAK_1',
  'MAE_BETWEEN_PEAKS', 'PEAK_2', 'HOLDING_END', 'COMPOSITE', 'OTHER'
];
export const HEADLINE_RELEVANCE = ['HIGH', 'MEDIUM', 'LOW'];
export const HOLDING_STYLES = [
  'SCALP_TO_PEAK_1', 'HOLD_TO_PEAK_2', 'CONFIRMATION_ENTRY_ONLY',
  'AVOID_HIGH_MAE', 'NO_TRADE'
];

// ── JSDoc typedefs (documentation / editor hints) ───────────────────────────
/**
 * @typedef {Object} ReleasePeak
 * @property {string} [timestamp]
 * @property {number} [price]
 * @property {number} [ticksFromEntry]
 * @property {number} [secondsFromRelease]
 * @property {string} [notes]
 */
/**
 * @typedef {Object} ReleaseJournalScreenshot
 * @property {string} type           one of SCREENSHOT_TYPES
 * @property {string} [timestamp]
 * @property {string} [path]         relative path inside the journal package
 * @property {string} [notes]
 */
/**
 * @typedef {Object} ReleaseJournalHeadline
 * @property {string} [timestamp]
 * @property {string} text
 * @property {string} [source]       FINANCIALJUICE | MANUAL | OTHER
 * @property {string} relevance      HIGH | MEDIUM | LOW
 * @property {string} [category]
 * @property {boolean} possibleNewInformationEvent
 * @property {string} [likelyMarketEffect]
 */
/**
 * @typedef {Object} ReleaseJournalAsset
 * @property {string} symbol
 * @property {string} role           one of ASSET_ROLES
 * @property {string} [source]
 * @property {string} [direction]    LONG | SHORT | MIXED | NONE
 * @property {Object} [entryModels]
 * @property {Object} [peaks]
 * @property {Object} [excursions]
 * @property {Object} [rr]
 * @property {Object} [classification]
 * @property {ReleaseJournalScreenshot[]} screenshots
 * @property {string} [notes]
 */
/**
 * @typedef {Object} ReleaseJournalSummary
 * @property {string} [bestAsset]
 * @property {string} [secondBestAsset]
 * @property {string} [worstAsset]
 * @property {string} [bestHoldingStyle]
 * @property {boolean} [keyHeadlineInterference]
 * @property {string} finalTakeaway
 * @property {string} [learningNote]
 */
/**
 * @typedef {Object} ReleaseJournal
 * @property {string} releaseId
 * @property {string} releaseKey
 * @property {string} releaseName
 * @property {string} [region]
 * @property {string} [scheduledTime]
 * @property {string} [actualReleaseTime]
 * @property {string} releaseTemplate
 * @property {string} importance
 * @property {Object} [holdingWindow]
 * @property {Object} numbers
 * @property {ReleaseJournalAsset[]} trackedAssets
 * @property {ReleaseJournalHeadline[]} headlines
 * @property {ReleaseJournalSummary} summary
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

// ── Badge tone helpers (map to existing Tailwind accent tokens) ─────────────
export function gradeTone(grade) {
  if (!grade) return 'muted';
  if (/^A/.test(grade)) return 'green';
  if (/^B/.test(grade)) return 'yellow';
  return 'red'; // C / D
}

export function relevanceTone(rel) {
  if (rel === 'HIGH') return 'red';
  if (rel === 'MEDIUM') return 'yellow';
  return 'muted';
}

export function importanceTone(importance) {
  if (importance === 'A_PLUS' || importance === 'HIGH') return 'green';
  if (importance === 'MEDIUM') return 'yellow';
  return 'muted';
}

// ── Defensive normalizer ────────────────────────────────────────────────────
// Sample/imported packages may be partial. Coerce to a shape the viewer can
// render without optional-chaining everywhere or throwing on a missing array.
const uid = () => Math.random().toString(36).slice(2, 10);

export function normalizeReleaseJournal(raw) {
  const j = raw && typeof raw === 'object' ? raw : {};
  const trackedAssets = Array.isArray(j.trackedAssets) ? j.trackedAssets : [];
  return {
    releaseId: j.releaseId || `${normalizeEventKey(j.releaseKey || j.releaseName || 'release')}_${j.scheduledTime || uid()}`,
    releaseKey: j.releaseKey || j.releaseName || 'Untitled release',
    releaseName: j.releaseName || j.releaseKey || 'Untitled release',
    region: j.region || '',
    scheduledTime: j.scheduledTime || '',
    actualReleaseTime: j.actualReleaseTime || '',
    releaseTemplate: j.releaseTemplate || 'custom',
    importance: j.importance || 'MEDIUM',
    holdingWindow: j.holdingWindow || {},
    numbers: {
      lines: Array.isArray(j.numbers?.lines) ? j.numbers.lines : [],
      aggregateSurpriseScore: j.numbers?.aggregateSurpriseScore,
      interpretation: j.numbers?.interpretation || ''
    },
    trackedAssets: trackedAssets.map(a => ({
      symbol: a?.symbol || '?',
      role: a?.role || 'SECONDARY',
      source: a?.source,
      direction: a?.direction || 'NONE',
      entryModels: a?.entryModels || {},
      peaks: a?.peaks || {},
      excursions: a?.excursions || {},
      rr: a?.rr || {},
      classification: a?.classification || {},
      // Phase 6 per-asset enrichment (present only on a templateId-driven release).
      expected: a?.expected || null,
      legAnalysis: a?.legAnalysis || null,
      comparison: a?.comparison || null,
      screenshots: Array.isArray(a?.screenshots) ? a.screenshots : [],
      notes: a?.notes || ''
    })),
    headlines: Array.isArray(j.headlines) ? j.headlines : [],
    summary: {
      bestAsset: j.summary?.bestAsset || '',
      secondBestAsset: j.summary?.secondBestAsset || '',
      worstAsset: j.summary?.worstAsset || '',
      bestHoldingStyle: j.summary?.bestHoldingStyle || '',
      keyHeadlineInterference: !!j.summary?.keyHeadlineInterference,
      finalTakeaway: j.summary?.finalTakeaway || '',
      learningNote: j.summary?.learningNote || ''
    },
    // Phase 6: scorecard ⇄ behavior review layer (present only when the release
    // was run with a macro_score templateId). Passed through defensively.
    templateId: j.templateId || '',
    expected: j.expected && typeof j.expected === 'object' ? j.expected : null,
    comparison: j.comparison && typeof j.comparison === 'object' ? j.comparison : null,
    suggestedAdjustments: Array.isArray(j.suggestedAdjustments) ? j.suggestedAdjustments : [],
    createdAt: j.createdAt || new Date().toISOString(),
    updatedAt: j.updatedAt || j.createdAt || new Date().toISOString()
  };
}

// True if an imported journal belongs to a given Playbook event key
// (normalization-tolerant, same rule the morning-prep agent uses).
export function journalMatchesEventKey(journal, eventKey) {
  if (!journal || !eventKey) return false;
  return normalizeEventKey(journal.releaseKey) === normalizeEventKey(eventKey);
}

// ── Per-event aggregation for the Playbook cards ────────────────────────────
const GRADE_SCORE = { 'A+': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
const SCORE_GRADE = { 5: 'A+', 4: 'A', 3: 'B', 2: 'C', 1: 'D' };
const MAE_SCORE = { LOW_MAE: 1, MODERATE_MAE: 2, HIGH_MAE: 3, EXTREME_MAE: 4 };
const MAE_LABEL = { 1: 'Low', 2: 'Moderate', 3: 'High', 4: 'Extreme' };

function primaryAsset(journal) {
  const a = journal.trackedAssets || [];
  return a.find(x => x.role === 'PRIMARY') || a[0] || null;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Roll up every imported journal for one event key into the compact stats the
// EventCard shows ("Auto reviews: X · Best asset · Avg MAE · Peak R/R …").
// Returns null when there are no journals for the key.
export function summarizeJournals(journals) {
  if (!journals || !journals.length) return null;
  const sorted = [...journals].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''));
  const latest = sorted[0];

  const primaries = journals.map(primaryAsset).filter(Boolean);
  const peak1 = primaries.map(p => p.rr?.peak1Standard).filter(n => Number.isFinite(n));
  const peak2 = primaries.map(p => p.rr?.peak2Standard).filter(n => Number.isFinite(n));
  const maeScores = primaries
    .map(p => MAE_SCORE[p.classification?.maeQuality])
    .filter(n => Number.isFinite(n));

  const avgMae = mean(maeScores);
  const latestPrimary = primaryAsset(latest);

  // Phase 6: scorecard hit-rate across the journals that carry a comparison.
  const withCmp = journals.filter(j => j.comparison?.overall);
  const biasHits = withCmp.filter(j => j.comparison.overall.expectedBiasHit).length;

  return {
    count: journals.length,
    bestAsset: latest.summary?.bestAsset || '',
    avgMaeLabel: avgMae == null ? null : MAE_LABEL[Math.round(avgMae)],
    avgPeak1RR: mean(peak1),
    avgPeak2RR: mean(peak2),
    headlineInterferenceCount: journals.filter(j => j.summary?.keyHeadlineInterference).length,
    latestGrade: latestPrimary?.classification?.tradabilityGrade || null,
    // Expected-bias hit-rate (null when no journal for this key carries a scorecard
    // comparison), plus the latest release's overall comparison for the card.
    reviewCount: withCmp.length,
    expectedBiasHitRate: withCmp.length ? biasHits / withCmp.length : null,
    latestComparison: latest.comparison?.overall || null
  };
}

// Convenience: group a flat list of journals by normalized event key.
export function groupJournalsByEventKey(journals) {
  const out = {};
  for (const j of journals || []) {
    const k = normalizeEventKey(j.releaseKey);
    if (!k) continue;
    (out[k] ||= []).push(j);
  }
  return out;
}

export { GRADE_SCORE, SCORE_GRADE };
