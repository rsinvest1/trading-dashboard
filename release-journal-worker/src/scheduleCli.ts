// scheduleCli — live release-day scheduler entry (runs on the journal box).
//
//   node src/scheduleCli.ts <day-schedule.json>
//
// The schedule JSON is { "baseDir"?: "...", "releases": [ <release-config + views> ] }.
// Each release is the same shape cli.ts consumes, plus a `tickLog` (the tee's
// daily file) and optional `views` (capture surfaces). The scheduler waits for
// each release's window, captures fixed + event-driven frames via capture.ps1,
// and writes the package.

import { readFile } from 'node:fs/promises';
import { runDayScheduleLive } from './releaseScheduler.ts';
import type { DaySchedule } from './releaseScheduler.ts';

const [, , schedulePath] = process.argv;
if (!schedulePath) {
  console.error('usage: node src/scheduleCli.ts <day-schedule.json>');
  process.exit(1);
}

const schedule: DaySchedule = JSON.parse(await readFile(schedulePath, 'utf8'));
if (!schedule.releases || !schedule.releases.length) {
  console.error('schedule has no releases');
  process.exit(1);
}

console.log(`[sched] loaded ${schedule.releases.length} release(s); waiting for capture windows…`);
const results = await runDayScheduleLive(schedule);

console.log('\n[sched] day complete:');
for (const r of results) console.log(`  ${r.release}: ${r.shots} screenshots → ${r.packageDir}`);
