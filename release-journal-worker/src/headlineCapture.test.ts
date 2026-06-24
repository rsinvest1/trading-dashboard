// Deterministic tests for the headline classifier + window selection (no browser).
// Run: node --test src/headlineCapture.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeadline, selectHeadlineWindow, captureHeadlines } from './headlineCapture.ts';
import type { RawHeadline } from './headlineCapture.ts';

const ctx = { releaseKey: 'ISM Manufacturing PMI', symbols: ['RTY', 'NQ', 'GC', '6E'] };
const cls = (text: string, sub?: string) => classifyHeadline(text, sub, 'FJ', ctx);

test('release print → HIGH / release_related / not new-info', () => {
  const c = cls('US ISM Manufacturing PMI 48.7 (Forecast 49.5, Previous 49.2)');
  assert.equal(c.relevance, 'HIGH');
  assert.equal(c.category, 'release_related');
  assert.equal(c.possibleNewInformationEvent, false);
});

test('central-bank comment → HIGH / fed_central_bank / new-info', () => {
  const c = cls("Fed's Goolsbee: recent activity data has clearly softened, watching closely");
  assert.equal(c.relevance, 'HIGH');
  assert.equal(c.category, 'fed_central_bank');
  assert.equal(c.possibleNewInformationEvent, true);
});

test('geopolitical → HIGH / geopolitical / new-info', () => {
  const c = cls('North Korea holds crucial meeting on boosting nuclear arsenal: KCNA');
  assert.equal(c.relevance, 'HIGH');
  assert.equal(c.category, 'geopolitical');
  assert.equal(c.possibleNewInformationEvent, true);
});

test('corporate/sector headline → MEDIUM / not new-info', () => {
  const c = cls('Broadcom stock plunges 14% on weak software sales, unchanged AI chip forecast');
  assert.equal(c.relevance, 'MEDIUM');           // sector (NQ) + risk_sentiment
  assert.equal(c.possibleNewInformationEvent, false);
});

test('unrelated corporate noise → LOW', () => {
  const c = cls('Trump says may leave UFC arena on White House lawn permanently');
  assert.equal(c.relevance, 'LOW');
  assert.equal(c.category, 'other');
});

test('selectHeadlineWindow filters to window + dedups', () => {
  const raw: RawHeadline[] = [
    { timestamp: '2026-06-03T17:30:00.000Z', text: 'Before window', source: 'X' },
    { timestamp: '2026-06-03T17:45:00.000Z', text: 'Broadcom stock plunges 14%', source: 'CNBC' },
    { timestamp: '2026-06-03T17:46:00.000Z', text: 'Broadcom stock plunges 14%', source: 'CNBC' }, // dup
    { timestamp: '2026-06-03T17:50:00.000Z', text: "Fed's Goolsbee speaks", source: 'FT' },
    { timestamp: '2026-06-03T18:10:00.000Z', text: 'After window', source: 'Y' },
  ];
  const win = selectHeadlineWindow(raw, { startTime: '2026-06-03T17:40:00.000Z', endTime: '2026-06-03T17:55:00.000Z' });
  assert.equal(win.length, 2);
  assert.equal(win[0].text, 'Broadcom stock plunges 14%');
  assert.equal(win[1].text, "Fed's Goolsbee speaks");
});

test('captureHeadlines returns classified schema headlines', () => {
  const raw: RawHeadline[] = [
    { timestamp: '2026-06-03T17:50:00.000Z', text: "Fed's Goolsbee: activity has softened", source: 'FT' },
    { timestamp: '2026-06-03T17:52:00.000Z', text: 'US ISM Manufacturing PMI 48.7 (Forecast 49.5)', source: 'FJ' },
  ];
  const out = captureHeadlines({ raw, startTime: '2026-06-03T17:40:00.000Z', endTime: '2026-06-03T18:00:00.000Z', ...ctx });
  assert.equal(out.length, 2);
  assert.equal(out[0].source, 'FINANCIALJUICE');
  assert.equal(out.some(h => h.possibleNewInformationEvent), true);   // the Goolsbee one
});
