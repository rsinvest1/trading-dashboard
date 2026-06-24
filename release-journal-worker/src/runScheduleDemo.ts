// runScheduleDemo — end-to-end Phase 3 demo in SIMULATED time (no real clock,
// no screen). Synthesizes a tick log, runs the day scheduler with a stub
// capturer (writes placeholder PNGs), and produces a package with screenshots.
//
//   node src/runScheduleDemo.ts
//
// Output: samples/demo-schedule-ticks.jsonl + a package under demo-output/.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { parseTickLog } from './marketRecorder.ts';
import { runDaySchedule } from './releaseScheduler.ts';
import type { ReleaseWithViews } from './releaseScheduler.ts';
import { makeStubCapturer } from './capture.ts';
import { packageDirFor } from './journalPackageBuilder.ts';

const REL = '2026-05-29T14:00:00.000Z';        // 10:00 ET
const relMs = Date.parse(REL);
const HOLD = 300;

type Shape = { sym: string; pts: [number, number][] };
const SHAPES: Shape[] = [
  { sym: 'RTY', pts: [[-30, 2100.6], [3, 2099.4], [8, 2101.2], [40, 2090.0], [120, 2095.0], [260, 2088.0], [300, 2089.0]] },
  { sym: 'NQ', pts: [[-30, 21850], [3, 21845], [10, 21855], [50, 21800], [140, 21830], [270, 21815], [300, 21820]] },
];
const interp = (pts: [number, number][], sec: number): number => {
  if (sec <= pts[0][0]) return pts[0][1];
  if (sec >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) if (sec <= pts[i][0]) {
    const [s0, p0] = pts[i - 1], [s1, p1] = pts[i];
    return p0 + (p1 - p0) * ((sec - s0) / (s1 - s0));
  }
  return pts[pts.length - 1][1];
};

// Generate the JSONL log
const rows: { ms: number; line: string }[] = [];
for (const sh of SHAPES) {
  for (let ms = relMs - 30_000; ms <= relMs + HOLD * 1000; ms += 1000) {
    const last = Math.round(interp(sh.pts, (ms - relMs) / 1000) * 100) / 100;
    rows.push({ ms, line: JSON.stringify({ t: new Date(ms).toISOString(), sym: sh.sym, last }) });
  }
}
rows.sort((a, b) => a.ms - b.ms);
const jsonl = rows.map(r => r.line).join('\n') + '\n';
await mkdir('samples', { recursive: true });
await writeFile('samples/demo-schedule-ticks.jsonl', jsonl);
const ticks = parseTickLog(jsonl);

const release: ReleaseWithViews = {
  releaseKey: 'ISM Manufacturing PMI',
  releaseName: 'US ISM Manufacturing PMI (schedule demo)',
  region: 'US',
  scheduledTime: REL,
  actualReleaseTime: '2026-05-29T14:00:01.000Z',
  releaseTemplate: 'pmi_release',
  importance: 'HIGH',
  holdingWindowSec: HOLD,
  numbers: { lines: [{ name: 'ISM Manufacturing PMI', actual: 48.7, forecast: 49.5, previous: 49.2, surprise: -0.8 }], interpretation: 'Soft print.' },
  assets: [
    { symbol: 'RTY', role: 'PRIMARY', direction: 'SHORT', source: 'RITHMIC', tickSize: 0.1 },
    { symbol: 'NQ', role: 'SECONDARY', direction: 'SHORT', source: 'RITHMIC', tickSize: 0.25 },
  ],
  tickLog: 'samples/demo-schedule-ticks.jsonl',
  views: [
    { id: 'rty', asset: 'RTY', target: { monitor: 0 } },
    { id: 'nq', asset: 'NQ', target: { monitor: 1 } },
    { id: 'numbers', globalType: 'RELEASE_NUMBERS', offsetsSec: [5], target: { full: true } },
  ],
};

// Synthetic FinancialJuice headline log (what the news tee would write).
const HEADLINES = [
  { timestamp: '2026-05-29T14:00:02.000Z', source: 'FinancialJuice', text: 'US ISM Manufacturing PMI 48.7 (Forecast 49.5, Previous 49.2)' },
  { timestamp: '2026-05-29T14:01:30.000Z', source: 'FT', text: "Fed's Goolsbee: recent activity data has clearly softened, watching closely" },
  { timestamp: '2026-05-29T14:02:10.000Z', source: 'CNBC', text: 'Broadcom stock plunges 14% on weak software sales, unchanged AI chip forecast' },
  { timestamp: '2026-05-29T14:03:00.000Z', source: 'Yonhap', text: "North Korea's Kim reviews nuclear material manufacturing site" },
  { timestamp: '2026-05-29T14:10:00.000Z', source: 'X', text: 'After the holding window — should be excluded' },
];

// Simulated clock: start 60s before the release; sleep advances instantly.
let vnow = relMs - 60_000;
const results = await runDaySchedule({
  schedule: { releases: [release], baseDir: 'demo-output' },
  capture: makeStubCapturer(),
  now: () => vnow,
  sleep: async (ms) => { vnow += Math.max(ms, 1); },
  readTicks: async () => ticks,
  readHeadlines: async () => HEADLINES,
  pollMs: 5000,
  log: (m) => console.log(m),
});

// Report
const dir = packageDirFor(release, 'demo-output');
const journal = JSON.parse(await readFile(`${dir}/metadata.json`, 'utf8'));
console.log('\n=== Result ===');
for (const r of results) console.log(`  ${r.release}: ${r.shots} screenshots → ${r.packageDir}`);
console.log('\nScreenshots per asset:');
for (const a of journal.trackedAssets) {
  const byType = a.screenshots.map((s: any) => s.type).join(', ');
  console.log(`  ${a.symbol.padEnd(4)} (${a.screenshots.length}): ${byType || '—'}`);
}

console.log(`\nHeadlines (${journal.headlines.length}) · keyHeadlineInterference=${journal.summary.keyHeadlineInterference}:`);
for (const h of journal.headlines) {
  const t = String(h.timestamp).slice(11, 19);
  console.log(`  ${t}  [${h.relevance.padEnd(6)} ${String(h.category).padEnd(16)} ${h.possibleNewInformationEvent ? 'NEW-INFO' : '       '}]  ${h.text.slice(0, 64)}`);
}

console.log('\nGrades (Phase 5, best-first):');
const graded = [...journal.trackedAssets].sort((a: any, b: any) =>
  (b.classification?.tradabilityScore ?? -1) - (a.classification?.tradabilityScore ?? -1));
for (const a of graded) {
  const c = a.classification ?? {};
  const g = c.tradabilityGrade ? `${c.tradabilityGrade} (${c.tradabilityScore})` : '— (observation)';
  console.log(`  ${a.symbol.padEnd(4)} ${String(a.direction).padEnd(5)} ${g.padEnd(10)}  dir=${c.directionalQuality ?? '—'} mae=${c.maeQuality ?? '—'} rr=${c.rrQuality ?? '—'}`);
}
const s = journal.summary;
console.log(`\nSummary: best=${s.bestAsset || '—'} · style=${s.bestHoldingStyle || '—'}`);
console.log(`  takeaway: ${s.finalTakeaway}`);
if (s.learningNote) console.log(`  learning: ${s.learningNote}`);
