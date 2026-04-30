import { useMemo, useState } from 'react';
import { Plus, Trash2, X, Edit2, Check, Target, ListChecks } from 'lucide-react';
import { useStore } from '../store/useStore';
import { fmtMoney, fmtPct, realizedR, fmtR } from '../utils/calculations';

const uid = () => Math.random().toString(36).slice(2, 10);
const COLORS = ['green', 'red', 'yellow', 'blue', 'muted'];
const COLOR_DOT = {
  green: 'bg-accent-green', red: 'bg-accent-red', yellow: 'bg-accent-yellow',
  blue: 'bg-accent-blue', muted: 'bg-text-secondary'
};

function RuleEditor({ rules, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  function commit() {
    const text = draft.trim();
    if (!text) return;
    onChange([...rules, { id: uid(), text }]);
    setDraft('');
  }
  function patch(id, text) {
    onChange(rules.map(r => r.id === id ? { ...r, text } : r));
  }
  function remove(id) {
    onChange(rules.filter(r => r.id !== id));
  }
  return (
    <div className="space-y-1.5">
      {rules.map(r => (
        <div key={r.id} className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted shrink-0" />
          <input
            value={r.text}
            onChange={e => patch(r.id, e.target.value)}
            className="flex-1 bg-bg border border-bg-border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent-green/50"
          />
          <button onClick={() => remove(r.id)} className="text-text-muted hover:text-accent-red p-1">
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commit()}
          placeholder={placeholder}
          className="flex-1 bg-bg border border-bg-border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent-green/50"
        />
        <button
          onClick={commit}
          disabled={!draft.trim()}
          className="px-3 py-1 text-xs bg-accent-green text-bg rounded font-medium disabled:opacity-40"
        >
          <Plus size={12} className="inline -mt-0.5" /> Rule
        </button>
      </div>
    </div>
  );
}

function StrategyEditor({ strategy, onSave, onCancel, onDelete }) {
  const [draft, setDraft] = useState(strategy);
  function patch(p) { setDraft(d => ({ ...d, ...p })); }
  return (
    <div className="card p-4 space-y-4 border-accent-green/30">
      <div className="flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${COLOR_DOT[draft.color] || COLOR_DOT.muted}`} />
        <input
          value={draft.name}
          onChange={e => patch({ name: e.target.value })}
          placeholder="Strategy name (e.g. MODEL 3)"
          className="flex-1 bg-bg border border-bg-border rounded px-3 py-1.5 text-sm font-medium focus:outline-none focus:border-accent-green/50"
        />
        <select
          value={draft.color}
          onChange={e => patch({ color: e.target.value })}
          className="bg-bg border border-bg-border rounded px-2 py-1 text-[11px]"
        >
          {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <textarea
        value={draft.description ?? ''}
        onChange={e => patch({ description: e.target.value })}
        placeholder="Short description / when to use this strategy"
        rows={2}
        className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50 resize-none"
      />

      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-accent-green mb-2">Entry criteria</h4>
        <RuleEditor
          rules={draft.entry_rules || []}
          onChange={rules => patch({ entry_rules: rules })}
          placeholder="e.g. Price at HTF POI (OB/FVG/liquidity zone)"
        />
      </div>

      <div>
        <h4 className="text-[11px] uppercase tracking-wider text-accent-red mb-2">Exit criteria</h4>
        <RuleEditor
          rules={draft.exit_rules || []}
          onChange={rules => patch({ exit_rules: rules })}
          placeholder="e.g. Partial at 1R or interim level"
        />
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-bg-border">
        <button
          onClick={onDelete}
          className="text-xs text-text-muted hover:text-accent-red flex items-center gap-1"
        >
          <Trash2 size={12} /> Delete strategy
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!draft.name.trim()}
            className="px-3 py-1.5 text-xs bg-accent-green text-bg rounded font-medium disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function StrategyCard({ strategy, stats, onEdit }) {
  const total = (strategy.entry_rules?.length || 0) + (strategy.exit_rules?.length || 0);
  const tone = stats.totalPnl > 0 ? 'text-accent-green' : stats.totalPnl < 0 ? 'text-accent-red' : 'text-text-muted';
  return (
    <div className="card p-4 group">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-3 h-3 rounded-full shrink-0 ${COLOR_DOT[strategy.color] || COLOR_DOT.muted}`} />
          <h3 className="font-semibold truncate">{strategy.name}</h3>
        </div>
        <button
          onClick={onEdit}
          className="opacity-0 group-hover:opacity-100 p-1 text-text-secondary hover:text-text-primary"
        >
          <Edit2 size={14} />
        </button>
      </div>

      {strategy.description && (
        <p className="text-xs text-text-secondary line-clamp-2 mb-3">{strategy.description}</p>
      )}

      <div className="grid grid-cols-4 gap-2 text-[11px] font-mono">
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Trades</div>
          <div className="text-text-primary">{stats.count}</div>
        </div>
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Win rate</div>
          <div className="text-text-primary">{stats.count ? fmtPct(stats.winRate) : '—'}</div>
        </div>
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Net P&L</div>
          <div className={tone}>{fmtMoney(stats.totalPnl)}</div>
        </div>
        <div>
          <div className="text-text-muted text-[10px] uppercase tracking-wider">Avg R</div>
          <div className="text-text-primary">{fmtR(stats.avgR)}</div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-bg-border flex items-center gap-3 text-[11px] text-text-muted">
        <span className="flex items-center gap-1"><Target size={11} /> {strategy.entry_rules?.length || 0} entry</span>
        <span className="flex items-center gap-1"><ListChecks size={11} /> {strategy.exit_rules?.length || 0} exit</span>
        <span className="ml-auto">{total} rule{total === 1 ? '' : 's'} total</span>
      </div>
    </div>
  );
}

export default function StrategiesPage() {
  const strategies = useStore(s => s.strategies);
  const trades     = useStore(s => s.trades);
  const addStrategy    = useStore(s => s.addStrategy);
  const updateStrategy = useStore(s => s.updateStrategy);
  const deleteStrategy = useStore(s => s.deleteStrategy);

  const [editingId, setEditingId] = useState(null);

  // Per-strategy aggregate stats
  const stats = useMemo(() => {
    const out = {};
    for (const s of strategies) {
      const ts = trades.filter(t => t.strategy_id === s.id);
      const wins = ts.filter(t => t.pnl > 0).length;
      const losses = ts.filter(t => t.pnl < 0).length;
      const totalPnl = ts.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0);
      const rs = ts.map(realizedR).filter(r => r != null);
      const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
      out[s.id] = {
        count: ts.length,
        wins, losses,
        winRate: (wins + losses) ? (wins / (wins + losses)) * 100 : 0,
        totalPnl,
        avgR
      };
    }
    return out;
  }, [strategies, trades]);

  function startEdit(id) { setEditingId(id); }
  function startNew() {
    addStrategy({ name: 'New strategy', color: 'green', entry_rules: [], exit_rules: [] });
    // Edit the most-recently-added one — its id won't be known synchronously,
    // so the user can click Edit on the card afterward. Cleaner UX in v2.
  }
  function save(id, draft) {
    updateStrategy(id, draft);
    setEditingId(null);
  }
  function remove(id) {
    if (!confirm('Delete this strategy? Trades currently linked to it will keep their rule-followed marks but lose the strategy reference.')) return;
    deleteStrategy(id);
    setEditingId(null);
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Strategies</h1>
          <p className="text-sm text-text-secondary mt-1">
            Reusable trading models. Each has entry &amp; exit rule checklists you tick off per trade to track adherence.
          </p>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-1 px-3 py-2 text-sm bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft"
        >
          <Plus size={14} /> New strategy
        </button>
      </div>

      {strategies.length === 0 ? (
        <div className="card p-10 text-center space-y-2">
          <ListChecks size={28} className="mx-auto text-text-muted" />
          <div className="text-text-secondary">No strategies yet.</div>
          <button
            onClick={startNew}
            className="mt-2 inline-flex items-center gap-1 px-4 py-2 text-sm bg-accent-green text-bg rounded font-medium"
          >
            <Plus size={14} /> Create your first strategy
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {strategies.map(s => (
            editingId === s.id ? (
              <StrategyEditor
                key={s.id}
                strategy={s}
                onSave={(draft) => save(s.id, draft)}
                onCancel={() => setEditingId(null)}
                onDelete={() => remove(s.id)}
              />
            ) : (
              <StrategyCard
                key={s.id}
                strategy={s}
                stats={stats[s.id] || { count: 0, winRate: 0, totalPnl: 0, avgR: null }}
                onEdit={() => startEdit(s.id)}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
