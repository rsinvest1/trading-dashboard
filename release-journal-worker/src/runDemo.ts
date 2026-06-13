// runDemo — end-to-end smoke test WITHOUT a live feed.
//
// Synthesizes a realistic JSONL tick log (the tee's output format) for the ISM
// release across RTY/NQ/GC/6E, writes a release config, then runs the real
// pipeline (parse → build → write) and prints the computed metrics.
//
//   node src/runDemo.ts
//
// Output: samples/demo-ism-ticks.jsonl, samples/demo-ism-config.json, and a
// package under demo-output/. Proves cli.ts works on a real on-disk log.

import { mkdir, writeFile } from 'node:fs/promises';
import { parseTickLog } from './marketRecorder.ts';
import { buildJournalPackage, writePackage } from './journalPackageBuilder.ts';
import type { ReleaseConfig } from './journalPackageBuilder.ts';

const REL = '2026-05-29T14:00:00.000Z';            // 10:00 ET
const releaseMs = Date.parse(REL);
const START_SEC = -30;
const END_SEC = 900;
const STEP_MS = 500;

const tickDecimals = (t: number) => { const s = String(t); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
const roundToTick = (p: number, tick: number) => Number((Math.round(p / tick) * tick).toFixed(tickDecimals(tick)));

// Control points [secondsFromRelease, price]; linearly interpolated, + sub-tick noise.
type Shape = { sym: string; tick: number; pts: [number, number][] };
const SHAPES: Shape[] = [
  { sym: 'RTY', tick: 0.1, pts: [[-30, 2100.6], [0, 2100.0], [3, 2099.4], [8, 2101.2], [70, 2090.2], [210, 2095.1], [590, 2088.0], [900, 2089.5]] },
  { sym: 'NQ', tick: 0.25, pts: [[-30, 21850], [3, 21845], [10, 21855], [85, 21800], [220, 21835], [600, 21815], [900, 21825]] },
  { sym: 'GC', tick: 0.1, pts: [[-30, 3410.0], [3, 3412.0], [20, 3409.0], [160, 3418.9], [380, 3414.0], [620, 3417.0], [900, 3415.5]] },
  { sym: '6E', tick: 0.00005, pts: [[-30, 1.08420], [3, 1.08400], [120, 1.08280], [900, 1.08320]] },
];

function interp(pts: [number, number][], sec: number): number {
  if (sec <= pts[0][0]) return pts[0][1];
  if (sec >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (sec <= pts[i][0]) {
      const [s0, p0] = pts[i - 1], [s1, p1] = pts[i];
      return p0 + (p1 - p0) * ((sec - s0) / (s1 - s0));
    }
  }
  return pts[pts.length - 1][1];
}

// Build the JSONL log (interleaved by time across all symbols).
const rows: { ms: number; line: string }[] = [];
SHAPES.forEach((sh, si) => {
  for (let ms = releaseMs + START_SEC * 1000; ms <= releaseMs + END_SEC * 1000; ms += STEP_MS) {
    const sec = (ms - releaseMs) / 1000;
    const noise = sh.tick * 0.6 * Math.sin(sec * 0.7 + si);     // < 1 tick, deterministic
    const last = roundToTick(interp(sh.pts, sec) + noise, sh.tick);
    rows.push({ ms, line: JSON.stringify({ t: new Date(ms).toISOString(), sym: sh.sym, last }) });
  }
});
rows.sort((a, b) => a.ms - b.ms);
const jsonl = rows.map(r => r.line).join('\n') + '\n';

const config: ReleaseConfig & { tickLog: string } = {
  releaseKey: 'ISM Manufacturing PMI',
  releaseName: 'US ISM Manufacturing PMI (demo)',
  region: 'US',
  scheduledTime: REL,
  actualReleaseTime: '2026-05-29T14:00:01.000Z',
  releaseTemplate: 'pmi_release',
  importance: 'HIGH',
  holdingWindowSec: 900,
  numbers: {
    lines: [
      { name: 'ISM Manufacturing PMI', actual: 48.7, forecast: 49.5, previous: 49.2, surprise: -0.8, weight: 1.0 },
      { name: 'ISM Manufacturing Prices Paid', actual: 57.1, forecast: 55.0, previous: 54.9, surprise: 2.1, weight: 0.5 },
    ],
    aggregateSurpriseScore: -1.1,
    interpretation: 'Soft headline with hot prices paid — mild stagflationary tilt.',
  },
  headlines: [
    { timestamp: REL, text: 'US ISM Manufacturing PMI 48.7 (Forecast 49.5)', source: 'FINANCIALJUICE', relevance: 'HIGH', category: 'release_related', possibleNewInformationEvent: true, likelyMarketEffect: 'reinforced_existing_move' },
  ],
  assets: [
    { symbol: 'RTY', role: 'PRIMARY', direction: 'SHORT', source: 'RITHMIC', tickSize: 0.1 },
    { symbol: 'NQ', role: 'SECONDARY', direction: 'SHORT', source: 'RITHMIC', tickSize: 0.25 },
    { symbol: 'GC', role: 'SECONDARY', direction: 'LONG', source: 'RITHMIC', tickSize: 0.1 },
    { symbol: '6E', role: 'CONFIRMATION', direction: 'NONE', source: 'RITHMIC', tickSize: 0.00005 },
  ],
  tickLog: 'samples/demo-ism-ticks.jsonl',
};

await mkdir('samples', { recursive: true });
await writeFile(config.tickLog, jsonl);
await writeFile('samples/demo-ism-config.json', JSON.stringify(config, null, 2));

const ticks = parseTickLog(jsonl);
const journal = buildJournalPackage(config, ticks);
const dir = await writePackage(journal, 'demo-output');

console.log(`Tick log:   ${config.tickLog}  (${ticks.length} snapshots across ${SHAPES.length} symbols)`);
console.log(`Package:    ${dir}`);
console.log(`Best asset: ${journal.summary.bestAsset}\n`);
console.log('Per-asset metrics:');
for (const a of journal.trackedAssets) {
  if (a.direction === 'NONE') {
    console.log(`  ${a.symbol.padEnd(4)} ${a.role.padEnd(12)} observation · range ${a.excursions?.totalRangeTicks ?? '—'}t`);
  } else {
    console.log(`  ${a.symbol.padEnd(4)} ${a.role.padEnd(12)} ${a.direction}` +
      ` · P1 ${a.peaks?.peak1?.ticksFromEntry ?? '—'}t@+${a.peaks?.peak1?.secondsFromRelease ?? '—'}s` +
      ` · P2 ${a.peaks?.peak2?.ticksFromEntry ?? '—'}t` +
      ` · MAE→P1 ${a.excursions?.maeToPeak1Ticks ?? '—'}t` +
      ` · R/R ${a.rr?.peak1Standard ?? '—'}/${a.rr?.peak2Standard ?? '—'}`);
  }
}
