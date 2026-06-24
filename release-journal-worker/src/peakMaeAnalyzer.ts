// peakMaeAnalyzer — derives peak/MAE/MFE/R-R metrics from sampled snapshots (Phase 2).
//
// Pure & deterministic: no I/O, no feed. Given a symbol's snapshot series + a
// direction + tick size, it returns the entryModels / peaks / excursions / rr
// blocks of a ReleaseJournalAsset.
//
// Model notes:
//  - Realistic entry: the trader enters ~3 s after the release at best (not HFT).
//    When no explicit entry is supplied, entry_price_initial is anchored at
//    releaseTime + ENTRY_ANCHOR_DELAY_SEC using the sampled price at that instant,
//    so peaks/MAE/MFE/R-R reflect a tradeable fill — not the T+0 spike no one
//    could catch.
//  - "Favorable excursion" (fav) is signed by direction: +ticks = in your favor.
//  - peak1 = first favorable extreme confirmed by a retrace; retrace1 = the
//    pullback low after it; peak2 = the favorable extreme of the continuation leg.
//  - R/R = favorable ticks to a peak ÷ a stop distance in ticks. Stops default to
//    "just beyond the MAE to peak1" (standard), with tight/wide variants.

import { snapshotPrice } from './marketRecorder.ts';
import type { Tick } from './marketRecorder.ts';
import type { ReleaseJournalAsset } from '../schema/releaseJournalSchema';

export const ENTRY_ANCHOR_DELAY_SEC = 3;

export type StopConfig = {
  tightStopTicks?: number;
  standardStopTicks?: number;
  wideStopTicks?: number;
  bufferTicks?: number; // added to MAE when deriving the standard stop (default 2)
};

export type AnalyzeInput = {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  releaseTime: string;
  // Optional explicit entry. If omitted, anchor at releaseTime + entryAnchorDelaySec.
  entryPrice?: number;
  entryTime?: string;
  entryAnchorDelaySec?: number;
  ticks: Tick[];        // snapshots for THIS symbol (any order)
  tickSize: number;     // price increment for this instrument
  retraceFrac?: number;     // fraction of the favorable run that confirms peak1 (default 0.30)
  minRetraceTicks?: number; // absolute floor for that confirming retrace (default 2)
  stops?: StopConfig;
};

export type AnalyzeResult = Pick<ReleaseJournalAsset, 'entryModels' | 'peaks' | 'excursions' | 'rr'> & {
  meta: {
    snapshots: number; entryPrice: number; entryTime: string; hadData: boolean;
    // Event-confirmation flags (used by the Phase 3 screenshot scheduler to fire
    // captures only on a *confirmed* event, not on the always-present fallback peak).
    peak1Confirmed: boolean;   // a real pullback confirmed peak1 (not the fallback high)
    hasRetrace: boolean;       // retrace1 exists
    hasPeak2: boolean;         // a continuation peak after the retrace exists
  };
};

