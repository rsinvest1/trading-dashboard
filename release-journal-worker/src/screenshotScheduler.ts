// screenshotScheduler — per-release capture-window driver (Phase 3).
//
// Captures, around a release:
//   • FIXED-TIME frames: T-30s, T+5s, T+30s, T+1m, T+3m, T+5m, T+15m (clamped to
//     the holding window; the window-end frame is HOLDING_END).
//   • EVENT-DRIVEN frames: PEAK_1 / MAE_BETWEEN_PEAKS / PEAK_2, fired when the
//     Phase 2 analyzer first confirms each event on the live tick log.
//
// All I/O is injected (now / sleep / capture / readTicks) so the driver is
// fully unit-testable in simulated time and reused live by releaseScheduler.

import { join } from 'node:path';
import { analyze } from './peakMaeAnalyzer.ts';
import type { Tick } from './marketRecorder.ts';
import type { Capturer, CaptureView, ScreenshotType } from './capture.ts';
import type { ReleaseConfig } from './journalPackageBuilder.ts';

export type ScheduledCapture = {
  type: ScreenshotType;
  timestamp: string;   // ISO — when the frame represents (fixed time or event time)
  path: string;        // package-relative (e.g. assets/RTY/peak1.png)
  asset?: string;
  notes?: string;
};

type FixedFrame = { offsetSec: number; label: string; type: ScreenshotType; fireAtMs: number };

const BASE_FRAMES: { offsetSec: number; label: string; type: ScreenshotType }[] = [
  { offsetSec: -30, label: 'pre_release', type: 'PRE_RELEASE' },
  { offsetSec: 5, label: 'release_impulse', type: 'RELEASE_IMPULSE' },
  { offsetSec: 30, label: 't+30s', type: 'OTHER' },
  { offsetSec: 60, label: 't+1m', type: 'OTHER' },
  { offsetSec: 180, label: 't+3m', type: 'OTHER' },
  { offsetSec: 300, label: 't+5m', type: 'OTHER' },
  { offsetSec: 900, label: 't+15m', type: 'OTHER' },
];

// Fixed-time plan clamped to the holding window; window-end frame is HOLDING_END.
export function fixedPlan(releaseMs: number, holdSec: number): FixedFrame[] {
  const within = BASE_FRAMES.filter(f => f.offsetSec <= holdSec && f.offsetSec !== holdSec);
  within.push({ offsetSec: holdSec, label: 'holding_end', type: 'HOLDING_END' });
  return within
    .map(f => ({ ...f, fireAtMs: releaseMs + f.offsetSec * 1000 }))
    .sort((a, b) => a.fireAtMs - b.fireAtMs);
}

const isoAt = (ms: number) => new Date(ms).toISOString();
const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

function framePath(view: CaptureView, label: string, type: ScreenshotType, asset: string | undefined, assetMulti: boolean): string {
  if (asset) {
    const base = assetMulti ? `${sanitize(view.id)}_${label}` : label;
    return `assets/${asset}/${base}.png`;
  }
  if (type === 'RELEASE_NUMBERS') return 'release_numbers.png';
  if (type === 'COMPOSITE') return `composite/${sanitize(view.id)}.png`;
  return `${sanitize(view.id)}/${label}.png`;
}

export type CaptureWindowParams = {
  release: ReleaseConfig;
  views: CaptureView[];
  stagingDir: string;                 // PNGs are written here (= the package dir)
  now: () => number;                  // ms epoch
  sleep: (ms: number) => Promise<void>;
  capture: Capturer;
  readTicks: () => Promise<Tick[]>;   // ticks-so-far for the window (all symbols)
  pollMs?: number;                    // event-loop cadence (default 1000)
  log?: (m: string) => void;
};

// An event is captured only when the analyzer *confirms* it (via meta flags), not
// on the always-present fallback peak1 — so PEAK_1 fires when a real pullback has
// formed, PEAK_2 when a continuation leg exists, etc.
const EVENTS: { key: string; type: ScreenshotType; label: string; peak: 'peak1' | 'retrace1' | 'peak2'; flag: 'peak1Confirmed' | 'hasRetrace' | 'hasPeak2' }[] = [
  { key: 'PEAK_1', type: 'PEAK_1', label: 'peak1', peak: 'peak1', flag: 'peak1Confirmed' },
  { key: 'RETRACE', type: 'MAE_BETWEEN_PEAKS', label: 'mae_between_peaks', peak: 'retrace1', flag: 'hasRetrace' },
  { key: 'PEAK_2', type: 'PEAK_2', label: 'peak2', peak: 'peak2', flag: 'hasPeak2' },
];

