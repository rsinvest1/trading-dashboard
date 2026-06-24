// journalPackageBuilder — assembles a ReleaseJournal from configs + recorded
// snapshots, and writes the package to disk (Phase 2).
//
// Pipeline:  tick log → marketRecorder (down-sampled snapshots per symbol)
//                      → peakMaeAnalyzer (metrics per asset)
//                      → tradabilityGrader (grade + rank + summary, Phase 5)
//                      → buildJournalPackage (assemble ReleaseJournal)
//                      → writePackage (metadata.json / headlines.json / summary.md / assets/*)

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectWindow } from './marketRecorder.ts';
import type { Tick } from './marketRecorder.ts';
import { analyze } from './peakMaeAnalyzer.ts';
import type { StopConfig } from './peakMaeAnalyzer.ts';
import { gradeRelease } from './tradabilityGrader.ts';
import { tickSizeFor } from './instruments.ts';
import type {
  ReleaseJournal,
  ReleaseJournalAsset,
  ReleaseJournalHeadline,
  ReleaseJournalScreenshot,
  ReleaseExpected,
  ReleaseComparison,
  LegAnalysis,
  SuggestedAdjustment,
  ReleaseDataQuality,
} from '../schema/releaseJournalSchema';
import type { ScreenshotType } from './capture.ts';

// Phase 6 review layer (produced by runReleaseReview): the scorecard's expected
// behavior, the per-symbol leg analysis, the expected-vs-actual comparison, and
// the advisory adjustments. Optional — a release with no templateId omits it.
export type ReviewBundle = {
  templateId: string;
  expected: ReleaseExpected;
  comparison: ReleaseComparison;
  legBySymbol: Record<string, LegAnalysis>;
  suggestedAdjustments?: SuggestedAdjustment[];
};

// What the screenshot scheduler hands the builder (structurally = ScheduledCapture).
export type PackageScreenshot = {
  type: ScreenshotType;
  timestamp: string;
  path: string;
  asset?: string;
  notes?: string;
};

export type AssetConfig = {
  symbol: string;
  contract?: string;           // exact futures month, e.g. NQU6
  role: ReleaseJournalAsset['role'];
  direction?: 'LONG' | 'SHORT' | 'NONE';
  source?: ReleaseJournalAsset['source'];
  tickSize?: number;           // optional — defaults from instruments.ts tickSizeFor()
  entryAnchorDelaySec?: number;
  stops?: StopConfig;
  notes?: string;
};

export type ReleaseConfig = {
  releaseKey: string;
  releaseName: string;
  region?: string;
  scheduledTime: string;
  actualReleaseTime?: string;
  releaseTemplate?: ReleaseJournal['releaseTemplate'];
  importance?: ReleaseJournal['importance'];
  holdingWindowSec?: number;   // window after release to analyze (default 900)
  preRollSec?: number;         // pre-release window included (default 30)
  snapshotIntervalMs?: number;
  numbers?: ReleaseJournal['numbers'];
  headlines?: ReleaseJournalHeadline[];
  assets: AssetConfig[];
  contractMap?: Record<string, string>;
  requireContractMap?: boolean;
  dataQuality?: ReleaseDataQuality;
  outputDir?: string;          // base dir for writePackage (default journal-data)
  // Phase 6: when set, the scheduler runs the scorecard ⇄ behavior review layer
  // (expected/comparison/adjustments) against the macro_score files for this event.
  templateId?: string;         // macro_score template id (e.g. 'US_CPI_JUN10')
  dailyPrepDate?: string;      // YYYY-MM-DD (ET); defaults to the release's ET date
  macroScoreRoot?: string;     // defaults to C:\RSInvest\macro_score
};

const nowIso = () => new Date().toISOString();

function etParts(iso: string) {
  const d = new Date(iso);
  // YYYY-MM-DD and HHMM in America/New_York (ET), matching the dashboard convention.
  const date = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const hm = d.toLocaleTimeString('en-GB', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
  }).replace(':', '');
  return { date, hm };
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

