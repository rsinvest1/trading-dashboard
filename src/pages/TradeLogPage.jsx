import { useMemo, useState } from 'react';
import { Upload, Trash2, ArrowUpDown } from 'lucide-react';
import { useStore } from '../store/useStore';
import CsvImporter from '../components/CsvImporter';
import TradeDetailDrawer from '../components/TradeDetailDrawer';
import QuickAddTrade from '../components/QuickAddTrade';
import WebhookLiveBadge from '../components/WebhookLiveBadge';
import { fmtMoney, fmtR, fmtDuration, realizedR } from '../utils/calculations';

const COLS = [
  { id: 'date',      label: 'Date',      align: 'left'  },
  { id: 'ticker',    label: 'Ticker',    align: 'left'  },
  { id: 'side',      label: 'Side',      align: 'left'  },
  { id: 'contracts', label: 'Qty',       align: 'right' },
  { id: 'entry',     label: 'Entry',     align: 'right' },
  { id: 'exit',      label: 'Exit',      align: 'right' },
  { id: 'duration_sec', label: 'Hold',   align: 'right' },
  { id: 'pnl',       label: 'Net P&L',   align: 'right' },
  { id: 'r',         label: 'R',         align: 'right' },
  { id: 'fees',      label: 'Fees',      align: 'right' }
];

function StrategyBadge({ strategy, followedCount, totalRules }) {
  if (!strategy) return <span className="text-text-muted">—</span>;
  const pct = totalRules ? followedCount / totalRules : 0;
  const tone = pct === 1 ? 'text-accent-green' : pct >= 0.5 ? 'text-accent-yellow' : 'text-accent-red';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-text-primary truncate max-w-[100px]">{strategy.name}</span>
      {totalRules > 0 && (
        <span className={`font-mono text-[10px] ${tone}`}>{followedCount}/{totalRules}</span>
      )}
    </span>
  );
}

function TagPills({ tags, categories }) {
  const flat = [];
  for (const cat of categories) {
    for (const tagId of (tags?.[cat.id] || [])) {
      const t = cat.tags.find(tt => tt.id === tagId);
      if (t) flat.push({ label: t.label, color: cat.color });
    }
  }
  if (!flat.length) return <span className="text-text-muted">—</span>;
  const visible = flat.slice(0, 3);
  const overflow = flat.length - visible.length;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {visible.map((t, i) => (
        <span
          key={i}
          className={`px-1.5 py-0.5 text-[10px] rounded border border-bg-border text-text-secondary truncate max-w-[80px]`}
          title={t.label}
        >
          {t.label}
        </span>
      ))}
      {overflow > 0 && <span className="text-[10px] text-text-muted">+{overflow}</span>}
    </span>
  );
}

function playbookLabel(p) {
  const parts = [];
  if (p.event_key) parts.push(p.event_key);
  const instance = [p.date, p.time].filter(Boolean).join(' ');
  if (instance) parts.push(instance);
  parts.push(p.title || p.setup_name || 'Untitled release');
  return parts.filter(Boolean).join(' - ');
}

