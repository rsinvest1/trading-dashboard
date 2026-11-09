export const emptyAutoJournalFilters = { search: '', symbol: '', importance: '', from: '', to: '' };

const etDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function journalDateET(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(etDate.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function journalSymbols(journals) {
  return [...new Set(journals.flatMap(j => (Array.isArray(j.trackedAssets) ? j.trackedAssets : [])
    .map(a => typeof a?.symbol === 'string' ? a.symbol.trim() : '').filter(Boolean)))].sort((a, b) => a.localeCompare(b));
}

export function filterAutoJournals(journals, filters) {
  const query = filters.search.trim().toLowerCase();
  return [...journals].filter(j => {
    const assets = Array.isArray(j.trackedAssets) ? j.trackedAssets : [];
    const fields = [j.releaseName, j.releaseKey, ...assets.flatMap(a => [a?.symbol, a?.contract])];
    if (query && !fields.some(value => typeof value === 'string' && value.toLowerCase().includes(query))) return false;
    if (filters.symbol && !assets.some(a => typeof a?.symbol === 'string' && a.symbol.trim() === filters.symbol)) return false;
    if (filters.importance && j.importance !== filters.importance) return false;
    if (filters.from || filters.to) {
      const date = journalDateET(j.scheduledTime);
      if (!date || (filters.from && date < filters.from) || (filters.to && date > filters.to)) return false;
    }
    return true;
  }).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}
