// legAnalyzer — registers the actual behavior of one instrument around a release
// (Phase 6). Built on peakMaeAnalyzer.analyze() so the first/second-leg metrics
// match the rest of the journal. Adds two things the grader didn't need:
//
//   • timed directional reads at 5/15/30/60 s from T0 (the release), so you can
//     see how fast and how far the first impulse moved (signed, + = up).
//   • a direction-AGNOSTIC dominant first-leg direction, so we can tell whether the
//     market actually went the way the scorecard expected (bias hit) — and so
//     confirmation symbols (no scorecard bias) still get a read.
//
// Pure & deterministic: no I/O, no feed.

import { analyze } from './peakMaeAnalyzer.ts';
import { snapshotPrice } from './marketRecorder.ts';
import type { Tick } from './marketRecorder.ts';
import type { LegAnalysis, LegDir, TimedRead } from '../schema/releaseJournalSchema';

// Reads cover a 3-30 min discretionary hold, not just the HFT first minute.
export const DEFAULT_READS_SEC = [5, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800];
const FLAT_TICKS = 1;          // |move| < 1 tick reads as FLAT
const ENTRY_ANCHOR_DELAY_SEC = 3; // matches peakMaeAnalyzer's realistic entry

export type LegInput = {
  symbol: string;
  ticks: Tick[];            // snapshots for THIS symbol (any order)
  t0: string;              // release time (T0), ISO8601
  tickSize: number;
  direction?: 'LONG' | 'SHORT' | 'NONE'; // scorecard bias; NONE/undefined = agnostic
  holdSec?: number;        // analysis window after T0 (default 900)
  readsSec?: number[];     // default [5,15,30,60]
  entryAnchorDelaySec?: number;
};

const dirOf = (ticks: number): LegDir => (ticks >= FLAT_TICKS ? 'UP' : ticks <= -FLAT_TICKS ? 'DOWN' : 'FLAT');
const round1 = (n: number) => Math.round(n * 10) / 10;

function emptyLeg(symbol: string, direction: 'LONG' | 'SHORT' | 'NONE'): LegAnalysis {
  return { symbol, direction, hadData: false, snapshots: 0, actualFirstLegDir: 'FLAT', timedReads: [] };
}

