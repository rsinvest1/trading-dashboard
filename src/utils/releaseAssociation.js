import { normalizeReleaseJournal } from './releaseJournalSchema';
import { normalizeEventKey, resolveCanonicalEventKey, isDateLikeEventKey } from './events';

const MICRO_ROOT = {
  MNQ: 'NQ',
  MES: 'ES',
  M2K: 'RTY',
  MGC: 'GC',
};

function etOffset(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const y = d.getUTCFullYear();
  const marFirst = new Date(Date.UTC(y, 2, 1)).getUTCDay();
  const dstStart = new Date(Date.UTC(y, 2, 1 + ((7 - marFirst) % 7) + 7, 7));
  const novFirst = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  const dstEnd = new Date(Date.UTC(y, 10, 1 + ((7 - novFirst) % 7), 6));
  return d >= dstStart && d < dstEnd ? '-04:00' : '-05:00';
}

function etParts(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return { date, time };
}

function tradeOpenMs(trade) {
  if (!trade?.date || !trade?.time) return NaN;
  const time = String(trade.time).length === 5 ? `${trade.time}:00` : trade.time;
  return Date.parse(`${trade.date}T${time}${etOffset(trade.date)}`);
}

export function instrumentRoot(symbolOrTicker) {
  const raw = String(symbolOrTicker || '').toUpperCase().trim();
  if (!raw) return '';
  const monthMatch = /^([A-Z0-9]+?)([FGHJKMNQUVXZ]\d{1,2})$/.exec(raw);
  const root = monthMatch ? monthMatch[1] : raw;
  return MICRO_ROOT[root] || root;
}

function contractMonth(symbolOrTicker) {
  const raw = String(symbolOrTicker || '').toUpperCase().trim();
  return /^([A-Z0-9]+?)([FGHJKMNQUVXZ]\d{1,2})$/.exec(raw)?.[2] || '';
}

function journalWindow(journal) {
  const rel = journal.actualReleaseTime || journal.scheduledTime;
  const start = journal.holdingWindow?.startTime || (rel ? new Date(Date.parse(rel) - 60_000).toISOString() : '');
  const end = journal.holdingWindow?.endTime || (rel ? new Date(Date.parse(rel) + 30 * 60_000).toISOString() : '');
  return { startMs: Date.parse(start), endMs: Date.parse(end) };
}

export function journalMatchesTrade(journal, trade) {
  const ms = tradeOpenMs(trade);
  const { startMs, endMs } = journalWindow(journal);
  if (!Number.isFinite(ms) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  if (ms < startMs || ms > endMs) return false;

  const tradeIds = [trade.ticker, trade.symbol].map(x => String(x || '').toUpperCase()).filter(Boolean);
  const tradeRoots = tradeIds.map(instrumentRoot).filter(Boolean);
  const tradeMonths = tradeIds.map(contractMonth).filter(Boolean);
  for (const asset of journal.trackedAssets || []) {
    const assetRoot = instrumentRoot(asset.symbol || asset.contract);
    if (!tradeRoots.includes(assetRoot)) continue;
    if (!asset.contract) return true;
    const assetMonth = contractMonth(asset.contract);
    if (!assetMonth || tradeMonths.length === 0 || tradeMonths.includes(assetMonth)) return true;
  }
  return false;
}

function matchingPlaybook(playbooks, eventKey, parts) {
  const norm = normalizeEventKey(eventKey);
  return (playbooks || []).find(p =>
    normalizeEventKey(p.event_key) === norm &&
    (!parts.date || !p.date || p.date === parts.date) &&
    (!parts.time || !p.time || p.time === parts.time)
  ) || null;
}

function playbookDraftForJournal(journal, eventKey) {
  const parts = etParts(journal.actualReleaseTime || journal.scheduledTime);
  return {
    title: journal.releaseName || eventKey,
    date: parts.date,
    time: parts.time,
    setup_name: '',
    event_key: eventKey,
    instruments: [...new Set((journal.trackedAssets || []).map(a => instrumentRoot(a.symbol)).filter(Boolean))],
    catalysts: [],
    context: journal.summary?.finalTakeaway || journal.numbers?.interpretation || '',
    charts: [],
    outcome: journal.summary?.learningNote || '',
  };
}

function linkExecutionReview(journal, trades) {
  if (!journal.executionReview?.trades?.length) return journal.executionReview || null;
  const linked = journal.executionReview.trades.map(reviewTrade => {
    const root = instrumentRoot(reviewTrade.ticker || reviewTrade.symbol);
    const match = trades.find(t => {
      if (instrumentRoot(t.ticker || t.symbol) !== root) return false;
      if (reviewTrade.contracts != null && Number(t.contracts) !== Number(reviewTrade.contracts)) return false;
      if (reviewTrade.pnl != null && Math.abs(Number(t.pnl) - Number(reviewTrade.pnl)) > 0.02) return false;
      return journalMatchesTrade(journal, t);
    });
    return match ? { ...reviewTrade, linked_trade_id: match.id, release_match_confidence: 'HIGH' } : reviewTrade;
  });
  return { ...journal.executionReview, trades: linked };
}

export function applyReleaseJournalImport(state, rawJournal, opts = {}) {
  const id = opts.uid || (() => Math.random().toString(36).slice(2, 10));
  const normalized = normalizeReleaseJournal(rawJournal);
  const eventKey = resolveCanonicalEventKey(normalized.releaseKey || normalized.releaseName, '');
  const safeEventKey = !eventKey || isDateLikeEventKey(eventKey)
    ? resolveCanonicalEventKey(normalized.releaseName, normalized.releaseKey)
    : eventKey;

  const journal = {
    ...normalized,
    releaseKey: safeEventKey || normalized.releaseKey,
  };

  const playbooks = [...(state.playbooks || [])];
  const parts = etParts(journal.actualReleaseTime || journal.scheduledTime);
  let playbook = matchingPlaybook(playbooks, journal.releaseKey, parts);
  let createdPlaybook = false;
  if (!playbook && journal.releaseKey && !isDateLikeEventKey(journal.releaseKey)) {
    playbook = { id: id(), ...playbookDraftForJournal(journal, journal.releaseKey), created_at: new Date().toISOString() };
    playbooks.push(playbook);
    createdPlaybook = true;
  }

  const existingJournals = (state.releaseJournals || []).filter(j => j.releaseId !== journal.releaseId);
  const allJournals = [...existingJournals, journal];
  let linkedTrades = 0;
  let ambiguousTrades = 0;
  const trades = (state.trades || []).map(t => {
    const matches = allJournals.filter(j => journalMatchesTrade(j, t));
    const isThisJournal = matches.length === 1 && matches[0].releaseId === journal.releaseId;
    if (!isThisJournal) {
      if (matches.some(j => j.releaseId === journal.releaseId)) ambiguousTrades++;
      return t;
    }
    const patch = {};
    if (!t.release_id) patch.release_id = journal.releaseId;
    if (!t.playbook_id && playbook?.id) patch.playbook_id = playbook.id;
    if (!Object.keys(patch).length) return t;
    linkedTrades++;
    return { ...t, ...patch };
  });

  const linkedJournal = {
    ...journal,
    executionReview: linkExecutionReview(journal, trades),
  };

  return {
    state: {
      releaseJournals: [...existingJournals, linkedJournal],
      playbooks,
      trades,
    },
    result: {
      releaseId: journal.releaseId,
      eventKey: journal.releaseKey,
      playbookId: playbook?.id || null,
      createdPlaybook,
      linkedTrades,
      ambiguousTrades,
    },
  };
}
