// Deterministic unit test for the metrics engine. Run: node --test src/peakMaeAnalyzer.test.ts
//
// Synthetic SHORT trade on a 0.1-tick instrument with a known shape:
//   entry 100.0 @ T+3s → small adverse pop to 100.6 (MAE 6t) → peak1 95.0 (50t)
//   → retrace to 97.0 (30t) → peak2 93.0 (70t) → drift 94.0
// so every output is hand-checkable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from './peakMaeAnalyzer.ts';
import type { Tick } from './marketRecorder.ts';

const REL = '2026-01-01T00:00:00.000Z';
const at = (sec: number, last: number): Tick => ({
  symbol: 'TST',
  timestamp: new Date(Date.parse(REL) + sec * 1000).toISOString(),
  last,
});

const ticks: Tick[] = [
  at(0, 100.2),
  at(3, 100.0),  // entry anchor (first snapshot ≥ release + 3s)
  at(5, 100.6),  // adverse → MAE to peak1 = 6 ticks
  at(30, 95.0),  // peak1 = 50 ticks favorable
  at(45, 96.0),
  at(60, 97.0),  // retrace1 = 30 ticks
  at(90, 93.0),  // peak2 = 70 ticks
  at(120, 94.0),
];

test('SHORT: entry anchor at release + 3s', () => {
  const r = analyze({ symbol: 'TST', direction: 'SHORT', releaseTime: REL, ticks, tickSize: 0.1 });
  assert.equal(r.meta.hadData, true);
  assert.equal(r.meta.snapshots, 7);            // entry + 6 after
  assert.equal(r.entryModels.immediate?.price, 100);
  assert.equal(r.entryModels.immediate?.timestamp, at(3, 0).timestamp);
});

test('SHORT: peaks, retrace, MAE/MFE', () => {
  const r = analyze({ symbol: 'TST', direction: 'SHORT', releaseTime: REL, ticks, tickSize: 0.1 });
  assert.equal(r.peaks.peak1?.ticksFromEntry, 50);
  assert.equal(r.peaks.retrace1?.ticksFromEntry, 30);
  assert.equal(r.peaks.peak2?.ticksFromEntry, 70);
  assert.equal(r.peaks.peak1?.secondsFromRelease, 30);
  assert.equal(r.peaks.peak2?.secondsFromRelease, 90);
  assert.equal(r.excursions.maeToPeak1Ticks, 6);
  assert.equal(r.excursions.maeBetweenPeaksTicks, 20);   // 50 - 30
  assert.equal(r.excursions.mfeToPeak1Ticks, 50);
  assert.equal(r.excursions.mfeToPeak2Ticks, 70);
  assert.equal(r.excursions.totalRangeTicks, 76);        // (100.6 - 93.0)/0.1
});

test('SHORT: R/R uses MAE-derived stops', () => {
  const r = analyze({ symbol: 'TST', direction: 'SHORT', releaseTime: REL, ticks, tickSize: 0.1 });
  // standard stop = MAE(6) + buffer(2) = 8 → peak1 50/8=6.3, peak2 70/8=8.8
  assert.equal(r.rr.peak1Standard, 6.3);
  assert.equal(r.rr.peak2Standard, 8.8);
  assert.equal(r.rr.peak1Tight, 10);                     // tight = round(8*0.6)=5 → 50/5
  assert.equal(r.rr.peak2Wide, 5.4);                     // wide = round(8*1.6)=13 → 70/13
});

test('LONG mirror: favorable = price up', () => {
  // Same magnitudes, inverted around entry, as a LONG.
  const up: Tick[] = [
    at(0, 99.8), at(3, 100.0), at(5, 99.4), at(30, 105.0),
    at(45, 104.0), at(60, 103.0), at(90, 107.0), at(120, 106.0),
  ];
  const r = analyze({ symbol: 'TST', direction: 'LONG', releaseTime: REL, ticks: up, tickSize: 0.1 });
  assert.equal(r.peaks.peak1?.ticksFromEntry, 50);
  assert.equal(r.peaks.peak2?.ticksFromEntry, 70);
  assert.equal(r.excursions.maeToPeak1Ticks, 6);
});

test('empty input is handled gracefully', () => {
  const r = analyze({ symbol: 'TST', direction: 'SHORT', releaseTime: REL, ticks: [], tickSize: 0.1 });
  assert.equal(r.meta.hadData, false);
  assert.deepEqual(r.peaks, {});
});