function computeDataQuality(config: ReleaseConfig, ticks: Tick[], startTime: string, endTime: string): ReleaseDataQuality {
  const requiredSymbols = [...new Set(config.assets.map(a => a.symbol))];
  const rowCounts: Record<string, number> = Object.fromEntries(requiredSymbols.map(s => [s, 0]));
  const contracts: Record<string, string> = {};
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  for (const t of ticks) {
    if (!(t.symbol in rowCounts)) continue;
    const ms = Date.parse(t.timestamp);
    if (!Number.isFinite(ms) || ms < start || ms > end) continue;
    rowCounts[t.symbol]++;
    if (t.contract && !contracts[t.symbol]) contracts[t.symbol] = t.contract;
  }
  for (const a of config.assets) {
    const contract = a.contract ?? config.contractMap?.[a.symbol];
    if (contract) contracts[a.symbol] = contract;
  }
  const missingSymbols = requiredSymbols.filter(s => (rowCounts[s] || 0) <= 0);
  const missingContracts = config.requireContractMap
    ? config.assets.filter(a => !a.contract && !config.contractMap?.[a.symbol]).map(a => a.symbol)
    : [];
  const notes = [
    ...missingSymbols.map(s => `${s} has no market rows in the release window.`),
    ...missingContracts.map(s => `${s} has no explicit contractMap entry on a rollover-sensitive release.`),
  ];
  const status: ReleaseDataQuality['status'] = missingContracts.length || missingSymbols.length === requiredSymbols.length
    ? 'DATA_GAP'
    : missingSymbols.length
      ? 'PARTIAL'
      : 'OK';
  return {
    status,
    requiredSymbols,
    rowCounts,
    missingSymbols,
    contracts,
    aggregation: config.dataQuality?.aggregation ?? 'SECOND1',
    backfill: config.dataQuality?.backfill,
    notes,
  };
}

