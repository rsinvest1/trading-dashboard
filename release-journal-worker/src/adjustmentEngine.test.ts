// Unit tests for adjustmentEngine — drives suggestAdjustments through the real
// compareRelease so the heuristics fire on realistic comparison shapes.
//
//   node --test src/adjustmentEngine.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareRelease } from './behaviorComparison.ts';
import { suggestAdjustments, summarizeComparison, writeAdjustments } from './adjustmentEngine.ts';
import type { Template } from './expectedBehavior.ts';
import type { ReleaseExpected, ExpectedSymbol, ExpectedBias, LegAnalysis, LegDir } from '../schema/releaseJournalSchema';

function expSym(role: 'ALERT' | 'CONFIRMATION', bias: ExpectedBias, conf: ExpectedSymbol['expectedConfidence'], conflicts: string[] = []): ExpectedSymbol {
  return { role, expectedBias: bias, expectedConfidence: conf, conflicts, reasons: [], missingFields: [] };
}
function makeExpected(templateId: string, perSymbol: Record<string, ExpectedSymbol>, best?: string): ReleaseExpected {
  return { templateId, perSymbol, best };
}
function leg(symbol: string, firstDir: LegDir, m: { mfe: number; mae: number; second?: { extreme: number; better: boolean; dir: LegDir } }): LegAnalysis {
  const measureDir = firstDir === 'DOWN' ? 'SHORT' : 'LONG';
  const out: LegAnalysis = {
    symbol, direction: measureDir, hadData: true, snapshots: 100,
    actualFirstLegDir: firstDir, timedReads: [],
    firstLeg: { measureDir, mfeTicks: m.mfe, maeTicks: m.mae, timeToFirstExtremeSec: 20 },
  };
  if (m.second) out.secondLeg = { retraceTicks: 5, pushDir: m.second.dir, secondExtremeTicks: m.second.extreme, timeToSecondExtremeSec: 120, continuation: m.second.better, secondLegBetter: m.second.better };
  return out;
}

test('bias miss on the best symbol + missing source → HIGH suggestions', () => {
  const expected = makeExpected('US_CPI_JUN10', { NQ: expSym('ALERT', 'LONG', 'A'), DXY: expSym('CONFIRMATION', 'NO_TRADE', 'NO_TRADE') }, 'NQ');
  const cmp = compareRelease(expected, { NQ: leg('NQ', 'DOWN', { mfe: 1, mae: 40 }) }); // DXY has no feed
  const s = suggestAdjustments(cmp, expected, { legBySymbol: { NQ: leg('NQ', 'DOWN', { mfe: 1, mae: 40 }) } });

  const biasMiss = s.find(a => a.target === 'US_CPI_JUN10.contributions.NQ');
  assert.ok(biasMiss, 'a contribution-review suggestion for NQ');
  assert.equal(biasMiss!.confidence, 'HIGH'); // NQ was the scorecard best
  const missing = s.find(a => a.scope === 'daily_prep' && a.target === 'DXY');
  assert.ok(missing, 'a missing-source suggestion for DXY');
  assert.equal(missing!.confidence, 'HIGH');
});

test('second leg better + conflict-but-clean → holding_style + relax-cap', () => {
  const template: Template = { id: 'US_10Y_AUCTION_JUN10', conflictRules: [{ id: 'weak_price_strong_demand', affects: ['UB', 'GC'], maxConfidence: 'B' }] };
  const expected = makeExpected('US_10Y_AUCTION_JUN10', { UB: expSym('ALERT', 'SHORT', 'B', ['Auction price/demand conflict.']) }, 'UB');
  const legs = { UB: leg('UB', 'DOWN', { mfe: 10, mae: 3, second: { extreme: 24, better: true, dir: 'DOWN' } }) };
  const cmp = compareRelease(expected, legs);
  const s = suggestAdjustments(cmp, expected, { legBySymbol: legs, template });

  assert.ok(s.find(a => a.scope === 'holding_style' && a.target === 'UB'), 'holding-style note');
  const relax = s.find(a => a.scope === 'template' && a.target.includes('conflictRules'));
  assert.ok(relax, 'relax-conflict-cap suggestion');
  assert.match(relax!.rationale, /weak_price_strong_demand/);
});

test('heavy pre-pay heat → enter-on-confirmation note', () => {
  const expected = makeExpected('US_CPI_JUN10', { UB: expSym('ALERT', 'SHORT', 'B') }, 'UB');
  const legs = { UB: leg('UB', 'DOWN', { mfe: 10, mae: 8 }) }; // 8 >= 0.6*10
  const cmp = compareRelease(expected, legs);
  const s = suggestAdjustments(cmp, expected, { legBySymbol: legs });
  const heat = s.find(a => a.scope === 'daily_prep' && a.target === 'UB');
  assert.ok(heat, 'a size-down/confirmation note for UB');
  assert.match(heat!.rationale, /adverse heat/i);
});

test('clean validated release → no false adjustments', () => {
  const expected = makeExpected('US_CPI_JUN10', { NQ: expSym('ALERT', 'LONG', 'A') }, 'NQ');
  const legs = { NQ: leg('NQ', 'UP', { mfe: 30, mae: 4 }) };
  const cmp = compareRelease(expected, legs);
  const s = suggestAdjustments(cmp, expected, { legBySymbol: legs });
  assert.equal(s.length, 0, 'no suggestions when the scorecard validated cleanly');
  assert.match(summarizeComparison(cmp), /Best NQ: bias HIT/);
});

test('writeAdjustments writes the review file (output-only)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rj-adj-'));
  const expected = makeExpected('US_CPI_JUN10', { NQ: expSym('ALERT', 'LONG', 'A') }, 'NQ');
  const legs = { NQ: leg('NQ', 'DOWN', { mfe: 1, mae: 40 }) };
  const cmp = compareRelease(expected, legs);
  const s = suggestAdjustments(cmp, expected, { legBySymbol: legs });
  const file = await writeAdjustments(root, '2026-06-10', 'US_CPI_JUN10', s, summarizeComparison(cmp));

  assert.match(file, /adjustments[\\/]2026-06-10_US_CPI_JUN10\.json$/);
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(parsed.templateId, 'US_CPI_JUN10');
  assert.equal(parsed.date, '2026-06-10');
  assert.ok(Array.isArray(parsed.suggestions));
  assert.ok(parsed.summary.length > 0);
});
