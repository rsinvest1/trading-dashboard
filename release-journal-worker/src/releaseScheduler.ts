// releaseScheduler — release-day orchestrator (Phase 3).
//
// Given the day's release configs (the same JSON cli.ts consumes, plus optional
// capture `views`), it: waits until each release's capture-window start (T-30s),
// drives the screenshot window (fixed + event-driven), then builds + writes the
// journal package with the captured screenshots merged in.
//
// All wall-clock I/O is injected so it's testable in simulated time;
// `runDayScheduleLive` wires the real adapters (system clock + capture.ps1).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCaptureWindow } from './screenshotScheduler.ts';
import { buildJournalPackage, writePackage, packageDirFor } from './journalPackageBuilder.ts';
import type { ReleaseConfig } from './journalPackageBuilder.ts';
import { readTickLog, selectWindow } from './marketRecorder.ts';
import type { Tick } from './marketRecorder.ts';
import { makePowershellCapturer } from './capture.ts';
import type { Capturer, CaptureView } from './capture.ts';
import { captureHeadlines, readHeadlineLog } from './headlineCapture.ts';
import type { RawHeadline } from './headlineCapture.ts';
import { ensureWindowTicks, DEFAULT_REQUEST_FOLDER } from './backfillRequest.ts';
import { runReleaseReview } from './runReleaseReview.ts';

export const DEFAULT_MACRO_SCORE_ROOT = 'C:\\RSInvest\\macro_score';
const etDateOf = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export type ReleaseWithViews = ReleaseConfig & { views?: CaptureView[]; tickLog?: string; backfillLog?: string; headlineLog?: string };

export type DaySchedule = { releases: ReleaseWithViews[]; baseDir?: string };

export type RunDayParams = {
  schedule: DaySchedule;
  capture: Capturer;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  readTicks: (release: ReleaseWithViews) => Promise<Tick[]>; // full window ticks
  readHeadlines: (release: ReleaseWithViews) => Promise<RawHeadline[]>; // rolling FJ headline log
  finalizeTicks?: (release: ReleaseWithViews, ticks: Tick[]) => Promise<Tick[]>; // post-window hook (e.g. history backfill when the tee was off)
  pollMs?: number;
  preRollSec?: number;     // capture-window start before release (default 30)
  log?: (m: string) => void;
};

export type DayResult = { release: string; packageDir: string; shots: number };

export async function runDaySchedule(p: RunDayParams): Promise<DayResult[]> {
  const log = p.log ?? (() => {});
  const baseDir = p.schedule.baseDir ?? 'journal-data';
  const preRoll = p.preRollSec ?? 30;
  const results: DayResult[] = [];

  const releases = [...p.schedule.releases].sort((a, b) =>
    Date.parse(a.actualReleaseTime || a.scheduledTime) - Date.parse(b.actualReleaseTime || b.scheduledTime));

  for (const rel of releases) {
    const releaseMs = Date.parse(rel.actualReleaseTime || rel.scheduledTime);
    const startMs = releaseMs - preRoll * 1000;

    const waitMs = startMs - p.now();
    if (waitMs > 0) { log(`[sched] waiting ${Math.round(waitMs / 1000)}s for capture window: ${rel.releaseKey}`); await p.sleep(waitMs); }

    const pkgDir = packageDirFor(rel, baseDir);
    const views = rel.views ?? [];
    if (!views.length) log(`[sched] ${rel.releaseKey}: no capture views configured — metrics only, no screenshots`);

    // ticks-so-far (event loop reads this each poll; in live mode the log only
    // contains ticks up to real-now anyway).
    const readSoFar = async () => {
      const all = await p.readTicks(rel);
      const nowMs = p.now();
      return all.filter(t => Date.parse(t.timestamp) <= nowMs);
    };

    log(`[sched] capture window OPEN: ${rel.releaseKey} → ${pkgDir}`);
    const shots = await runCaptureWindow({
      release: rel, views, stagingDir: pkgDir,
      now: p.now, sleep: p.sleep, capture: p.capture, readTicks: readSoFar,
      pollMs: p.pollMs, log,
    });

    let finalTicks = await p.readTicks(rel);
    if (p.finalizeTicks) finalTicks = await p.finalizeTicks(rel, finalTicks);

    // Headlines that hit during the holding window (rolling FJ log → window slice + classify).
    const rawHeadlines = await p.readHeadlines(rel);
    const headlines = captureHeadlines({
      raw: rawHeadlines,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(releaseMs + (rel.holdingWindowSec ?? 900) * 1000).toISOString(),
      releaseKey: rel.releaseKey,
      symbols: rel.assets.map(a => a.symbol),
    });

    // Phase 6: if the release carries a macro_score templateId, run the scorecard ⇄
    // behavior review layer (expected/comparison/adjustments) — else the plain build.
    let dir: string;
    if (rel.templateId) {
      const res = await runReleaseReview({
        config: rel, ticks: finalTicks, templateId: rel.templateId,
        macroScoreRoot: rel.macroScoreRoot ?? DEFAULT_MACRO_SCORE_ROOT,
        dailyPrepDate: rel.dailyPrepDate ?? etDateOf(releaseMs),
        screenshots: shots, headlines, baseDir, log,
      });
      dir = res.packageDir;
      log(`[sched] package written: ${dir} (${shots.length} screenshots, ${headlines.length} headlines) · review ${rel.templateId} → ${res.adjustmentsFile}`);
    } else {
      const journal = buildJournalPackage(rel, finalTicks, shots, headlines);
      dir = await writePackage(journal, baseDir);
      log(`[sched] package written: ${dir} (${shots.length} screenshots, ${headlines.length} headlines)`);
    }
    results.push({ release: rel.releaseKey, packageDir: dir, shots: shots.length });
  }
  return results;
}

