// cli — production entry point. Reads a release-config JSON + a JSONL tick log
// (produced by the local tee) and writes a journal package.
//
//   node src/cli.ts <release-config.json> [ticklog.jsonl]
//
// The config's `tickLog` field is used if the log path isn't passed explicitly.

import { readFile } from 'node:fs/promises';
import { parseTickLog } from './marketRecorder.ts';
import { buildJournalPackage, writePackage } from './journalPackageBuilder.ts';
import type { ReleaseConfig } from './journalPackageBuilder.ts';

const [, , configPath, logPathArg] = process.argv;

if (!configPath) {
  console.error('usage: node src/cli.ts <release-config.json> [ticklog.jsonl]');
  process.exit(1);
}

const config: ReleaseConfig & { tickLog?: string } = JSON.parse(await readFile(configPath, 'utf8'));
const logPath = logPathArg || config.tickLog;
if (!logPath) {
  console.error('No tick log: pass one as the 2nd arg or set "tickLog" in the config.');
  process.exit(1);
}

const ticks = parseTickLog(await readFile(logPath, 'utf8'));
const journal = buildJournalPackage(config, ticks);
const dir = await writePackage(journal, config.outputDir);

console.log(`Wrote package: ${dir}`);
console.log(`  assets: ${journal.trackedAssets.map(a => a.symbol).join(', ')}  ·  best: ${journal.summary.bestAsset}`);
