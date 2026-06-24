// runReleaseReview — the Phase 6 orchestrator. Ties the scorecard ⇄ behavior loop
// together for one release:
//
//   loadExpected (macro_score files)        ─┐
//   analyzeLegs per tracked/confirm symbol  ─┤→ compareRelease → suggestAdjustments
//                                            ─┘        │
//   buildJournalPackage(review) → writePackage         └→ writeAdjustments
//
// Reuses the existing tee/backfill tick path: the caller passes the window ticks
// (already read from the tee log or a history backfill); this module never touches
// the feed. Adjustments are OUTPUT-ONLY (macro_score/adjustments/), never edits.
//
// Run directly for an end-to-end demo:  npm run review

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { selectWindow } from './marketRecorder.ts';
import type { Tick } from './marketRecorder.ts';
import { analyzeLegs } from './legAnalyzer.ts';
import { loadExpected, loadTemplate } from './expectedBehavior.ts';
import { compareRelease } from './behaviorComparison.ts';
import { suggestAdjustments, summarizeComparison, writeAdjustments } from './adjustmentEngine.ts';
import { buildJournalPackage, writePackage } from './journalPackageBuilder.ts';
import type { ReleaseConfig, PackageScreenshot, ReviewBundle } from './journalPackageBuilder.ts';
import { tickSizeFor } from './instruments.ts';
import type {
  ReleaseJournal, ReleaseJournalHeadline, LegAnalysis,
} from '../schema/releaseJournalSchema';

export type ReleaseReviewParams = {
  config: ReleaseConfig;
  ticks: Tick[];               // window ticks (from tee log / history backfill)
  templateId: string;
  macroScoreRoot: string;      // C:\RSInvest\macro_score
  dailyPrepDate: string;       // YYYY-MM-DD (ET) — locates daily_prep + keys the adjustments file
  screenshots?: PackageScreenshot[];
  headlines?: ReleaseJournalHeadline[];
  adjustmentsRoot?: string;    // where to write adjustments (default macroScoreRoot)
  baseDir?: string;            // journal-data base (default 'journal-data')
  log?: (m: string) => void;
};

export type ReleaseReviewResult = {
  journal: ReleaseJournal;
  packageDir: string;
  adjustmentsFile: string;
  review: ReviewBundle;
};

export async function runReleaseReview(p: ReleaseReviewParams): Promise<ReleaseReviewResult> {
  const log = p.log ?? (() => {});
  const releaseTime = p.config.actualReleaseTime || p.config.scheduledTime;
  const holdSec = p.config.holdingWindowSec ?? 900;
  const preRoll = p.config.preRollSec ?? 30;
  const startTime = new Date(Date.parse(releaseTime) - preRoll * 1000).toISOString();
  const endTime = new Date(Date.parse(releaseTime) + holdSec * 1000).toISOString();

  // 1. What the scorecard expected.
  const expected = await loadExpected({ macroScoreRoot: p.macroScoreRoot, dailyPrepDate: p.dailyPrepDate, templateId: p.templateId });
  const template = await loadTemplate(p.macroScoreRoot, p.templateId);

  // 2. Register the actual behavior of every tracked + confirmation symbol.
  const cfgDir = new Map(p.config.assets.map(a => [a.symbol, a.direction ?? 'NONE'] as const));
  const cfgTick = new Map(p.config.assets.map(a => [a.symbol, a.tickSize] as const));
  const symbols = new Set<string>([
    ...p.config.assets.map(a => a.symbol),
    ...Object.keys(expected.perSymbol),
  ]);

  const legBySymbol: Record<string, LegAnalysis> = {};
  for (const sym of symbols) {
    const snaps = selectWindow(p.ticks, { symbols: [sym], startTime, endTime, snapshotIntervalMs: p.config.snapshotIntervalMs });
    const expRole = expected.perSymbol[sym]?.role;
    // Measure direction: the config's direction if set, else the scorecard bias for
    // an ALERT symbol, else agnostic (confirmation symbols).
    const dir = cfgDir.get(sym)
      ?? (expRole === 'ALERT' && expected.perSymbol[sym].expectedBias !== 'NO_TRADE'
        ? (expected.perSymbol[sym].expectedBias === 'LONG' ? 'LONG' : 'SHORT')
        : 'NONE');
    legBySymbol[sym] = analyzeLegs({
      symbol: sym, ticks: snaps, t0: releaseTime,
      tickSize: cfgTick.get(sym) ?? tickSizeFor(sym),
      direction: dir, holdSec,
    });
  }

  // 3. Compare expected vs actual, then derive advisory adjustments.
  const comparison = compareRelease(expected, legBySymbol);
  const suggestedAdjustments = suggestAdjustments(comparison, expected, { legBySymbol, template });
  const summary = summarizeComparison(comparison);
  log(`[review] ${p.templateId}: ${summary}`);

  // 4. Build the enriched journal package + write the adjustments review file.
  const review: ReviewBundle = { templateId: p.templateId, expected, comparison, legBySymbol, suggestedAdjustments };
  const journal = buildJournalPackage(p.config, p.ticks, p.screenshots ?? [], p.headlines ?? [], review);
  const packageDir = await writePackage(journal, p.baseDir ?? 'journal-data');
  const adjustmentsFile = await writeAdjustments(p.adjustmentsRoot ?? p.macroScoreRoot, p.dailyPrepDate, p.templateId, suggestedAdjustments, summary);
  log(`[review] package → ${packageDir}`);
  log(`[review] adjustments → ${adjustmentsFile} (${suggestedAdjustments.length} suggestion(s))`);

  return { journal, packageDir, adjustmentsFile, review };
}