// ── Live adapters ────────────────────────────────────────────────────────────
const sleepReal = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Read the full release window from the tee's tick log on disk.
function liveReadTicks(rel: ReleaseWithViews): Promise<Tick[]> {
  if (!rel.tickLog) throw new Error(`release '${rel.releaseKey}' has no tickLog`);
  const releaseMs = Date.parse(rel.actualReleaseTime || rel.scheduledTime);
  const holdSec = rel.holdingWindowSec ?? 900;
  const preRoll = rel.preRollSec ?? 30;
  const startTime = new Date(releaseMs - preRoll * 1000).toISOString();
  const endTime = new Date(releaseMs + holdSec * 1000).toISOString();
  const symbols = rel.assets.map(a => a.symbol);
  const backfillLog = rel.backfillLog ?? rel.tickLog.replace(/\.jsonl$/i, '.backfill.jsonl');
  return Promise.all([
    readTickLog(rel.tickLog).catch(() => []),
    readTickLog(backfillLog).catch(() => []),
  ]).then(([live, backfill]) =>
    selectWindow([...live, ...backfill], { symbols, startTime, endTime, snapshotIntervalMs: rel.snapshotIntervalMs }));
}

// Read the FJ news tee's rolling headline log (defaults to journal-feed by ET date).
function liveReadHeadlines(rel: ReleaseWithViews): Promise<RawHeadline[]> {
  const releaseMs = Date.parse(rel.actualReleaseTime || rel.scheduledTime);
  const etDate = new Date(releaseMs).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const path = rel.headlineLog ?? join('C:\\RSInvest\\journal-feed', `headlines-${etDate}.jsonl`);
  return readHeadlineLog(path).catch(() => []);   // missing log → no headlines (optional)
}

// Convenience for the journal box: system clock + capture.ps1.
export function runDayScheduleLive(schedule: DaySchedule, opts?: {
  captureScript?: string;
  pollMs?: number;
  backfill?: { enabled?: boolean; requestFolder?: string; timeoutMs?: number };
  log?: (m: string) => void;
}): Promise<DayResult[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = opts?.captureScript ?? join(here, '..', 'capture', 'capture.ps1');
  const log = opts?.log ?? ((m: string) => console.log(m));
  const bf = opts?.backfill;
  return runDaySchedule({
    schedule,
    capture: makePowershellCapturer(script),
    now: () => Date.now(),
    sleep: sleepReal,
    readTicks: liveReadTicks,
    readHeadlines: liveReadHeadlines,
    // If the tee window is empty (tee was off at release), auto-request a Quantower
    // history backfill from QT_HistoryBackfill (watcher mode), then re-read the log.
    finalizeTicks: (rel, ticks) => ensureWindowTicks({
      release: rel,
      initialTicks: ticks,
      readTicks: () => liveReadTicks(rel).catch(() => []),
      requestFolder: bf?.requestFolder ?? DEFAULT_REQUEST_FOLDER,
      enabled: bf?.enabled !== false,
      io: { now: () => Date.now(), sleep: sleepReal },
      timeoutMs: bf?.timeoutMs,
      log,
    }),
    pollMs: opts?.pollMs,
    log,
  });
}
