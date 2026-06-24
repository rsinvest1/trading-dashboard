// backfillRequest — Quantower history-backfill fallback (worker side).
//
// When the live tee log has NO data for a release window (the QT_QuoteTee wasn't
// connected at release time), the worker can request a backfill from the
// QT_HistoryBackfill Quantower strategy (watcher mode): we drop "<id>.req.json"
// into the request folder; the strategy fetches the window's tick history and
// writes the same ticks-<ET-date>.jsonl, then writes "<id>.done.json". The result
// is identical to a connected tee, so the rest of the pipeline is unchanged.
//
// Pure helpers (windowFromRelease, hasCoverage, request/done JSON) are unit-tested;
// waitForDone takes injected now/sleep so the poll loop runs in simulated time.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tick } from './marketRecorder.ts';

export const DEFAULT_REQUEST_FOLDER = 'C:\\RSInvest\\journal-feed\\backfill-requests';

export type ReleaseLike = {
  releaseKey?: string;
  actualReleaseTime?: string;
  scheduledTime: string;
  holdingWindowSec?: number;
  preRollSec?: number;
  assets?: { symbol: string }[];
  symbols?: string[];
  contractMap?: Record<string, string>;
  aggregation?: 'SECOND1' | 'TICK' | string;
  minRowsPerSymbol?: number;
  dataQuality?: any;
};
export type BackfillWindow = { fromUtc: string; toUtc: string; date: string };

const etDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// The capture window for a release: [release - preRoll, release + hold], plus the
// ET date used for the ticks-<date>.jsonl filename (matches the tee / scheduler).
export function windowFromRelease(rel: ReleaseLike): BackfillWindow {
  const relIso = rel.actualReleaseTime || rel.scheduledTime;
  const relMs = Date.parse(relIso);
  const pre = (rel.preRollSec ?? 60) * 1000;
  const hold = (rel.holdingWindowSec ?? 900) * 1000;
  return {
    fromUtc: new Date(relMs - pre).toISOString(),
    toUtc: new Date(relMs + hold).toISOString(),
    date: etDate(relIso),
  };
}

// Coverage = every tracked symbol has >= minRows snapshots inside [startTime,endTime].
export function hasCoverage(
  ticks: Tick[],
  opts: { symbols: string[]; startTime: string; endTime: string; minRows?: number },
): boolean {
  const min = opts.minRows ?? 1;
  const s = Date.parse(opts.startTime), e = Date.parse(opts.endTime);
  for (const sym of opts.symbols) {
    let n = 0;
    for (const t of ticks) {
      if (t.symbol !== sym) continue;
      const ms = Date.parse(t.timestamp);
      if (ms >= s && ms <= e) n++;
    }
    if (n < min) return false;
  }
  return true;
}

function symbolsFor(rel?: ReleaseLike): string[] {
  return rel?.symbols ?? rel?.assets?.map(a => a.symbol) ?? [];
}

export const requestJson = (w: BackfillWindow, rel?: ReleaseLike) =>
  JSON.stringify({
    releaseKey: rel?.releaseKey,
    fromUtc: w.fromUtc,
    toUtc: w.toUtc,
    date: w.date,
    symbols: symbolsFor(rel),
    contractMap: rel?.contractMap ?? {},
    aggregation: rel?.aggregation ?? 'SECOND1',
    minRowsPerSymbol: rel?.minRowsPerSymbol ?? 1,
  });

export type DoneResult = {
  ok: boolean;
  rows: number;
  rowCounts?: Record<string, number>;
  missingSymbols?: string[];
  contracts?: Record<string, string>;
  aggregation?: string;
  file?: string;
  error?: string;
};
export function parseDone(text: string): DoneResult | null {
  try {
    const o = JSON.parse(text);
    return {
      ok: !!o.ok,
      rows: Number(o.rows) || 0,
      rowCounts: o.rowCounts && typeof o.rowCounts === 'object' ? o.rowCounts : undefined,
      missingSymbols: Array.isArray(o.missingSymbols) ? o.missingSymbols : undefined,
      contracts: o.contracts && typeof o.contracts === 'object' ? o.contracts : undefined,
      aggregation: o.aggregation,
      file: o.file,
      error: o.error,
    };
  } catch { return null; }
}

const exists = (p: string) => access(p).then(() => true, () => false);

export type WaitIo = { now: () => number; sleep: (ms: number) => Promise<void> };