// Build one ReleaseJournal from the config + the full tick set (+ optional
// screenshots captured during the window). Asset-scoped screenshots attach to
// their asset; global ones attach to the primary asset.
export function buildJournalPackage(config: ReleaseConfig, ticks: Tick[], screenshots: PackageScreenshot[] = [], headlines: ReleaseJournalHeadline[] = [], review?: ReviewBundle): ReleaseJournal {
  const finalHeadlines = headlines.length ? headlines : (config.headlines ?? []);
  const releaseTime = config.actualReleaseTime || config.scheduledTime;
  const holdSec = config.holdingWindowSec ?? 900;
  const preRoll = config.preRollSec ?? 30;
  const startTime = new Date(Date.parse(releaseTime) - preRoll * 1000).toISOString();
  const endTime = new Date(Date.parse(releaseTime) + holdSec * 1000).toISOString();
  const computedQuality = computeDataQuality(config, ticks, startTime, endTime);
  const dataQuality: ReleaseDataQuality = {
    ...computedQuality,
    status: config.dataQuality?.status === 'DATA_GAP' ? 'DATA_GAP' : computedQuality.status,
    backfill: config.dataQuality?.backfill ?? computedQuality.backfill,
    notes: [...(computedQuality.notes ?? []), ...(config.dataQuality?.notes ?? [])],
  };
  const hasDataGap = dataQuality.status === 'DATA_GAP';

  // Group screenshots by asset; null-asset (global) ones held for the primary.
  const byAsset = new Map<string, ReleaseJournalScreenshot[]>();
  const globalShots: ReleaseJournalScreenshot[] = [];
  for (const s of screenshots) {
    const entry: ReleaseJournalScreenshot = { type: s.type, timestamp: s.timestamp, path: s.path, notes: s.notes };
    if (s.asset) {
      if (!byAsset.has(s.asset)) byAsset.set(s.asset, []);
      byAsset.get(s.asset).push(entry);
    } else {
      globalShots.push(entry);
    }
  }

  const trackedAssets: ReleaseJournalAsset[] = config.assets.map(a => {
    const tickSize = a.tickSize ?? tickSizeFor(a.symbol);
    const snaps = selectWindow(ticks, {
      symbols: [a.symbol], startTime, endTime, snapshotIntervalMs: config.snapshotIntervalMs,
    });
    const direction = a.direction ?? 'NONE';

    const base: ReleaseJournalAsset = {
      symbol: a.symbol,
      contract: a.contract ?? config.contractMap?.[a.symbol] ?? dataQuality.contracts?.[a.symbol],
      role: a.role,
      source: a.source ?? 'RITHMIC',
      direction,
      entryModels: {},
      peaks: {},
      excursions: {},
      rr: {},
      screenshots: byAsset.get(a.symbol) ?? [],
      notes: a.notes ?? '',
    };

    if (!hasDataGap && (direction === 'LONG' || direction === 'SHORT')) {
      const r = analyze({
        symbol: a.symbol,
        direction,
        releaseTime,
        entryAnchorDelaySec: a.entryAnchorDelaySec,
        ticks: snaps,
        tickSize,
        stops: a.stops,
      });
      base.entryModels = r.entryModels;
      base.peaks = r.peaks;
      base.excursions = r.excursions;
      base.rr = r.rr;
    } else if (!hasDataGap) {
      // Confirmation / observation-only asset: report range, no trade metrics.
      const prices = snaps.map(s => (typeof s.last === 'number' ? s.last
        : typeof s.mid === 'number' ? s.mid
        : ((s.bid ?? 0) + (s.ask ?? 0)) / 2)).filter(Number.isFinite);
      if (prices.length) {
        base.excursions = {
          totalRangeTicks: Math.round((Math.max(...prices) - Math.min(...prices)) / tickSize),
        };
      }
    }

    // Phase 6: attach the scorecard's expected behavior, the leg analysis, and the
    // expected-vs-actual comparison for this symbol (when a review layer is present).
    if (review) {
      const exp = review.expected.perSymbol[a.symbol];
      if (exp) base.expected = exp;
      const leg = review.legBySymbol[a.symbol];
      if (leg) base.legAnalysis = leg;
      const cmp = review.comparison.bySymbol.find(c => c.symbol === a.symbol);
      if (cmp) base.comparison = cmp;
    }
    return base;
  });

  // Global screenshots (numbers / composite) land on the primary asset.
  if (globalShots.length) {
    const primary = trackedAssets.find(a => a.role === 'PRIMARY') ?? trackedAssets[0];
    if (primary) primary.screenshots = [...primary.screenshots, ...globalShots];
  }

  // Phase 5: grade each tradeable asset (writes `classification` in place) and
  // build the ranked, narrative summary the dashboard + Playbook rollup read.
  const newInfoHeadlineCount = finalHeadlines.filter(h => h.possibleNewInformationEvent).length;
  const summary = hasDataGap
    ? {
        bestAsset: '',
        secondBestAsset: '',
        worstAsset: '',
        bestHoldingStyle: 'NO_TRADE' as const,
        keyHeadlineInterference: newInfoHeadlineCount > 0,
        finalTakeaway: 'Signal-only package: market-data coverage is incomplete, so tradability grading was skipped.',
        learningNote: (dataQuality.notes ?? []).join(' '),
      }
    : gradeRelease(trackedAssets, {
        newInfoHeadlineCount,
        keyHeadlineInterference: newInfoHeadlineCount > 0,
      });

  return {
    releaseId: `${slug(config.releaseKey)}_${etParts(config.scheduledTime).date}_${etParts(config.scheduledTime).hm}`,
    releaseKey: config.releaseKey,
    releaseName: config.releaseName,
    region: config.region ?? '',
    scheduledTime: config.scheduledTime,
    actualReleaseTime: config.actualReleaseTime ?? '',
    releaseTemplate: config.releaseTemplate ?? 'custom',
    importance: config.importance ?? 'MEDIUM',
    holdingWindow: { startTime, endTime, durationSec: Math.round((Date.parse(endTime) - Date.parse(startTime)) / 1000) },
    numbers: config.numbers ?? { lines: [] },
    trackedAssets,
    headlines: finalHeadlines,
    summary,
    dataQuality,
    ...(review ? {
      templateId: review.templateId,
      expected: review.expected,
      comparison: review.comparison,
      suggestedAdjustments: review.suggestedAdjustments ?? [],
    } : {}),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

// The package directory for a release: <baseDir>/<ET-date>/<HHMM>_<region>_<slug>.
// Deterministic from scheduledTime + region + name, so the screenshot scheduler
// can write captures straight into the package before the JSON is built.
export function packageDirFor(meta: { scheduledTime: string; region?: string; releaseName: string }, baseDir = 'journal-data'): string {
  const { date, hm } = etParts(meta.scheduledTime);
  const region = (meta.region || 'NA').toUpperCase();
  return join(baseDir, date, `${hm}_${region}_${slug(meta.releaseName)}`);
}

// Write the package to its dir and return the dir.
export async function writePackage(journal: ReleaseJournal, baseDir = 'journal-data'): Promise<string> {
  const dir = packageDirFor(journal, baseDir);
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, 'metadata.json'), JSON.stringify(journal, null, 2));
  await writeFile(join(dir, 'headlines.json'), JSON.stringify(journal.headlines, null, 2));
  await writeFile(join(dir, 'summary.md'), summaryMarkdown(journal));

  for (const a of journal.trackedAssets) {
    const assetDir = join(dir, 'assets', a.symbol);
    await mkdir(assetDir, { recursive: true });
    await writeFile(join(assetDir, 'metrics.json'), JSON.stringify(
      { symbol: a.symbol, contract: a.contract, role: a.role, direction: a.direction, entryModels: a.entryModels, peaks: a.peaks, excursions: a.excursions, rr: a.rr, classification: a.classification,
        expected: a.expected, legAnalysis: a.legAnalysis, comparison: a.comparison },
      null, 2));
  }
  return dir;
}

