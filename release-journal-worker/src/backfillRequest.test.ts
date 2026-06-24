// Unit tests for the Quantower history-backfill fallback (worker side).
// No Quantower: the "strategy" is simulated by writing the .done.json in sleep().
//
//   node --test src/backfillRequest.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  windowFromRelease, hasCoverage, requestJson, parseDone,
  writeRequest, waitForDone, ensureWindowTicks,
} from './backfillRequest.ts';
import type { Tick } from './marketRecorder.ts';

const REL = { releaseKey: 'US Jobs', scheduledTime: '2026-06-05T12:30:00.000Z', holdingWindowSec: 900, preRollSec: 60 };
const tick = (symbol: string, t: string): Tick => ({ symbol, timestamp: t });

test('windowFromRelease spans [release-preRoll, release+hold] with ET date', () => {
  const w = windowFromRelease(REL);
  assert.equal(w.fromUtc, '2026-06-05T12:29:00.000Z');
  assert.equal(w.toUtc, '2026-06-05T12:45:00.000Z');
  assert.equal(w.date, '2026-06-05');                 // 08:30 ET
});

test('hasCoverage: true only when every symbol has a tick in-window', () => {
  const ticks = [
    tick('NQ', '2026-06-05T12:30:10.000Z'),
    tick('GC', '2026-06-05T12:31:00.000Z'),
    tick('NQ', '2026-06-05T12:50:00.000Z'),           // out of window
  ];
  const win = { startTime: '2026-06-05T12:29:00.000Z', endTime: '2026-06-05T12:45:00.000Z' };
  assert.equal(hasCoverage(ticks, { ...win, symbols: ['NQ', 'GC'] }), true);
  assert.equal(hasCoverage(ticks, { ...win, symbols: ['NQ', 'GC', 'RTY'] }), false); // RTY missing
  assert.equal(hasCoverage([], { ...win, symbols: ['NQ'] }), false);                 // empty
});

test('request/done JSON round-trips', () => {
  const w = windowFromRelease(REL);
  const o = JSON.parse(requestJson(w, {
    ...REL,
    assets: [{ symbol: 'NQ' }, { symbol: 'RTY' }],
    contractMap: { NQ: 'NQM6', RTY: 'RTYM6' },
    minRowsPerSymbol: 3,
  }));
  assert.deepEqual(o, {
    releaseKey: 'US Jobs',
    fromUtc: w.fromUtc,
    toUtc: w.toUtc,
    date: w.date,
    symbols: ['NQ', 'RTY'],
    contractMap: { NQ: 'NQM6', RTY: 'RTYM6' },
    aggregation: 'SECOND1',
    minRowsPerSymbol: 3,
  });
  const done = parseDone('{"ok":true,"rows":1234,"file":"ticks-2026-06-05.jsonl","rowCounts":{"NQ":600},"contracts":{"NQ":"NQM6"},"aggregation":"SECOND1"}');
  assert.equal(done?.ok, true);
  assert.equal(done?.rows, 1234);
  assert.deepEqual(done?.rowCounts, { NQ: 600 });
  assert.deepEqual(done?.contracts, { NQ: 'NQM6' });
  assert.equal(done?.aggregation, 'SECOND1');
  assert.equal(parseDone('not json'), null);
});

// A simulated clock whose sleep() also "runs" the strategy: it fulfills any pending
// .req.json in `folder` by writing the matching .done.json (after `delayTicks`).
function simWorld(folder: string, opts: { fulfill: boolean; rows?: number; delayTicks?: number }) {
  let t = 0, sleeps = 0;
  const io = {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms; sleeps++;
      if (opts.fulfill && sleeps >= (opts.delayTicks ?? 1)) {
        for (const f of await readdir(folder)) {
          if (!f.endsWith('.req.json')) continue;
          const done = join(folder, f.replace(/\.req\.json$/, '.done.json'));
          await writeFile(done, JSON.stringify({
            ok: true,
            rows: opts.rows ?? 10,
            rowCounts: { NQ: opts.rows ?? 10 },
            contracts: { NQ: 'NQM6' },
            aggregation: 'SECOND1',
            file: 'ticks-2026-06-05.backfill.jsonl',
          }));
        }
      }
    },
  };
  return io;
}

