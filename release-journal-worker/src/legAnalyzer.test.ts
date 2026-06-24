// Unit tests for legAnalyzer — synthetic tick paths so the leg metrics and the
// direction-agnostic first-leg detection are reproducible.
//
//   node --test src/legAnalyzer.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLegs } from './legAnalyzer.ts';
import type { Tick } from './marketRecorder.ts';

const T0 = Date.parse('2026-06-10T12:30:00.000Z');
const TICK = 0.1; // RTY-style

// Sample a price(sec) function at 1 s for 0..durSec into Tick[].
function buildTicks(symbol: string, priceFn: (s: number) => number, durSec = 180): Tick[] {
  const out: Tick[] = [];
  for (let s = 0; s <= durSec; s++) {
    out.push({ symbol, timestamp: new Date(T0 + s * 1000).toISOString(), last: Math.round(priceFn(s) * 100) / 100 });
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Clean first leg up: rises to a high by ~40 s, then a shallow drift — no bigger
// second leg.
const cleanUp = buildTicks('RTY', s => 2900 + 0.25 * clamp(s, 0, 40) - 0.02 * clamp(s - 40, 0, 140));
// Second leg better: up to 2905 (s=20), retrace to 2902 (s=35), extend to 2912 (s=70).
const secondBetter = buildTicks('RTY', s => {
  if (s <= 20) return 2900 + (5 / 20) * s;            // → 2905
  if (s <= 35) return 2905 - (3 / 15) * (s - 20);     // → 2902
  if (s <= 70) return 2902 + (10 / 35) * (s - 35);    // → 2912
  return 2912 - 0.01 * (s - 70);
});
// Reversal: scorecard says LONG but price falls to 2890 by s=40.
const reversal = buildTicks('RTY', s => 2900 - 0.25 * clamp(s, 0, 40) + 0.01 * clamp(s - 40, 0, 140));

test('clean up move: first-leg dir UP, large favorable MFE, low MAE', () => {
  const r = analyzeLegs({ symbol: 'RTY', ticks: cleanUp, t0: new Date(T0).toISOString(), tickSize: TICK, direction: 'LONG' });
  assert.equal(r.hadData, true);
  assert.equal(r.actualFirstLegDir, 'UP');
  assert.ok(r.firstLeg!.mfeTicks >= 60, `mfe ${r.firstLeg!.mfeTicks}`);
  assert.ok(r.firstLeg!.maeTicks <= 10, `mae ${r.firstLeg!.maeTicks}`);
  const r60 = r.timedReads.find(t => t.sec === 60)!;
  assert.equal(r60.dir, 'UP');
  assert.ok(r60.ticks > 0);
});

test('second leg better: continuation past peak1, secondLegBetter true', () => {
  const r = analyzeLegs({ symbol: 'RTY', ticks: secondBetter, t0: new Date(T0).toISOString(), tickSize: TICK, direction: 'LONG' });
  assert.equal(r.actualFirstLegDir, 'UP');
  assert.ok(r.secondLeg, 'has a second leg');
  assert.equal(r.secondLeg!.continuation, true);
  assert.equal(r.secondLeg!.secondLegBetter, true);
  assert.equal(r.secondLeg!.pushDir, 'UP');
  assert.ok(r.secondLeg!.secondExtremeTicks > r.firstLeg!.mfeTicks);
});

test('reversal vs LONG bias: dominant dir DOWN, tiny favorable, large MAE', () => {
  const r = analyzeLegs({ symbol: 'RTY', ticks: reversal, t0: new Date(T0).toISOString(), tickSize: TICK, direction: 'LONG' });
  assert.equal(r.actualFirstLegDir, 'DOWN'); // market went the OTHER way → bias miss
  assert.ok(r.firstLeg!.mfeTicks <= 10, `mfe ${r.firstLeg!.mfeTicks}`);
  assert.ok(r.firstLeg!.maeTicks >= 60, `mae ${r.firstLeg!.maeTicks}`);
});

test('confirmation symbol (no bias): measures the move in its dominant direction', () => {
  const r = analyzeLegs({ symbol: 'ZN', ticks: reversal, t0: new Date(T0).toISOString(), tickSize: TICK }); // direction omitted
  assert.equal(r.direction, 'NONE');
  assert.equal(r.actualFirstLegDir, 'DOWN');
  assert.equal(r.firstLeg!.measureDir, 'SHORT');     // followed the dominant down move
  assert.ok(r.firstLeg!.mfeTicks >= 60, `mfe ${r.firstLeg!.mfeTicks}`);
});

test('no ticks: hadData false, flat, no legs', () => {
  const r = analyzeLegs({ symbol: 'GC', ticks: [], t0: new Date(T0).toISOString(), tickSize: 0.1 });
  assert.equal(r.hadData, false);
  assert.equal(r.actualFirstLegDir, 'FLAT');
  assert.equal(r.firstLeg, undefined);
  assert.deepEqual(r.timedReads, []);
});