function summaryMarkdown(j: ReleaseJournal): string {
  // Grade-first ordering matches the dashboard's best-first ranking.
  const ranked = [...j.trackedAssets].sort((a, b) =>
    (b.classification?.tradabilityScore ?? -1) - (a.classification?.tradabilityScore ?? -1));
  const rows = ranked.map(a =>
    `| ${a.symbol} | ${a.role} | ${a.direction ?? 'NONE'} | ${a.peaks?.peak1?.ticksFromEntry ?? '—'} | `
    + `${a.peaks?.peak2?.ticksFromEntry ?? '—'} | ${a.excursions?.maeToPeak1Ticks ?? '—'} | `
    + `${a.rr?.peak1Standard ?? '—'} / ${a.rr?.peak2Standard ?? '—'} | `
    + `${a.classification?.tradabilityGrade ?? '—'}${a.classification?.tradabilityScore != null ? ` (${a.classification.tradabilityScore})` : ''} |`).join('\n');
  const style = (j.summary.bestHoldingStyle || '').replace(/_/g, ' ');
  const dataQuality = dataQualityMarkdown(j);
  const peakTiming = peakTimingMarkdown(j);
  return `# ${j.releaseName} — ${j.scheduledTime}\n\n`
    + `**Release key:** ${j.releaseKey} · **Template:** ${j.releaseTemplate} · **Importance:** ${j.importance}\n\n`
    + `> Auto-generated by the Release Journal Worker (Phase 5 review engine).\n\n`
    + dataQuality
    + peakTiming
    + `## Asset metrics\n\n`
    + `| Asset | Role | Dir | P1 ticks | P2 ticks | MAE→P1 | R/R P1/P2 | Grade |\n`
    + `|-------|------|-----|---------:|---------:|-------:|:---------:|:-----:|\n${rows}\n\n`
    + `## Auto takeaway\n\n${j.summary.finalTakeaway}\n`
    + (style ? `\n**Best holding style:** ${style}\n` : '')
    + (j.summary.learningNote ? `\n**Learning note:** ${j.summary.learningNote}\n` : '')
    + comparisonMarkdown(j);
}