export async function writeRequest(
  folder: string, w: BackfillWindow, id = `${w.date}_${Date.now()}`, rel?: ReleaseLike,
): Promise<{ id: string; reqPath: string; donePath: string }> {
  await mkdir(folder, { recursive: true });
  const reqPath = join(folder, `${id}.req.json`);
  const donePath = join(folder, `${id}.done.json`);
  await writeFile(reqPath, requestJson(w, rel));
  return { id, reqPath, donePath };
}

export async function waitForDone(
  donePath: string, io: WaitIo, opts?: { timeoutMs?: number; pollMs?: number },
): Promise<DoneResult | null> {
  const timeout = opts?.timeoutMs ?? 90_000;
  const poll = opts?.pollMs ?? 1500;
  const deadline = io.now() + timeout;
  while (io.now() <= deadline) {
    if (await exists(donePath)) {
      try { return parseDone(await readFile(donePath, 'utf8')); } catch { return null; }
    }
    await io.sleep(poll);
  }
  return null;
}

// Read tee ticks; if the window isn't covered, request a Quantower backfill, wait,
// and re-read. Returns whatever ticks exist (possibly still empty if no backfiller
// is running). `readTicks` should already window+filter (e.g. liveReadTicks).
export type EnsureParams = {
  release: ReleaseLike & { assets: { symbol: string }[] };
  readTicks: () => Promise<Tick[]>;
  initialTicks?: Tick[];    // already-read window ticks (skips the first read)
  requestFolder?: string;
  enabled?: boolean;        // default true; false → just return tee ticks
  io: WaitIo;
  timeoutMs?: number;
  minRows?: number;
  log?: (m: string) => void;
};

function setBackfillQuality(release: ReleaseLike, result: DoneResult & { requested?: boolean; ok: boolean }) {
  release.dataQuality = {
    ...(release.dataQuality ?? {}),
    status: result.ok ? release.dataQuality?.status : 'DATA_GAP',
    rowCounts: result.rowCounts ?? release.dataQuality?.rowCounts,
    missingSymbols: result.missingSymbols ?? release.dataQuality?.missingSymbols,
    contracts: result.contracts ?? release.contractMap ?? release.dataQuality?.contracts,
    aggregation: result.aggregation ?? release.aggregation ?? 'SECOND1',
    backfill: {
      requested: result.requested ?? true,
      ok: result.ok,
      rows: result.rows,
      file: result.file,
      error: result.error,
      missingSymbols: result.missingSymbols,
    },
    notes: [
      ...(release.dataQuality?.notes ?? []),
      result.ok
        ? `History backfill returned ${result.rows} rows.`
        : `History backfill failed or returned zero rows${result.error ? `: ${result.error}` : '.'}`,
    ],
  };
}

export async function ensureWindowTicks(p: EnsureParams): Promise<Tick[]> {
  const log = p.log ?? (() => {});
  const w = windowFromRelease(p.release);
  const symbols = p.release.assets.map(a => a.symbol);
  const minRows = p.minRows ?? p.release.minRowsPerSymbol ?? 1;
  const covered = (ts: Tick[]) =>
    hasCoverage(ts, { symbols, startTime: w.fromUtc, endTime: w.toUtc, minRows });

  const ticks = p.initialTicks ?? await p.readTicks();
  if (covered(ticks)) return ticks;

  if (p.enabled === false) {
    log('[backfill] window not covered and backfill disabled — proceeding with what we have');
    return ticks;
  }

  const folder = p.requestFolder ?? DEFAULT_REQUEST_FOLDER;
  log(`[backfill] tee window empty for [${symbols.join(',')}] ${w.fromUtc}..${w.toUtc} — requesting Quantower history backfill`);
  const { donePath } = await writeRequest(folder, w, undefined, {
    ...p.release,
    symbols,
    aggregation: p.release.aggregation ?? 'SECOND1',
    minRowsPerSymbol: minRows,
  });
  const done = await waitForDone(donePath, p.io, { timeoutMs: p.timeoutMs });
  if (!done?.ok || done.rows <= 0) {
    setBackfillQuality(p.release, {
      ...(done ?? { ok: false, rows: 0, error: 'no backfill response' }),
      ok: false,
      requested: true,
    });
    log('[backfill] no usable backfill rows (is QT_HistoryBackfill running with "Watch requests" on?) — proceeding with what we have');
    return ticks;
  }
  setBackfillQuality(p.release, { ...done, requested: true });
  log(`[backfill] backfill wrote ${done.rows} rows → ${done.file}; re-reading window`);
  return p.readTicks();
}
