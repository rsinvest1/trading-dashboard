// marketRecorder — samples price data around a release (Phase 2).
//
// ARCHITECTURE (chosen — see README "Feed & bridge architecture"): hybrid C + B.
// The worker runs on a SEPARATE box with its own Rithmic market-data login; a
// sidecar tees that feed to a local tick log. This module reads the LOG for the
// release window — it never calls the live bridge API, so the trading box is
// never touched.
//
// Tick-log format (the tee writes one JSON object per line, JSONL):
//   {"t":"2026-05-29T14:00:00.000Z","sym":"RTY","last":2099.4,"bid":2099.3,"ask":2099.5}
//
// This is NOT HFT: we down-sample to SNAPSHOT_INTERVAL_MS (last observation per
// bucket), not raw tick-by-tick — entry is ~3 s post-release at best.

import { readFile } from 'node:fs/promises';

// Default snapshot cadence. 500 ms pins peaks/MAE to ±0.5 s for a multi-minute
// move at near-zero load. Tunable; do NOT go finer than 250 ms for this style.
export const SNAPSHOT_INTERVAL_MS = 500;

export type Tick = {
  symbol: string;
  timestamp: string; // ISO8601
  bid?: number;
  ask?: number;
  mid?: number;
  last?: number;
};

export type RecordingWindow = {
  symbols: string[];
  startTime: string;
  endTime: string;
  snapshotIntervalMs?: number; // defaults to SNAPSHOT_INTERVAL_MS
  logPath?: string;            // path to the local tick-log tee (JSONL)
};

// Best available price for a snapshot: last → mid → bid/ask midpoint.
export function snapshotPrice(t: Tick): number {
  if (typeof t.last === 'number') return t.last;
  if (typeof t.mid === 'number') return t.mid;
  if (typeof t.bid === 'number' && typeof t.ask === 'number') return (t.bid + t.ask) / 2;
  if (typeof t.bid === 'number') return t.bid;
  if (typeof t.ask === 'number') return t.ask;
  return NaN;
}

// Parse a JSONL tick log. Tolerant: skips blank / malformed lines.
export function parseTickLog(text: string): Tick[] {
  const out: Tick[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let o: any;
    try { o = JSON.parse(s); } catch { continue; }
    const timestamp = o.t ?? o.timestamp;
    const symbol = o.sym ?? o.symbol;
    if (!timestamp || !symbol) continue;
    out.push({ symbol, timestamp, bid: o.bid, ask: o.ask, mid: o.mid, last: o.last });
  }
  return out;
}

export async function readTickLog(path: string): Promise<Tick[]> {
  return parseTickLog(await readFile(path, 'utf8'));
}

// Filter to symbols + [startTime, endTime], sort, and down-sample to one
// snapshot per (symbol, time-bucket) using last-observation-in-bucket.
export function selectWindow(ticks: Tick[], w: RecordingWindow): Tick[] {
  const interval = w.snapshotIntervalMs ?? SNAPSHOT_INTERVAL_MS;
  const start = Date.parse(w.startTime);
  const end = Date.parse(w.endTime);
  const syms = new Set(w.symbols);

  const inWin = ticks
    .map(t => ({ t, ms: Date.parse(t.timestamp) }))
    .filter(x => syms.has(x.t.symbol) && x.ms >= start && x.ms <= end && Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);

  const buckets = new Map<string, Tick>();
  for (const { t, ms } of inWin) {
    buckets.set(t.symbol + '|' + Math.floor(ms / interval), t); // later overwrites → last obs
  }
  return [...buckets.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

// Read the local tick-log tee for the window and return down-sampled snapshots.
export async function recordWindow(w: RecordingWindow): Promise<Tick[]> {
  if (!w.logPath) throw new Error('recordWindow: logPath required (reads the local tick-log tee).');
  return selectWindow(await readTickLog(w.logPath), w);
}