test('writeRequest + waitForDone resolves when the strategy writes .done.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'));
  const w = windowFromRelease(REL);
  const { reqPath, donePath } = await writeRequest(dir, w, 'job1', {
    ...REL,
    assets: [{ symbol: 'NQ' }],
    contractMap: { NQ: 'NQM6' },
  });
  assert.deepEqual(JSON.parse(await readFile(reqPath, 'utf8')),
    {
      releaseKey: 'US Jobs',
      fromUtc: w.fromUtc,
      toUtc: w.toUtc,
      date: w.date,
      symbols: ['NQ'],
      contractMap: { NQ: 'NQM6' },
      aggregation: 'SECOND1',
      minRowsPerSymbol: 1,
    });
  const io = simWorld(dir, { fulfill: true, rows: 42, delayTicks: 2 });
  const done = await waitForDone(donePath, io, { timeoutMs: 90_000, pollMs: 1500 });
  assert.equal(done?.ok, true);
  assert.equal(done?.rows, 42);
  assert.deepEqual(done?.rowCounts, { NQ: 42 });
  assert.deepEqual(done?.contracts, { NQ: 'NQM6' });
});

test('waitForDone times out → null when nothing fulfills it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'));
  const io = simWorld(dir, { fulfill: false });
  const done = await waitForDone(join(dir, 'nope.done.json'), io, { timeoutMs: 5000, pollMs: 1000 });
  assert.equal(done, null);
});

test('ensureWindowTicks: covered window returns immediately, writes no request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'));
  const ticks = [tick('NQ', '2026-06-05T12:30:10.000Z'), tick('GC', '2026-06-05T12:31:00.000Z')];
  const out = await ensureWindowTicks({
    release: { ...REL, assets: [{ symbol: 'NQ' }, { symbol: 'GC' }] },
    readTicks: async () => ticks,
    requestFolder: dir,
    io: simWorld(dir, { fulfill: false }),
  });
  assert.equal(out.length, 2);
  assert.equal((await readdir(dir)).length, 0);       // no request created
});

test('ensureWindowTicks: empty window requests a backfill, then re-reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'));
  let call = 0;
  const backfilled = [tick('NQ', '2026-06-05T12:30:05.000Z'), tick('GC', '2026-06-05T12:30:06.000Z')];
  const out = await ensureWindowTicks({
    release: { ...REL, assets: [{ symbol: 'NQ' }, { symbol: 'GC' }] },
    readTicks: async () => (++call === 1 ? [] : backfilled),  // empty first, covered after backfill
    requestFolder: dir,
    io: simWorld(dir, { fulfill: true, rows: 99, delayTicks: 1 }),
  });
  assert.equal(out.length, 2);                          // re-read returned the backfilled ticks
  assert.ok(call >= 2);                                 // it re-read after the backfill
  assert.ok((await readdir(dir)).some(f => f.endsWith('.req.json')));  // a request was written
});

test('ensureWindowTicks: zero-row done is treated as DATA_GAP and does not re-read as success', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bf-'));
  let call = 0;
  const release = { ...REL, assets: [{ symbol: 'NQ' }], contractMap: { NQ: 'NQM6' } };
  const out = await ensureWindowTicks({
    release,
    readTicks: async () => { call++; return []; },
    requestFolder: dir,
    io: simWorld(dir, { fulfill: true, rows: 0, delayTicks: 1 }),
  });
  assert.equal(out.length, 0);
  assert.equal(call, 1);
  assert.equal(release.dataQuality.status, 'DATA_GAP');
  assert.equal(release.dataQuality.backfill.ok, false);
  assert.equal(release.dataQuality.backfill.rows, 0);
});
