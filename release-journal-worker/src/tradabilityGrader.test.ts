// Deterministic unit tests for the Phase 5 review engine. No browser, no feed —
// asset metrics are hand-built so the grades/ranking are reproducible.
//
//   node --test src/tradabilityGrader.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAsset, buildReleaseSummary, gradeRelease } from './tradabilityGrader.ts';
import type { ReleaseJournalAsset } from '../schema/releaseJournalSchema';

// Build a tradeable asset from raw tick metrics (everything the grader reads).
function asset(symbol: string, direction: 'LONG' | 'SHORT', m: {
  mfe1: number; mfe2: number; mae1: number; maeBetween: number; range: number;
  rr1: number; rr2: number; role?: ReleaseJournalAsset['role'];
}): ReleaseJournalAsset {
  return {
    symbol, role: m.role ?? 'PRIMARY', source: 'RITHMIC', direction,
    entryModels: {}, peaks: {}, screenshots: [],
    excursions: {
      mfeToPeak1Ticks: m.mfe1, mfeToPeak2Ticks: m.mfe2,
      maeToPeak1Ticks: m.mae1, maeBetweenPeaksTicks: m.maeBetween, totalRangeTicks: m.range,
    },
    rr: { peak1Standard: m.rr1, peak2Standard: m.rr2 },
  };
}

// A clean, extending, low-heat move → A+.
const CLEAN = () => asset('RTY', 'SHORT', { mfe1: 100, mfe2: 200, mae1: 10, maeBetween: 8, range: 210, rr1: 4, rr2: 5 });
// A choppy reversal with heat > reward and no continuation → D.
const CHOP = () => asset('CL', 'LONG', { mfe1: 20, mfe2: 20, mae1: 30, maeBetween: 0, range: 70, rr1: 0.6, rr2: 0.6 });
// A solid-but-fading move → B.
const FADE = () => asset('NQ', 'SHORT', { mfe1: 80, mfe2: 80, mae1: 25, maeBetween: 40, range: 130, rr1: 2.0, rr2: 3.5 });

test('clean extending move grades A+ with EXCELLENT/LOW_MAE labels', () => {
  const g = gradeAsset(CLEAN())!;
  assert.ok(g, 'tradeable asset is graded');
  assert.equal(g.classification.tradabilityGrade, 'A+');
  assert.ok(g.classification.tradabilityScore! >= 95);
  assert.equal(g.classification.directionalQuality, 'EXCELLENT');
  assert.equal(g.classification.maeQuality, 'LOW_MAE');
  assert.equal(g.classification.rrQuality, 'EXCELLENT');
  assert.ok(g.parts.hasContinuation);
});

test('choppy reversal with heat > reward grades D with EXTREME_MAE/POOR labels', () => {
  const g = gradeAsset(CHOP())!;
  assert.equal(g.classification.tradabilityGrade, 'D');
  assert.equal(g.classification.maeQuality, 'EXTREME_MAE');
  assert.equal(g.classification.directionalQuality, 'POOR');
  assert.equal(g.classification.rrQuality, 'POOR');
  assert.ok(g.classification.tradabilityScore! < 42);
});

test('gradeRelease ranks best→worst, writes classification, picks holding style', () => {
  const assets: ReleaseJournalAsset[] = [
    FADE(),                                   // B, listed first to prove sorting
    CLEAN(),                                  // A+
    { symbol: 'ZB', role: 'CONFIRMATION', direction: 'NONE', entryModels: {}, peaks: {}, screenshots: [],
      excursions: { totalRangeTicks: 12 }, rr: {} }, // observation-only → not graded
  ];
  const summary = gradeRelease(assets, {});

  assert.match(summary.bestAsset!, /RTY/);          // A+ ranked first
  assert.match(summary.secondBestAsset!, /NQ/);
  assert.match(summary.finalTakeaway!, /^RTY \(short\) graded A\+/); // narrative names the best asset
  assert.equal(summary.bestHoldingStyle, 'HOLD_TO_PEAK_2'); // CLEAN extends to peak2
  // classification written in place on tradeable assets…
  assert.equal(assets[1].classification?.tradabilityGrade, 'A+');
  assert.equal(assets[0].classification?.tradabilityGrade, 'B');
  // …but never on the observation-only asset.
  assert.equal(assets[2].classification, undefined);
});

test('headline interference lowers the score and surfaces a learning note', () => {
  const clean = gradeAsset(CLEAN(), {})!;
  const conflicted = gradeAsset(CLEAN(), { newInfoHeadlineCount: 2 })!;
  // 0.10 weight × full stability loss → ~10-point drop.
  assert.ok(conflicted.classification.tradabilityScore! < clean.classification.tradabilityScore!);
  assert.equal(conflicted.parts.headlineStability, 0);

  const summary = buildReleaseSummary([conflicted], { newInfoHeadlineCount: 2, keyHeadlineInterference: true });
  assert.equal(summary.keyHeadlineInterference, true);
  assert.match(summary.learningNote!, /new-information/i);
  assert.match(summary.finalTakeaway!, /interference/i);
});

test('an all-weak release yields NO_TRADE', () => {
  const summary = gradeRelease([CHOP()], {});
  assert.equal(summary.bestHoldingStyle, 'NO_TRADE');
  assert.match(summary.finalTakeaway!, /\bD\b/);
});

test('non-tradeable or metric-less assets are not graded', () => {
  const none: ReleaseJournalAsset = { symbol: 'ZN', role: 'CONFIRMATION', direction: 'NONE',
    entryModels: {}, peaks: {}, screenshots: [], excursions: { totalRangeTicks: 8 }, rr: {} };
  assert.equal(gradeAsset(none), null);

  const noMetrics: ReleaseJournalAsset = { symbol: 'GC', role: 'SECONDARY', direction: 'LONG',
    entryModels: {}, peaks: {}, screenshots: [], excursions: {}, rr: {} };
  assert.equal(gradeAsset(noMetrics), null);

  // empty release → NO_TRADE summary, no crash
  const summary = buildReleaseSummary([], {});
  assert.equal(summary.bestHoldingStyle, 'NO_TRADE');
  assert.equal(summary.bestAsset, '');
});