export function analyzeLegs(input: LegInput): LegAnalysis {
  const direction = input.direction ?? 'NONE';
  const tickSize = input.tickSize || 1;
  const reads = input.readsSec ?? DEFAULT_READS_SEC;
  const anchorDelay = input.entryAnchorDelaySec ?? ENTRY_ANCHOR_DELAY_SEC;

  const series = input.ticks
    .map(t => ({ ms: Date.parse(t.timestamp), price: snapshotPrice(t) }))
    .filter(x => Number.isFinite(x.ms) && Number.isFinite(x.price))
    .sort((a, b) => a.ms - b.ms);
  if (!series.length) return emptyLeg(input.symbol, direction);

  const t0Ms = Date.parse(input.t0);
  const priceAtOrAfter = (ms: number) => (series.find(x => x.ms >= ms) ?? series[series.length - 1]).price;
  const priceAtOrBefore = (ms: number) => {
    let p = series[0].price;
    for (const x of series) { if (x.ms <= ms) p = x.price; else break; }
    return p;
  };

  const t0Price = priceAtOrAfter(t0Ms);

  // ── Timed directional reads (raw signed, + = up) ───────────────────────────
  // Only emit reads the data actually covers, so a 30-min read isn't faked from
  // the last 15-min print.
  const lastMs = series[series.length - 1].ms;
  const timedReads: TimedRead[] = reads
    .filter(sec => t0Ms + sec * 1000 <= lastMs + 2000)
    .map(sec => {
      const ticks = round1((priceAtOrBefore(t0Ms + sec * 1000) - t0Price) / tickSize);
      return { sec, ticks, dir: dirOf(ticks) };
    });

  // ── Dominant first-leg direction (direction-agnostic) ──────────────────────
  // Anchor at the realistic entry, then take the sign of the first move that
  // clears an adaptive threshold (15% of the realized range, floored at 2 ticks).
  const entryPrice = priceAtOrAfter(t0Ms + anchorDelay * 1000);
  const post = series.filter(x => x.ms >= t0Ms + anchorDelay * 1000);
  const prices = (post.length ? post : series).map(x => x.price);
  const rangeTicks = (Math.max(...prices) - Math.min(...prices)) / tickSize;
  const threshold = Math.max(2, Math.round(0.15 * rangeTicks));
  let actualFirstLegDir: LegDir = 'FLAT';
  for (const x of post) {
    const mv = (x.price - entryPrice) / tickSize;
    if (Math.abs(mv) >= threshold) { actualFirstLegDir = mv > 0 ? 'UP' : 'DOWN'; break; }
  }

  // ── First/second leg metrics via analyze() in the measure direction ────────
  // Measure direction = the scorecard bias if given, else the dominant direction
  // (so confirmation symbols still show the size of their move).
  const measureDir: 'LONG' | 'SHORT' =
    direction === 'LONG' || direction === 'SHORT' ? direction
    : actualFirstLegDir === 'DOWN' ? 'SHORT' : 'LONG';

  const r = analyze({
    symbol: input.symbol, direction: measureDir, releaseTime: input.t0,
    entryAnchorDelaySec: anchorDelay, ticks: input.ticks, tickSize,
  });

  const out: LegAnalysis = {
    symbol: input.symbol,
    direction,
    hadData: r.meta.hadData,
    snapshots: series.length,
    t0Price: round1(t0Price),
    actualFirstLegDir,
    timedReads,
  };

  if (r.meta.hadData) {
    const mfe1 = r.excursions.mfeToPeak1Ticks ?? 0;
    // MAE-to-peak1 is the pre-payoff heat for a winner. But when the move went the
    // other way (peak1 collapses onto the entry, mfe≈0), that field reads 0 — so
    // report the worst adverse excursion instead, which is the reversal's real heat.
    let maeTicks = r.excursions.maeToPeak1Ticks ?? 0;
    if (mfe1 < 3) {
      const sign = measureDir === 'LONG' ? 1 : -1;
      const worstAdverse = post.reduce((w, x) => Math.max(w, -((x.price - entryPrice) * sign) / tickSize), 0);
      maeTicks = Math.max(maeTicks, Math.round(worstAdverse));
    }
    out.firstLeg = {
      measureDir,
      mfeTicks: mfe1,
      maeTicks,
      timeToFirstExtremeSec: r.peaks.peak1?.secondsFromRelease ?? 0,
    };
    if (r.meta.hasRetrace) {
      const secondExtreme = r.excursions.mfeToPeak2Ticks ?? mfe1;
      const continuation = r.meta.hasPeak2 && secondExtreme > mfe1 * 1.05;
      out.secondLeg = {
        retraceTicks: r.excursions.maeBetweenPeaksTicks ?? 0,
        pushDir: continuation
          ? (measureDir === 'LONG' ? 'UP' : 'DOWN')
          : (measureDir === 'LONG' ? 'DOWN' : 'UP'),
        secondExtremeTicks: secondExtreme,
        timeToSecondExtremeSec: r.peaks.peak2?.secondsFromRelease ?? r.peaks.retrace1?.secondsFromRelease ?? 0,
        continuation,
        secondLegBetter: secondExtreme > mfe1,
      };
    }

    // True peak favorable excursion over the WHOLE window + the heat suffered before
    // it (what a 3-30 min hold actually experiences — the structured peak1/peak2 can
    // miss a big intermediate high that later fully reverses).
    if (post.length) {
      const favSign = measureDir === 'LONG' ? 1 : -1;
      let peakFav = 0, peakMs = t0Ms;
      for (const x of post) {
        const fav = ((x.price - entryPrice) * favSign) / tickSize;
        if (fav > peakFav) { peakFav = fav; peakMs = x.ms; }
      }
      let maeToPeak = 0;
      for (const x of post) {
        if (x.ms > peakMs) break;
        const adv = -(((x.price - entryPrice) * favSign) / tickSize);
        if (adv > maeToPeak) maeToPeak = adv;
      }
      out.peakFavorableTicks = Math.round(peakFav);
      out.peakFavorableSec = Math.round((peakMs - t0Ms) / 1000);
      out.maeToPeakTicks = Math.round(maeToPeak);
    }
  }
  return out;
}