const dirSign = (d: 'LONG' | 'SHORT') => (d === 'LONG' ? 1 : -1);
const round1 = (n: number) => Math.round(n * 10) / 10;
const tickDecimals = (tickSize: number) => {
  const s = String(tickSize);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

function emptyResult(entryPrice: number, entryTime: string): AnalyzeResult {
  return {
    entryModels: {},
    peaks: {},
    excursions: {},
    rr: {},
    meta: { snapshots: 0, entryPrice, entryTime, hadData: false, peak1Confirmed: false, hasRetrace: false, hasPeak2: false },
  };
}

export function analyze(input: AnalyzeInput): AnalyzeResult {
  const dir = dirSign(input.direction);
  const tickSize = input.tickSize || 1;
  const dec = tickDecimals(tickSize);
  const px = (p: number) => Number(p.toFixed(dec));

  const series = input.ticks
    .map(t => ({ ms: Date.parse(t.timestamp), price: snapshotPrice(t), iso: t.timestamp }))
    .filter(x => Number.isFinite(x.ms) && Number.isFinite(x.price))
    .sort((a, b) => a.ms - b.ms);

  if (!series.length) return emptyResult(NaN, input.entryTime ?? input.releaseTime);

  const releaseMs = Date.parse(input.releaseTime);
  const anchorDelay = input.entryAnchorDelaySec ?? ENTRY_ANCHOR_DELAY_SEC;

  // ── Entry anchor ──────────────────────────────────────────────────────────
  let entryMs: number, entryPrice: number, entryIso: string;
  if (input.entryPrice != null && input.entryTime) {
    entryMs = Date.parse(input.entryTime);
    entryPrice = input.entryPrice;
    entryIso = input.entryTime;
  } else {
    const anchorMs = releaseMs + anchorDelay * 1000;
    const first = series.find(x => x.ms >= anchorMs) ?? series[series.length - 1];
    entryMs = first.ms;
    entryPrice = first.price;
    entryIso = first.iso;
  }

  // Post-entry snapshots and favorable excursion (ticks) at each.
  const post = series.filter(x => x.ms >= entryMs);
  if (!post.length) return emptyResult(px(entryPrice), entryIso);
  const fav = post.map(x => ((x.price - entryPrice) * dir) / tickSize);

  // ── peak1: first favorable extreme confirmed by a retrace ──────────────────
  const retraceFrac = input.retraceFrac ?? 0.30;
  const minRetrace = input.minRetraceTicks ?? 2;
  let hi = -Infinity, hiIdx = 0, p1Idx = -1;
  for (let i = 0; i < fav.length; i++) {
    if (fav[i] > hi) { hi = fav[i]; hiIdx = i; }
    const pullback = hi - fav[i];
    const confirm = Math.max(minRetrace, retraceFrac * Math.max(hi, 0));
    if (hi > 0 && pullback >= confirm) { p1Idx = hiIdx; break; }
  }
  const peak1Confirmed = p1Idx >= 0;
  if (p1Idx < 0) p1Idx = hiIdx; // one-directional move: peak1 = global favorable high

  // ── retrace1 (pullback low after peak1) + peak2 (continuation high) ─────────
  let r1Idx = p1Idx, lo = fav[p1Idx];
  for (let i = p1Idx; i < fav.length; i++) { if (fav[i] < lo) { lo = fav[i]; r1Idx = i; } }
  let p2Idx = r1Idx, hi2 = fav[r1Idx];
  for (let i = r1Idx; i < fav.length; i++) { if (fav[i] > hi2) { hi2 = fav[i]; p2Idx = i; } }
  const hasRetrace = r1Idx > p1Idx;
  const hasPeak2 = hasRetrace && p2Idx > r1Idx;

  // ── Excursions (ticks) ──────────────────────────────────────────────────────
  const minTo = (end: number) => Math.min(...fav.slice(0, end + 1));
  const maeToPeak1Ticks = Math.max(0, -Math.min(0, minTo(p1Idx)));
  const betweenEnd = hasPeak2 ? p2Idx : fav.length - 1;
  const maeBetweenPeaksTicks = hasRetrace
    ? Math.max(0, fav[p1Idx] - Math.min(...fav.slice(p1Idx, betweenEnd + 1)))
    : 0;
  const mfeToPeak1Ticks = Math.max(0, fav[p1Idx]);
  const mfeToPeak2Ticks = hasPeak2 ? Math.max(0, fav[p2Idx]) : mfeToPeak1Ticks;
  const prices = post.map(x => x.price);
  const totalRangeTicks = (Math.max(...prices) - Math.min(...prices)) / tickSize;

  // ── R/R ─────────────────────────────────────────────────────────────────────
  const buffer = input.stops?.bufferTicks ?? 2;
  const standardStop = Math.max(1, Math.round(input.stops?.standardStopTicks ?? (maeToPeak1Ticks + buffer)));
  const tightStop = Math.max(1, Math.round(input.stops?.tightStopTicks ?? (standardStop * 0.6)));
  const wideStop = Math.max(1, Math.round(input.stops?.wideStopTicks ?? (standardStop * 1.6)));

  // ── Assemble ─────────────────────────────────────────────────────────────────
  const secFromRelease = (idx: number) => Math.round((post[idx].ms - releaseMs) / 1000);
  const mkPeak = (idx: number) => ({
    timestamp: post[idx].iso,
    price: px(post[idx].price),
    ticksFromEntry: Math.round(fav[idx]),
    secondsFromRelease: secFromRelease(idx),
  });

  const peaks: ReleaseJournalAsset['peaks'] = { peak1: mkPeak(p1Idx) };
  if (hasRetrace) peaks.retrace1 = mkPeak(r1Idx);
  if (hasPeak2) peaks.peak2 = mkPeak(p2Idx);

  return {
    entryModels: { immediate: { timestamp: entryIso, price: px(entryPrice) } },
    peaks,
    excursions: {
      maeToPeak1Ticks: Math.round(maeToPeak1Ticks),
      maeBetweenPeaksTicks: Math.round(maeBetweenPeaksTicks),
      mfeToPeak1Ticks: Math.round(mfeToPeak1Ticks),
      mfeToPeak2Ticks: Math.round(mfeToPeak2Ticks),
      totalRangeTicks: Math.round(totalRangeTicks),
    },
    rr: {
      peak1Tight: round1(mfeToPeak1Ticks / tightStop),
      peak1Standard: round1(mfeToPeak1Ticks / standardStop),
      peak2Standard: round1(mfeToPeak2Ticks / standardStop),
      peak2Wide: round1(mfeToPeak2Ticks / wideStop),
    },
    meta: { snapshots: post.length, entryPrice: px(entryPrice), entryTime: entryIso, hadData: true, peak1Confirmed, hasRetrace, hasPeak2 },
  };
}
