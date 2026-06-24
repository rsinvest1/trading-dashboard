// Tests the capture-window driver in SIMULATED time (no real clock, no screen).
// Run: node --test src/screenshotScheduler.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedPlan, runCaptureWindow } from './screenshotScheduler.ts';
import type { Tick } from './marketRecorder.ts';
import type { CaptureView } from './capture.ts';
import type { ReleaseConfig } from './journalPackageBuilder.ts';

const REL = '2026-01-01T00:00:00.000Z';
const relMs = Date.parse(REL);

test('fixedPlan clamps to the window and ends with HOLDING_END', () => {
  const plan = fixedPlan(relMs, 900);
  const labels = plan.map(f => f.label);
  assert.ok(labels.includes('pre_release'));      // T-30s
  assert.ok(labels.includes('release_impulse'));  // T+5s
  assert.ok(labels.includes('holding_end'));       // window end
  assert.equal(plan[plan.length - 1].type, 'HOLDING_END');
  // 900s window: t+15m offset replaced by holding_end (no duplicate at 900s)
  assert.equal(plan.filter(f => f.offsetSec === 900).length, 1);
  // sorted ascending
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i].fireAtMs >= plan[i - 1].fireAtMs);
});

test('fixedPlan with a short window drops far frames', () => {
  const plan = fixedPlan(relMs, 120);
  assert.ok(!plan.some(f => f.offsetSec === 300));  // 5m dropped
  assert.equal(plan.find(f => f.label === 'holding_end')!.offsetSec, 120);
});

// SHORT RTY: entry ~100 at T+3s → peak1 95.0 (~50t) @ T+30s → retrace 97 @ T+60s
// → peak2 93.0 (~70t) @ T+90s. Window 120s.
function rtyTicks(): Tick[] {
  const pts: [number, number][] = [
    [-30, 100.2], [3, 100.0], [5, 100.6], [30, 95.0], [45, 96.0], [60, 97.0], [90, 93.0], [120, 94.0],
  ];
  return pts.map(([sec, last]) => ({ symbol: 'RTY', timestamp: new Date(relMs + sec * 1000).toISOString(), last }));
}

const release: ReleaseConfig = {
  releaseKey: 'TEST', releaseName: 'Test', region: 'US', scheduledTime: REL,
  releaseTemplate: 'custom', importance: 'MEDIUM', holdingWindowSec: 120,
  assets: [{ symbol: 'RTY', role: 'PRIMARY', direction: 'SHORT', tickSize: 0.1 }],
};

const views: CaptureView[] = [
  { id: 'rty', asset: 'RTY', target: { monitor: 0 } },
  { id: 'numbers', globalType: 'RELEASE_NUMBERS', offsetsSec: [5], target: { monitor: 1 } },
];

test('runCaptureWindow fires fixed + event-driven captures (simulated time)', async () => {
  const ticks = rtyTicks();
  let vnow = relMs - 30_000;               // start at capture-window open
  const calls: string[] = [];

  const shots = await runCaptureWindow({
    release, views, stagingDir: 'X',
    now: () => vnow,
    sleep: async (ms) => { vnow += Math.max(ms, 1); },
    capture: async (_v, out) => { calls.push(out.replace(/\\/g, '/')); },
    readTicks: async () => ticks.filter(t => Date.parse(t.timestamp) <= vnow),
    pollMs: 1000,
  });

  const types = shots.map(s => s.type);
  const paths = shots.map(s => s.path.replace(/\\/g, '/'));

  // fixed-time
  assert.ok(paths.includes('assets/RTY/pre_release.png'));
  assert.ok(paths.includes('assets/RTY/release_impulse.png'));
  assert.ok(paths.includes('assets/RTY/holding_end.png'));
  // global numbers view only at T+5s
  assert.ok(paths.includes('release_numbers.png'));
  assert.equal(paths.filter(p => p === 'release_numbers.png').length, 1);

  // event-driven
  assert.ok(types.includes('PEAK_1'), 'PEAK_1 captured');
  assert.ok(types.includes('PEAK_2'), 'PEAK_2 captured');
  assert.ok(paths.includes('assets/RTY/peak1.png'));
  assert.ok(paths.includes('assets/RTY/peak2.png'));

  // each event fires exactly once
  assert.equal(types.filter(t => t === 'PEAK_1').length, 1);
  assert.equal(types.filter(t => t === 'PEAK_2').length, 1);
});