// Drive one release's capture window. Returns every captured frame.
export async function runCaptureWindow(p: CaptureWindowParams): Promise<ScheduledCapture[]> {
  const releaseMs = Date.parse(p.release.actualReleaseTime || p.release.scheduledTime);
  const holdSec = p.release.holdingWindowSec ?? 900;
  const windowEndMs = releaseMs + holdSec * 1000;
  const pollMs = p.pollMs ?? 1000;
  const log = p.log ?? (() => {});
  const out: ScheduledCapture[] = [];

  const fixed = fixedPlan(releaseMs, holdSec);
  const firedFixed = new Set<number>();
  const capturedEvents = new Set<string>();
  const assetViews = (sym: string) => p.views.filter(v => v.asset === sym);
  const assetMulti = (sym: string) => assetViews(sym).length > 1;

  async function doCapture(view: CaptureView, type: ScreenshotType, label: string, ts: string, asset?: string, notes?: string) {
    const rel = framePath(view, label, type, asset, asset ? assetMulti(asset) : false);
    try {
      await p.capture(view, join(p.stagingDir, rel));
      out.push({ type, timestamp: ts, path: rel, asset, notes });
      log(`captured ${rel}`);
    } catch (e: any) {
      log(`capture FAILED ${rel}: ${e && e.message ? e.message : e}`);
    }
  }

  async function fireDueFixed(nowMs: number) {
    for (let i = 0; i < fixed.length; i++) {
      if (firedFixed.has(i) || fixed[i].fireAtMs > nowMs) continue;
      firedFixed.add(i);
      for (const v of p.views) {
        if (v.asset) {
          await doCapture(v, fixed[i].type, fixed[i].label, isoAt(fixed[i].fireAtMs), v.asset);
        } else if (!v.offsetsSec || v.offsetsSec.includes(fixed[i].offsetSec)) {
          await doCapture(v, v.globalType ?? 'OTHER', fixed[i].label, isoAt(fixed[i].fireAtMs));
        }
      }
    }
  }

  async function checkEvents(nowMs: number) {
    if (nowMs < releaseMs) return;
    const ticks = await p.readTicks();
    for (const a of p.release.assets) {
      if (a.direction !== 'LONG' && a.direction !== 'SHORT') continue;
      const at = ticks.filter(t => t.symbol === a.symbol);
      if (!at.length) continue;
      const r = analyze({
        symbol: a.symbol, direction: a.direction, releaseTime: isoAt(releaseMs),
        ticks: at, tickSize: a.tickSize, entryAnchorDelaySec: a.entryAnchorDelaySec, stops: a.stops,
      });
      // Nothing fires until peak1 is confirmed — keeps event order peak1 → mae → peak2.
      if (!r.meta.peak1Confirmed) continue;
      for (const ev of EVENTS) {
        if (!(r.meta as any)[ev.flag]) continue;     // only on a confirmed event
        const peak = (r.peaks as any)[ev.peak];
        if (!peak) continue;
        const ck = `${a.symbol}:${ev.key}`;
        if (capturedEvents.has(ck)) continue;
        capturedEvents.add(ck);
        const views = assetViews(a.symbol);
        for (const v of views) await doCapture(v, ev.type, ev.label, peak.timestamp || isoAt(nowMs), a.symbol, 'event-triggered');
      }
    }
  }

  // Main loop
  while (p.now() < windowEndMs) {
    await fireDueFixed(p.now());
    await checkEvents(p.now());

    const pending = fixed.filter((_, i) => !firedFixed.has(i)).map(f => f.fireAtMs);
    const nextFixed = pending.length ? Math.min(...pending) : Infinity;
    const target = Math.min(nextFixed, p.now() + pollMs, windowEndMs);
    const wait = target - p.now();
    await p.sleep(wait > 0 ? wait : pollMs);
  }

  // Flush any remaining fixed frames (e.g. HOLDING_END at the exact window end)
  await fireDueFixed(windowEndMs);
  await checkEvents(windowEndMs);

  return out;
}
