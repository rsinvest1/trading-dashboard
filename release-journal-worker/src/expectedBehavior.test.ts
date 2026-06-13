// Unit tests for expectedBehavior — parses the REAL macro_score files on disk so
// the contract stays pinned to what the prep agent actually emits.
//
//   node --test src/expectedBehavior.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseExpected, loadExpected, findLatestScoreLog } from './expectedBehavior.ts';
import type { ScoreLog } from './expectedBehavior.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MACRO_ROOT = join(here, '..', '..', '..', 'macro_score'); // C:\RSInvest\macro_score

test('loadExpected builds the CPI scorecard from daily_prep + template (no score yet)', async () => {
  const exp = await loadExpected({ macroScoreRoot: MACRO_ROOT, dailyPrepDate: '2026-06-10', templateId: 'US_CPI_JUN10' });

  assert.equal(exp.templateId, 'US_CPI_JUN10');
  assert.equal(exp.templateLabel, 'US CPI');
  assert.equal(exp.releaseTimeET, '08:30');
  assert.match(exp.regimeContext ?? '', /UB remains the only bond execution instrument/);
  assert.ok((exp.notes ?? []).some(n => /Core CPI MoM is the first-second driver/.test(n)));

  // Alert symbols from the daily-prep tradableAlerts, incl. the new UB bond proxy.
  for (const sym of ['UB', 'GC', 'NQ', 'RTY', '6E']) {
    assert.equal(exp.perSymbol[sym]?.role, 'ALERT', `${sym} is an alert`);
  }
  // Confirmation symbols from the daily-prep confirmationSymbols.
  for (const sym of ['DXY', 'VIX', 'ES', 'ZN']) {
    assert.equal(exp.perSymbol[sym]?.role, 'CONFIRMATION', `${sym} is confirmation`);
    assert.equal(exp.perSymbol[sym]?.expectedBias, 'NO_TRADE');
  }
  // Narrative comes from the template even with no score log.
  assert.match(exp.perSymbol['UB'].narrative ?? '', /first-second driver/i);
});

test('parseExpected maps the real NFP score log (alert biases + best)', async () => {
  const scorePath = await findLatestScoreLog(join(MACRO_ROOT, 'logs'), 'US_NFP');
  assert.ok(scorePath, 'an NFP score log exists');
  const score = JSON.parse(await readFile(scorePath!, 'utf8')) as ScoreLog;

  const exp = parseExpected(null, null, score, 'US_NFP');
  assert.equal(exp.best, 'NQ');
  assert.equal(exp.secondary, 'RTY');
  assert.equal(exp.perSymbol['NQ'].expectedBias, 'LONG');
  assert.equal(exp.perSymbol['NQ'].expectedConfidence, 'A');
  assert.equal(exp.perSymbol['NQ'].score, 75);
  assert.equal(exp.perSymbol['RTY'].expectedBias, 'LONG');
  // ES/GC were scored NO_TRADE (confirmation-only for the NFP equity impulse).
  assert.equal(exp.perSymbol['ES'].expectedBias, 'NO_TRADE');
  assert.equal(exp.perSymbol['GC'].expectedBias, 'NO_TRADE');
  assert.ok((exp.perSymbol['NQ'].reasons ?? []).length >= 1);
});

test('parseExpected degrades gracefully with all-null inputs', () => {
  const exp = parseExpected(null, null, null, 'EMPTY');
  assert.equal(exp.templateId, 'EMPTY');
  assert.deepEqual(exp.perSymbol, {});
  assert.deepEqual(exp.notes, []);
});
