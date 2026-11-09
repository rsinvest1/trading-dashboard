import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAutoJournalFilters as base, filterAutoJournals, journalDateET, journalSymbols } from './autoJournalFilters.js';

test('searches all requested fields across 402 journals without mutating their order', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    releaseName: `Release ${i}`,
    releaseKey: 'CPI',
    createdAt: `2020-01-${String(i % 28 + 1).padStart(2, '0')}`,
    trackedAssets: [{ symbol: 'NQ', contract: 'NQH4' }],
  }));
  rows.push({ releaseName: 'Old employment', releaseKey: 'PAYROLLS', createdAt: '2019-01-01', trackedAssets: [{ symbol: 'GC', contract: 'GCZ9' }] });
  rows.push({ releaseName: 'Unknown date', createdAt: null });
  const original = [...rows];

  assert.equal(filterAutoJournals(rows, base).length, 402);
  for (const query of [' employment ', 'payrolls', 'gc', 'gcz9']) {
    assert.equal(filterAutoJournals(rows, { ...base, search: query })[0].releaseName, 'Old employment');
  }
  const sorted = filterAutoJournals(rows, base);
  assert.equal(sorted[0].createdAt, '2020-01-28');
  assert.equal(sorted.at(-1).releaseName, 'Unknown date');
  assert.deepEqual(rows, original);
});

test('combines filters and matches legacy symbols with surrounding spaces', () => {
  const rows = [
    { releaseName: 'CPI', importance: 'HIGH', scheduledTime: '2024-01-02T15:00:00Z', trackedAssets: [{ symbol: ' GC ', contract: 'GCZ4' }] },
    { releaseName: 'CPI', importance: 'LOW', scheduledTime: '2024-01-02T15:00:00Z', trackedAssets: [{ symbol: 'GC' }] },
    { releaseName: 'Payrolls', importance: 'HIGH', scheduledTime: '2024-01-02T15:00:00Z', trackedAssets: [{ symbol: 'NQ' }] },
  ];
  const filters = { ...base, search: ' cpi ', symbol: 'GC', importance: 'HIGH', from: '2024-01-02', to: '2024-01-02' };
  assert.deepEqual(journalSymbols(rows), ['GC', 'NQ']);
  assert.deepEqual(filterAutoJournals(rows, filters), [rows[0]]);
});

test('uses inclusive New York calendar dates across winter and summer midnight', () => {
  const rows = [
    { releaseName: 'Winter before', scheduledTime: '2024-01-02T04:59:59Z' },
    { releaseName: 'Winter midnight', scheduledTime: '2024-01-02T05:00:00Z' },
    { releaseName: 'Summer before', scheduledTime: '2024-07-02T03:59:59Z' },
    { releaseName: 'Summer midnight', scheduledTime: '2024-07-02T04:00:00Z' },
  ];
  assert.equal(journalDateET(rows[0].scheduledTime), '2024-01-01');
  assert.equal(journalDateET(rows[1].scheduledTime), '2024-01-02');
  assert.equal(journalDateET(rows[2].scheduledTime), '2024-07-01');
  assert.equal(journalDateET(rows[3].scheduledTime), '2024-07-02');
  assert.deepEqual(filterAutoJournals(rows, { ...base, from: '2024-07-01', to: '2024-07-01' }), [rows[2]]);
});

test('keeps missing or invalid scheduled dates only when no date filter is set', () => {
  const rows = [{ releaseName: 'Missing' }, { releaseName: 'Invalid', scheduledTime: 'invalid' }];
  assert.equal(filterAutoJournals(rows, base).length, 2);
  assert.equal(filterAutoJournals(rows, { ...base, from: '2024-01-01' }).length, 0);
  assert.equal(filterAutoJournals(rows, { ...base, to: '2024-12-31' }).length, 0);
});
