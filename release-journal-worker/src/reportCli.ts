// reportCli — THE BUTTON. One command → an economic-release report on your desk.
//
//   npm run report -- today                 # every prepped release for today (ET)
//   npm run report -- today 2026-06-08       # a specific prep date
//   npm run report -- US_CPI_JUN10 2026-06-10  # one templateId
//
// It requests 1-second history for the release window (the always-on QT History
// Backfill watcher fills it from Rithmic in seconds — no live tee, no tick data),
// waits for the data, runs the Phase 6 review, and writes a readable report to
//   C:\RSInvest\reports\<date>_<templateId>.md
// plus the dashboard-importable package. 1-second resolution is plenty for a 3-5s
// entry; speed beats tick precision.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTickLog } from './marketRecorder.ts';
import { hasCoverage, windowFromRelease, writeRequest, DEFAULT_REQUEST_FOLDER } from './backfillRequest.ts';
import { loadExpected } from './expectedBehavior.ts';
import { runReleaseReview } from './runReleaseReview.ts';
import { tickSizeFor } from './instruments.ts';
import type { ReleaseConfig, AssetConfig } from './journalPackageBuilder.ts';
import type { ReleaseExpected, LegAnalysis } from '../schema/releaseJournalSchema';

const HOLD_SEC = 1800;   // 30-min window — covers a 3-30 min discretionary hold
const PRE_ROLL_SEC = 60;

const here = dirname(fileURLToPath(import.meta.url));
const MACRO = process.env.MACRO_SCORE_ROOT || 'C:\\RSInvest\\macro_score';
const FEED = process.env.JOURNAL_FEED || 'C:\\RSInvest\\journal-feed';
const REPORTS = process.env.REPORTS_DIR || 'C:\\RSInvest\\reports';
const io = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms)) };

const etDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// The live tee writes ticks-<date>.jsonl; QT History Backfill writes its own
// ticks-<date>.backfill.jsonl (no file contention). Read both, merged.
async function readMergedTicks(date: string) {
  const live = await readTickLog(join(FEED, `ticks-${date}.jsonl`)).catch(() => []);
  const back = await readTickLog(join(FEED, `ticks-${date}.backfill.jsonl`)).catch(() => []);
  return [...live, ...back];
}

// US Eastern offset for a date: EDT (-04:00) 2nd Sun Mar 07:00Z → 1st Sun Nov 06:00Z, else EST (-05:00).
function etOffset(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const y = d.getUTCFullYear();
  const marFirst = new Date(Date.UTC(y, 2, 1)).getUTCDay();
  const dstStart = new Date(Date.UTC(y, 2, 1 + ((7 - marFirst) % 7) + 7, 7)); // 2nd Sunday March 07:00Z
  const novFirst = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  const dstEnd = new Date(Date.UTC(y, 10, 1 + ((7 - novFirst) % 7), 6));       // 1st Sunday Nov 06:00Z
  return d >= dstStart && d < dstEnd ? '-04:00' : '-05:00';
}
const etIso = (dateStr: string, hhmm: string) => `${dateStr}T${(hhmm || '00:00')}:00${etOffset(dateStr)}`;

// Build the release config straight from the scorecard's expected block: alert
// symbols carry their expected bias as the trade direction, confirmation symbols
// are observation-only.
function configFromExpected(exp: ReleaseExpected, dateStr: string): ReleaseConfig {
  const assets: AssetConfig[] = Object.entries(exp.perSymbol).map(([sym, e]) => ({
    symbol: sym,
    role: e.role === 'CONFIRMATION' ? 'CONFIRMATION' : sym === exp.best ? 'PRIMARY' : 'SECONDARY',
    direction: e.role === 'ALERT' && e.expectedBias !== 'NO_TRADE' ? (e.expectedBias === 'LONG' ? 'LONG' : 'SHORT') : 'NONE',
  }));
  return {
    releaseKey: exp.title || exp.templateLabel || exp.templateId,
    releaseName: exp.title || exp.templateLabel || exp.templateId,
    region: '', scheduledTime: etIso(dateStr, exp.releaseTimeET || '00:00'),
    releaseTemplate: 'custom', importance: 'MEDIUM', assets,
    holdingWindowSec: HOLD_SEC, preRollSec: PRE_ROLL_SEC,
  };
}

