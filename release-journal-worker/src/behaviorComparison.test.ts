// Unit tests for behaviorComparison — hand-built expected + leg inputs so the
// bias-hit / best-leg / quality / confirmation matrices are reproducible.
//
//   node --test src/behaviorComparison.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRelease } from './behaviorComparison.ts';
import type {
  ReleaseExpected, ExpectedSymbol, ExpectedBias, LegAnalysis, LegDir,
} from '../schema/releaseJournalSchema';

function expSym(role: 'ALERT' | 'CONFIRMATION', bias: ExpectedBias, conf: ExpectedSymbol['expectedConfidence'], conflicts: string[] = []): ExpectedSymbol {
  return { role, expectedBias: bias, expectedConfidence: conf, conflicts, reasons: [], missingFields: [] };
}
function makeExpected(perSymbol: Record<string, ExpectedSymbol>, best?: string): ReleaseExpected {
  return { templateId: 'TEST', perSymbol, best };
}
function leg(symbol: string, firstDir: LegDir, m: { mfe: number; mae: number; second?: { extreme: number; better: boolean; dir: LegDir }; t1?: number; hadData?: boolean }): LegAnalysis {
  const measureDir = firstDir === 'DOWN' ? 'SHORT' : 'LONG';
  const out: LegAnalysis = {
    symbol, direction: measureDir, hadData: m.hadData ?? true, snapshots: 100,
    actualFirstLegDir: firstDir, timedReads: [],
    firstLeg: { measureDir, mfeTicks: m.mfe, maeTicks: m.mae, timeToFirstExtremeSec: m.t1 ?? 20 },
  };
  if (m.second) out.secondLeg = {
    retraceTicks: 5, pushDir: m.second.dir, secondExtremeTicks: m.second.extreme,
    timeToSecondExtremeSec: 120, continuation: m.second.better, secondLegBetter: m.second.better,
  };
  return out;
}

test('bias hit, clean first leg → A / FIRST_LEG / clean', () => {
  const expected = makeExpected({ NQ: expSym('ALERT', 'LONG', 'A') }, 'NQ');
  const cmp = compareRelease(expected, { NQ: leg('NQ', 'UP', { mfe: 30, mae: 5 }) });
  const nq = cmp.bySymbol[0];
  assert.equal(nq.expectedBiasHit, true);
  assert.equal(nq.bestLeg, 'FIRST_LEG');
  assert.equal(nq.scoreQuality, 'A');
  assert.equal(nq.executionQuality, 'clean');
  assert.equal(cmp.overall.bestSymbol, 'NQ');
  assert.equal(cmp.overall.expectedBiasHit, true);
});

test('bias missed (expected LONG, went DOWN) → NO_TRADE / failed', () => {
  const expected = makeExpected({ RTY: expSym('ALERT', 'LONG', 'B') }, 'RTY');
  const cmp = compareRelease(expected, { RTY: leg('RTY', 'DOWN', { mfe: 1, mae: 40 }) });
  const r = cmp.bySymbol[0];
  assert.equal(r.expectedBiasHit, false);
  assert.equal(r.scoreQuality, 'NO_TRADE');
  assert.equal(r.executionQuality, 'failed');
  assert.match(r.note, /bias missed/i);
});

test('second leg better → SECOND_LEG / late', () => {
  const expected = makeExpected({ GC: expSym('ALERT', 'SHORT', 'B') }, 'GC');
  const cmp = compareRelease(expected, { GC: leg('GC', 'DOWN', { mfe: 6, mae: 3, second: { extreme: 20, better: true, dir: 'DOWN' } }) });
  const g = cmp.bySymbol[0];
  assert.equal(g.expectedBiasHit, true);
  assert.equal(g.bestLeg, 'SECOND_LEG');
  assert.equal(g.executionQuality, 'late');
  assert.match(g.note, /don't chase the first spike/i);
});

test('conflict flagged by scorecard but bias hit → conflicted', () => {
  const expected = makeExpected({ UB: expSym('ALERT', 'SHORT', 'B', ['Auction price/demand conflict: wait for post-award direction.']) }, 'UB');
  const cmp = compareRelease(expected, { UB: leg('UB', 'DOWN', { mfe: 12, mae: 4 }) });
  assert.equal(cmp.bySymbol[0].executionQuality, 'conflicted');
});

test('confirmation agrees + missing sources cap confidence', () => {
  const expected = makeExpected({
    NQ: expSym('ALERT', 'LONG', 'A'),
    ES: expSym('CONFIRMATION', 'NO_TRADE', 'NO_TRADE'),
    ZN: expSym('CONFIRMATION', 'NO_TRADE', 'NO_TRADE'),
    DXY: expSym('CONFIRMATION', 'NO_TRADE', 'NO_TRADE'),
    VIX: expSym('CONFIRMATION', 'NO_TRADE', 'NO_TRADE'),
  }, 'NQ');
  const cmp = compareRelease(expected, {
    NQ: leg('NQ', 'UP', { mfe: 30, mae: 5 }),
    ES: leg('ES', 'UP', { mfe: 20, mae: 4 }),
    ZN: leg('ZN', 'UP', { mfe: 8, mae: 2 }),
    // DXY + VIX have NO feed → not in legBySymbol
  });
  assert.equal(cmp.confirmation.agreement, 'CONFIRM');
  assert.deepEqual(cmp.confirmation.agreeing.sort(), ['ES', 'ZN']);
  assert.deepEqual(cmp.confirmation.missingSources.sort(), ['DXY', 'VIX']);
  assert.match(cmp.confirmation.note, /confidence capped/i);
});

test('confirmation conflict: DXY up against a risk-on NQ rally', () => {
  const expected = makeExpected({
    NQ: expSym('ALERT', 'LONG', 'A'),
    DXY: expSym('CONFIRMATION', 'NO_TRADE', 'NO_TRADE'),
  }, 'NQ');
  const cmp = compareRelease(expected, {
    NQ: leg('NQ', 'UP', { mfe: 30, mae: 5 }),
    DXY: leg('DXY', 'UP', { mfe: 10, mae: 2 }),
  });
  assert.equal(cmp.confirmation.agreement, 'CONFLICT');
  assert.deepEqual(cmp.confirmation.conflicting, ['DXY']);
});

test('alert symbol with no tick data → flagged, not silently dropped', () => {
  const expected = makeExpected({ UB: expSym('ALERT', 'SHORT', 'B') }, 'UB');
  const cmp = compareRelease(expected, {}); // no legs at all
  assert.equal(cmp.bySymbol.length, 1);
  assert.equal(cmp.bySymbol[0].executionQuality, 'failed');
  assert.match(cmp.bySymbol[0].note, /no tick data/i);
});