function fmtTPlus(sec?: number): string {
  if (!Number.isFinite(sec)) return 'T+—';
  const s = Math.max(0, Math.round(sec as number));
  return `T+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function peakLabel(p?: { timestamp?: string; secondsFromRelease?: number; ticksFromEntry?: number }): string {
  if (!p?.timestamp) return '—';
  const bits = [p.timestamp];
  if (Number.isFinite(p.secondsFromRelease)) bits.push(fmtTPlus(p.secondsFromRelease));
  if (p.ticksFromEntry != null) bits.push(`${p.ticksFromEntry}t`);
  return bits.join(' · ');
}

function peakTimingMarkdown(j: ReleaseJournal): string {
  const rows = j.trackedAssets
    .filter(a => a.peaks?.peak1?.timestamp || a.peaks?.retrace1?.timestamp || a.peaks?.peak2?.timestamp)
    .map(a => `| ${a.symbol}${a.contract ? ` (${a.contract})` : ''} | ${peakLabel(a.peaks?.peak1)} | ${peakLabel(a.peaks?.retrace1)} | ${peakLabel(a.peaks?.peak2)} |`)
    .join('\n');
  if (!rows) return '';
  return `## Peak timing\n\n`
    + `| Asset | Peak 1 | Retrace 1 | Peak 2 |\n`
    + `|-------|--------|-----------|--------|\n${rows}\n\n`;
}

function dataQualityMarkdown(j: ReleaseJournal): string {
  if (!j.dataQuality) return '';
  const dq = j.dataQuality;
  const missing = dq.missingSymbols?.length ? ` · **Missing:** ${dq.missingSymbols.join(', ')}` : '';
  const contracts = dq.contracts ? Object.entries(dq.contracts).map(([k, v]) => `${k}:${v}`).join(', ') : '';
  const rows = dq.rowCounts ? Object.entries(dq.rowCounts).map(([k, v]) => `${k}:${v}`).join(', ') : '';
  return `## Data quality\n\n`
    + `**Status:** ${dq.status}${dq.aggregation ? ` · **Aggregation:** ${dq.aggregation}` : ''}${missing}\n\n`
    + (contracts ? `**Contracts:** ${contracts}\n\n` : '')
    + (rows ? `**Rows:** ${rows}\n\n` : '')
    + (dq.notes?.length ? dq.notes.map(n => `- ${n}`).join('\n') + '\n\n' : '');
}

// Phase 6: expected-vs-actual block, only when the release carried a scorecard.
function comparisonMarkdown(j: ReleaseJournal): string {
  const c = j.comparison;
  if (!c) return '';
  const hit = (b: boolean) => (b ? '✓' : '✗');
  const rows = c.bySymbol.map(s =>
    `| ${s.symbol} | ${s.expectedBias} (${s.expectedConfidence}) | ${s.actualFirstLegDir} | ${s.actualSecondLegDir} | `
    + `${hit(s.expectedBiasHit)} | ${s.bestLeg.replace('_', ' ')} | ${s.scoreQuality} | ${s.executionQuality} |`).join('\n');
  const adj = (j.suggestedAdjustments ?? []).map(a =>
    `- **[${a.scope}] ${a.target}** (${a.confidence}): ${a.rationale}${a.note ? ` — ${a.note}` : ''}`).join('\n');
  return `\n## Expected vs actual (scorecard ${j.templateId ?? ''})\n\n`
    + `> ${c.overall.bestSymbolActualVsExpected ?? '—'}\n\n`
    + `| Symbol | Expected | 1st leg | 2nd leg | Hit | Best leg | Quality | Execution |\n`
    + `|--------|----------|:-------:|:-------:|:---:|:--------:|:-------:|:---------:|\n${rows}\n\n`
    + `**Confirmation:** ${c.confirmation.note}\n`
    + (adj ? `\n## Suggested adjustments\n\n${adj}\n` : '');
}