const decimalsFor = (ts: number) => { const s = String(ts); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
// Signed price move in the instrument's points (what you read off the chart), from ticks.
const movePts = (ticks: number | undefined, ts: number) => ticks == null ? '—' : ((ticks * ts >= 0 ? '+' : '') + (ticks * ts).toFixed(decimalsFor(ts)));
const mins = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`);
const readAt = (leg: LegAnalysis | undefined, sec: number) => leg?.timedReads?.find(r => r.sec === sec)?.ticks;
function tplus(sec?: number): string {
  if (!Number.isFinite(sec)) return 'T+—';
  const s = Math.max(0, Math.round(sec as number));
  return `T+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function peakLabel(p?: { timestamp?: string; secondsFromRelease?: number; ticksFromEntry?: number }): string {
  if (!p?.timestamp) return '—';
  const bits = [p.timestamp];
  if (Number.isFinite(p.secondsFromRelease)) bits.push(tplus(p.secondsFromRelease));
  if (p.ticksFromEntry != null) bits.push(`${p.ticksFromEntry}t`);
  return bits.join(' · ');
}

// True peak favorable excursion over the window + when it happened, and the heat
// suffered before it — the numbers that matter for a 3-30 min hold.
function peakInfo(leg: LegAnalysis | undefined, ts: number) {
  if (!leg || leg.peakFavorableTicks == null) return { peak: '—', at: '—', mae: '—' };
  return {
    peak: movePts(leg.peakFavorableTicks, ts),
    at: mins(leg.peakFavorableSec ?? 0),
    mae: movePts(-(leg.maeToPeakTicks ?? 0), ts),
  };
}

const PATH_SECS: [number, string][] = [[60, '1m'], [180, '3m'], [300, '5m'], [600, '10m'], [900, '15m'], [1200, '20m'], [1800, '30m']];

function reportMarkdown(templateId: string, dateStr: string, exp: ReleaseExpected, res: Awaited<ReturnType<typeof runReleaseReview>>): string {
  const c = res.review.comparison;
  const assetBy = new Map(res.journal.trackedAssets.map(a => [a.symbol, a]));
  const entryHint = (s: typeof c.bySymbol[number]) =>
    !s.expectedBiasHit ? '—' : s.bestLeg === 'SECOND_LEG' ? 'wait for pullback' : s.bestLeg === 'FIRST_LEG' ? 'first impulse' : 'no edge';

  const verdict = c.bySymbol.map(s => {
    const ts = tickSizeFor(s.symbol);
    const p = peakInfo(assetBy.get(s.symbol)?.legAnalysis, ts);
    return `| ${s.symbol} | ${s.expectedBias} (${s.expectedConfidence}) | ${s.expectedBiasHit ? '✓' : '✗'} | ${p.peak} | ${p.at} | ${p.mae} | ${s.scoreQuality} | ${entryHint(s)} |`;
  }).join('\n');

  const pathRows = c.bySymbol.map(s => {
    const ts = tickSizeFor(s.symbol);
    const leg = assetBy.get(s.symbol)?.legAnalysis;
    return `| ${s.symbol} | ${PATH_SECS.map(([sec]) => movePts(readAt(leg, sec), ts)).join(' | ')} |`;
  }).join('\n');

  const adj = (res.review.suggestedAdjustments ?? []).map(a => `- **[${a.scope}] ${a.target}** (${a.confidence}): ${a.rationale}`).join('\n');
  const exactPeaks = res.journal.trackedAssets
    .filter(a => a.peaks?.peak1?.timestamp || a.peaks?.retrace1?.timestamp || a.peaks?.peak2?.timestamp)
    .map(a => `| ${a.symbol}${a.contract ? ` (${a.contract})` : ''} | ${peakLabel(a.peaks?.peak1)} | ${peakLabel(a.peaks?.retrace1)} | ${peakLabel(a.peaks?.peak2)} |`)
    .join('\n');
  return `# ${exp.title || templateId} — ${dateStr} ${exp.releaseTimeET || ''} ET\n\n`
    + `> Scorecard **${templateId}** · 1-second data, 3-30 min hold horizon · generated ${new Date().toISOString()}\n\n`
    + `**Headline:** ${c.overall.bestSymbolActualVsExpected ?? '—'}\n\n`
    + `## Verdict — favorable move in the expected direction\n\n`
    + `| Symbol | Expected | Hit | Peak | @ | MAE | Grade | Best entry |\n`
    + `|--------|----------|:--:|-----:|:--:|----:|:----:|------------|\n${verdict}\n\n`
    + `_Peak = best favorable excursion (points) in the expected direction; @ = minutes after the release; MAE = worst adverse heat first._\n\n`
    + (exactPeaks
      ? `## Exact peak timing\n\n| Symbol | Peak 1 | Retrace 1 | Peak 2 |\n|--------|--------|-----------|--------|\n${exactPeaks}\n\n`
      : '')
    + `## Price path from release (points, + = up)\n\n`
    + `| Symbol | ${PATH_SECS.map(([, l]) => l).join(' | ')} |\n`
    + `|--------|${PATH_SECS.map(() => '----:').join('|')}|\n${pathRows}\n\n`
    + `**Confirmation:** ${c.confirmation.note}\n\n`
    + (adj ? `## Suggested scorecard adjustments\n\n${adj}\n\n` : '')
    + `_Package: ${res.packageDir}_\n`;
}

async function reportOne(templateId: string, dateStr: string): Promise<boolean> {
  const exp = await loadExpected({ macroScoreRoot: MACRO, dailyPrepDate: dateStr, templateId });
  if (!Object.keys(exp.perSymbol).length) { console.log(`[skip] ${templateId}: no scorecard found for ${dateStr}.`); return false; }
  const config = configFromExpected(exp, dateStr);
  const relIso = config.scheduledTime;
  const w = windowFromRelease({ scheduledTime: relIso, holdingWindowSec: HOLD_SEC, preRollSec: PRE_ROLL_SEC });
  const alertSyms = Object.entries(exp.perSymbol).filter(([, e]) => e.role === 'ALERT').map(([s]) => s);

  // Ask the always-on watcher for the window (1-second bars). Idempotent.
  await writeRequest(DEFAULT_REQUEST_FOLDER, w, `${templateId}_${dateStr.replace(/-/g, '')}`, config);
  const startTime = new Date(Date.parse(relIso) - PRE_ROLL_SEC * 1000).toISOString();
  const endTime = new Date(Date.parse(relIso) + HOLD_SEC * 1000).toISOString();

  // Prefer the FULL 30-min pull: wait until an alert symbol has a print in the last
  // 2 min of the window. But never hang — build from partial data if that's all there is.
  const lateStart = new Date(Date.parse(relIso) + (HOLD_SEC - 120) * 1000).toISOString();
  const hasAny = (t: typeof ticks) => alertSyms.some(s => hasCoverage(t, { symbols: [s], startTime, endTime, minRows: 1 }));
  const hasFull = (t: typeof ticks) => alertSyms.some(s => hasCoverage(t, { symbols: [s], startTime: lateStart, endTime, minRows: 1 }));

  process.stdout.write(`[${templateId}] pulling 1s history ${w.fromUtc}..${w.toUtc} (30 min) `);
  const deadline = io.now() + (Number(process.env.REPORT_WAIT_MS) || 180_000);
  let ticks: Awaited<ReturnType<typeof readTickLog>> = [];
  while (io.now() < deadline) {
    ticks = await readMergedTicks(w.date);
    if (hasFull(ticks)) break;          // full window present → go
    process.stdout.write('.');
    await io.sleep(5000);
  }
  process.stdout.write('\n');
  if (!hasAny(ticks)) {
    console.log(`[${templateId}] no data — is QT History Backfill running (watcher, Start)? Request is staged; rerun once it's up.`);
    return false;
  }
  if (!hasFull(ticks)) console.log(`[${templateId}] note: only partial window on disk — start/keep QT History Backfill running for the full 30 min.`);

  const res = await runReleaseReview({ config, ticks, templateId, macroScoreRoot: MACRO, dailyPrepDate: dateStr });
  await mkdir(REPORTS, { recursive: true });
  const reportPath = join(REPORTS, `${dateStr}_${templateId}.md`);
  await writeFile(reportPath, reportMarkdown(templateId, dateStr, exp, res));

  console.log(`\n===== ${exp.title || templateId} =====`);
  console.log(res.review.comparison.overall.bestSymbolActualVsExpected ?? '(no best symbol)');
  for (const s of res.review.comparison.bySymbol)
    console.log(`  ${s.symbol.padEnd(4)} exp ${s.expectedBias.padEnd(8)} 1st ${s.actualFirstLegDir.padEnd(4)} hit ${s.expectedBiasHit ? '✓' : '✗'} ${s.bestLeg.padEnd(10)} ${s.scoreQuality}/${s.executionQuality}`);
  console.log(`  report:  ${reportPath}`);
  console.log(`  import:  ${res.packageDir}\\metadata.json`);
  return true;
}

async function templateIdsForDay(dateStr: string): Promise<string[]> {
  try {
    const dp = JSON.parse(await readFile(join(MACRO, 'daily_prep', `${dateStr}.json`), 'utf8'));
    return (dp.events ?? []).map((e: any) => e.templateId).filter(Boolean);
  } catch { return []; }
}

async function main() {
  const [arg, dateArg] = process.argv.slice(2);
  if (!arg) { console.log('usage: npm run report -- today [date]   |   npm run report -- <templateId> <date>'); process.exit(1); }
  const dateStr = dateArg || etDate();

  let templateIds: string[];
  if (arg.toLowerCase() === 'today') {
    templateIds = await templateIdsForDay(dateStr);
    if (!templateIds.length) { console.log(`No prepped releases in macro_score/daily_prep/${dateStr}.json`); return; }
    console.log(`Today's releases (${dateStr}): ${templateIds.join(', ')}`);
  } else {
    templateIds = [arg];
  }

  let ok = 0;
  for (const t of templateIds) if (await reportOne(t, dateStr)) ok++;
  console.log(`\nDONE — ${ok}/${templateIds.length} report(s) written to ${REPORTS}`);
}

main().catch(e => { console.error(e); process.exit(1); });