// ── End-to-end demo (npm run review) ─────────────────────────────────────────
// Synthesizes an NFP-style tick window (NQ/RTY rally = LONG hit; UB sells off) and
// runs the full review against the REAL US_NFP scorecard files, writing the demo
// package + adjustments into a sandbox so it never pollutes macro_score.
async function demo() {
  const here = dirname(fileURLToPath(import.meta.url));
  const macroRoot = join(here, '..', '..', '..', 'macro_score');   // C:\RSInvest\macro_score
  const sandbox = join(here, '..', 'journal-data', '_review_demo'); // adjustments + package sink
  const t0 = Date.parse('2026-06-05T12:30:00.000Z');               // 08:30 ET
  const iso = (s: number) => new Date(t0 + s * 1000).toISOString();

  // price(sec) shapes: NQ/RTY clean rally; UB sells off; ES drifts.
  const path = (sym: string, fn: (s: number) => number): Tick[] => {
    const out: Tick[] = [];
    for (let s = -30; s <= 900; s += 1) out.push({ symbol: sym, timestamp: iso(s), last: Math.round(fn(s) * 100) / 100 });
    return out;
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const ticks: Tick[] = [
    ...path('NQ', s => 21500 + 0.5 * clamp(s, 0, 120) - 0.02 * clamp(s - 120, 0, 780)),  // +~60pt
    ...path('RTY', s => 2300 + 0.06 * clamp(s, 0, 90) - 0.004 * clamp(s - 90, 0, 810)),   // clean
    ...path('UB', s => 118.5 - 0.01 * clamp(s, 0, 100) + 0.001 * clamp(s - 100, 0, 800)), // sells off
    ...path('ES', s => 5300 + 0.02 * clamp(s, 0, 60)),                                    // confirmation drift
  ];

  const config: ReleaseConfig = {
    releaseKey: 'US Nonfarm Payrolls', releaseName: 'US Nonfarm Payrolls (review demo)',
    region: 'US', scheduledTime: iso(0), releaseTemplate: 'labor_release', importance: 'A_PLUS',
    assets: [
      { symbol: 'NQ', role: 'PRIMARY', direction: 'LONG' },
      { symbol: 'RTY', role: 'SECONDARY', direction: 'LONG' },
      { symbol: 'UB', role: 'CONFIRMATION', direction: 'NONE' },
      { symbol: 'ES', role: 'CONFIRMATION', direction: 'NONE' },
    ],
    outputDir: sandbox,
  };

  const res = await runReleaseReview({
    config, ticks, templateId: 'US_NFP', macroScoreRoot: macroRoot,
    dailyPrepDate: '2026-06-05', adjustmentsRoot: sandbox, baseDir: sandbox,
    log: m => console.log(m),
  });

  console.log('\n=== Expected vs actual ===');
  for (const c of res.review.comparison.bySymbol) {
    console.log(`  ${c.symbol.padEnd(4)} exp ${c.expectedBias.padEnd(8)} | 1st ${c.actualFirstLegDir.padEnd(4)} | hit ${c.expectedBiasHit ? '✓' : '✗'} | best ${c.bestLeg.padEnd(10)} | ${c.scoreQuality}/${c.executionQuality}`);
  }
  console.log(`  confirmation: ${res.review.comparison.confirmation.note}`);
  console.log('\n=== Suggested adjustments ===');
  if (!res.review.suggestedAdjustments?.length) console.log('  (none — scorecard validated)');
  for (const a of res.review.suggestedAdjustments ?? []) console.log(`  [${a.scope}] ${a.target} (${a.confidence}): ${a.rationale}`);
  console.log(`\npackage:     ${res.packageDir}`);
  console.log(`adjustments: ${res.adjustmentsFile}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  demo().catch(e => { console.error(e); process.exit(1); });
}
