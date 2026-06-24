// backfillCli — on-demand Quantower history backfill for one release window.
//
//   node src/backfillCli.ts <release-config.json> [requestFolder]
//
// Writes a backfill request for the config's [release-preRoll, release+hold] window
// and waits for the QT_HistoryBackfill strategy (watcher mode) to fulfill it —
// recovering a release the live tee missed. (Alternative: run QT_HistoryBackfill
// one-shot in Quantower with the release time set.)

import { readFile } from 'node:fs/promises';
import { windowFromRelease, writeRequest, waitForDone, DEFAULT_REQUEST_FOLDER } from './backfillRequest.ts';

const [, , configPath, folderArg] = process.argv;
if (!configPath) {
  console.error('usage: node src/backfillCli.ts <release-config.json> [requestFolder]');
  process.exit(1);
}

const cfg = JSON.parse(await readFile(configPath, 'utf8'));
const folder = folderArg ?? DEFAULT_REQUEST_FOLDER;
const w = windowFromRelease(cfg);
const sleepReal = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

console.log(`[backfill] requesting ${w.fromUtc} .. ${w.toUtc} (ET ${w.date}) → ${folder}`);
const { donePath } = await writeRequest(folder, w, undefined, cfg);
const done = await waitForDone(donePath, { now: () => Date.now(), sleep: sleepReal }, { timeoutMs: 120_000 });

if (done?.ok && done.rows > 0) {
  console.log(`[backfill] done: ${done.rows} rows → ${done.file}. Build the journal with:`);
  console.log(`  node src/cli.ts ${configPath} C:\\RSInvest\\journal-feed\\${done.file}`);
} else {
  console.error(`[backfill] no usable rows — ${done?.error || 'is QT_HistoryBackfill running in Quantower with "Watch requests" on?'}`);
  process.exit(2);
}