export default function TradeLogPage() {
  const trades    = useStore(s => s.trades);
  const accounts  = useStore(s => s.accounts);
  const strategies = useStore(s => s.strategies);
  const playbooks = useStore(s => s.playbooks);
  const categories = useStore(s => s.settings.tag_categories || []);
  const clearTrades = useStore(s => s.clearTrades);
  const updateTrade = useStore(s => s.updateTrade);

  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [accountFilter, setAccountFilter] = useState('all');
  const [tickerFilter,  setTickerFilter]  = useState('all');
  const [tagFilter,     setTagFilter]     = useState('all');  // tagId

  const accountById = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a])),
    [accounts]
  );
  const strategyById = useMemo(
    () => Object.fromEntries(strategies.map(s => [s.id, s])),
    [strategies]
  );
  const playbooksSorted = useMemo(
    () => [...playbooks].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [playbooks]
  );
  const tickers = useMemo(() => [...new Set(trades.map(t => t.ticker))].sort(), [trades]);

  const filtered = useMemo(() => {
    let list = trades;
    if (accountFilter !== 'all') list = list.filter(t => t.account_id === accountFilter);
    if (tickerFilter  !== 'all') list = list.filter(t => t.ticker === tickerFilter);
    if (tagFilter     !== 'all') {
      list = list.filter(t => {
        const all = Object.values(t.tags || {}).flat();
        return all.includes(tagFilter);
      });
    }
    return list;
  }, [trades, accountFilter, tickerFilter, tagFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sortKey === 'date') {
        av = `${a.date}T${a.time || '00:00'}`;
        bv = `${b.date}T${b.time || '00:00'}`;
        return av < bv ? -dir : av > bv ? dir : 0;
      }
      if (sortKey === 'r') {
        av = realizedR(a); bv = realizedR(b);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * dir;
      }
      av = a[sortKey];
      bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number') return (av - bv) * dir;
      return String(av) < String(bv) ? -dir : String(av) > String(bv) ? dir : 0;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  const totalPnL = filtered.reduce((s, t) => s + (Number(t.pnl) || 0), 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trade Log</h1>
          <p className="text-sm text-text-secondary mt-1">
            {trades.length} trade{trades.length === 1 ? '' : 's'} · Net{' '}
            <span className={`font-mono ${totalPnL >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
              {fmtMoney(totalPnL)}
            </span>
            <span className="text-text-muted ml-2">· Click a row to edit</span>
          </p>
        </div>
        <div className="flex gap-2">
          {trades.length > 0 && (
            <button
              onClick={() => { if (confirm(`Delete all ${trades.length} trades?`)) clearTrades(); }}
              className="flex items-center gap-1 px-3 py-2 text-xs text-text-secondary hover:text-accent-red border border-bg-border rounded"
            >
              <Trash2 size={14} /> Clear
            </button>
          )}
          <WebhookLiveBadge />
          <QuickAddTrade />
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-1 px-3 py-2 text-sm border border-bg-border text-text-primary rounded font-medium hover:border-accent-green/40"
          >
            <Upload size={14} /> Import CSV
          </button>
        </div>
      </div>

      {trades.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          <select
            value={accountFilter}
            onChange={e => setAccountFilter(e.target.value)}
            className="bg-bg-card border border-bg-border rounded px-2 py-1.5"
          >
            <option value="all">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.firm_name}</option>)}
          </select>
          <select
            value={tickerFilter}
            onChange={e => setTickerFilter(e.target.value)}
            className="bg-bg-card border border-bg-border rounded px-2 py-1.5"
          >
            <option value="all">All tickers</option>
            {tickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="bg-bg-card border border-bg-border rounded px-2 py-1.5"
          >
            <option value="all">All tags</option>
            {categories.map(cat => (
              <optgroup key={cat.id} label={cat.label}>
                {cat.tags.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {trades.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-text-secondary">No trades yet.</div>
          <button
            onClick={() => setImporting(true)}
            className="mt-3 inline-flex items-center gap-1 px-4 py-2 text-sm bg-accent-green text-bg rounded font-medium"
          >
            <Upload size={14} /> Import CSV
          </button>
        </div>
      ) : (
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border text-left text-xs uppercase tracking-wider text-text-secondary">
                {COLS.map(c => (
                  <th
                    key={c.id}
                    onClick={() => toggleSort(c.id)}
                    className={`px-3 py-2 cursor-pointer hover:text-text-primary select-none ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortKey === c.id && <ArrowUpDown size={10} />}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Account</th>
                <th className="px-3 py-2">Strategy</th>
                <th className="px-3 py-2">Playbook</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {sorted.map(t => {
                const r = realizedR(t);
                const strat = strategyById[t.strategy_id];
                const totalRules = strat
                  ? (strat.entry_rules?.length || 0) + (strat.exit_rules?.length || 0)
                  : 0;
                const followed = (t.rules_followed || []).filter(rid =>
                  strat && [...(strat.entry_rules||[]), ...(strat.exit_rules||[])].some(rule => rule.id === rid)
                ).length;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="border-b border-bg-border/40 hover:bg-bg-hover/30 cursor-pointer"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">{t.date} <span className="text-text-muted">{t.time}</span></td>
                    <td className="px-3 py-2"><span className="text-text-primary">{t.ticker}</span> <span className="text-text-muted">{t.symbol !== t.ticker ? t.symbol : ''}</span></td>
                    <td className={`px-3 py-2 ${t.side === 'Long' ? 'text-accent-green' : 'text-accent-red'}`}>{t.side}</td>
                    <td className="px-3 py-2 text-right">{t.contracts}</td>
                    <td className="px-3 py-2 text-right">{t.entry ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{t.exit ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-text-secondary whitespace-nowrap">{fmtDuration(t.duration_sec)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${t.pnl > 0 ? 'text-accent-green' : t.pnl < 0 ? 'text-accent-red' : ''}`}>
                      {fmtMoney(t.pnl)}
                    </td>
                    <td className={`px-3 py-2 text-right ${r == null ? 'text-text-muted' : r > 0 ? 'text-accent-green' : r < 0 ? 'text-accent-red' : ''}`}>
                      {fmtR(r)}
                    </td>
                    <td className="px-3 py-2 text-right text-text-muted">{t.fees != null ? fmtMoney(-t.fees) : '—'}</td>
                    <td className="px-3 py-2 text-right text-[10px] text-text-muted truncate max-w-[140px]">
                      {accountById[t.account_id]?.firm_name?.split(' ')[0] ?? '—'}
                    </td>
                    <td className="px-3 py-2 max-w-[160px] truncate">
                      <StrategyBadge strategy={strat} followedCount={followed} totalRules={totalRules} />
                    </td>
                    <td className="px-3 py-2 max-w-[170px]" onClick={e => e.stopPropagation()}>
                      <select
                        value={t.playbook_id ?? ''}
                        onChange={e => updateTrade(t.id, { playbook_id: e.target.value || null })}
                        className={`w-full max-w-[160px] bg-bg border border-bg-border rounded px-1.5 py-1 text-xs focus:outline-none focus:border-accent-green/50 ${t.playbook_id ? 'text-text-secondary' : 'text-text-muted'}`}
                      >
                        <option value="">— none —</option>
                        {playbooksSorted.map(p => (
                          <option key={p.id} value={p.id}>
                            {playbookLabel(p)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 max-w-[200px]">
                      <TagPills tags={t.tags} categories={categories} />
                    </td>
                    <td
                      className="px-3 py-2 text-[11px] text-text-secondary max-w-[240px] truncate"
                      title={t.notes || ''}
                    >
                      {t.notes || <span className="text-text-muted italic">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {importing && <CsvImporter onClose={() => setImporting(false)} />}
      {selectedId && (
        <TradeDetailDrawer tradeId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
