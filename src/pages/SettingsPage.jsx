import { useRef, useState } from 'react';
import { Plus, X, Edit2, Check, Trash2, Download, Upload } from 'lucide-react';
import { useStore } from '../store/useStore';
import { fmtMoney } from '../utils/calculations';
import { INSTRUMENTS } from '../utils/instruments';
import WebhookSettings from '../components/WebhookSettings';

function NumberField({ value, onChange, placeholder, prefix = '$' }) {
  return (
    <div className="flex items-center gap-1 bg-bg border border-bg-border rounded px-2 py-1 focus-within:border-accent-green/50">
      {prefix && <span className="text-text-muted text-xs">{prefix}</span>}
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder={placeholder}
        className="bg-transparent text-sm font-mono w-full focus:outline-none"
      />
    </div>
  );
}

const COLOR_DOT = {
  green: 'bg-accent-green', red: 'bg-accent-red', yellow: 'bg-accent-yellow',
  blue: 'bg-accent-blue', muted: 'bg-text-secondary'
};

const DEFAULT_BEHAVIOR_CFG = {
  pause_minutes: 5, kill_consecutive_errors: 2, kill_lock_minutes: 45,
  kill_post_error_count: 3, kill_post_error_window_min: 5, impulsive_window_sec: 120,
  recovery_max_trades_per_hour: 2, recovery_calm_streak_to_exit: 2,
  recovery_idle_minutes_to_exit: 30,
  daily_loss_lock: 1200, per_release_loss_cap: 600
};

function BehaviorSettingsSection() {
  const cfg = useStore(s => s.settings.behavior) || DEFAULT_BEHAVIOR_CFG;
  const updateSettings = useStore(s => s.updateSettings);
  const overrideLog = useStore(s => s.overrideLog || []);
  const resetBehavior = useStore(s => s.resetBehaviorState);

  function patch(p) { updateSettings({ behavior: { ...cfg, ...p } }); }

  return (
    <section className="space-y-3">
      <h2 className="text-sm uppercase tracking-wider text-text-secondary">Behavior Engine</h2>
      <p className="text-xs text-text-muted">
        Tune how the system pauses, locks, and recovers from emotional trading.
      </p>

      <div className="card p-4 space-y-2">
        <h3 className="text-[11px] uppercase tracking-wider text-accent-red">Hard limits</h3>
        <p className="text-[11px] text-text-muted">
          Client-side stops — enforced on localhost with no Netlify needed. Daily lock is per account; both reset each session (18:00 ET roll).
        </p>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <NumField label="Daily loss lock ($ / account)"
            value={cfg.daily_loss_lock} onChange={v => patch({ daily_loss_lock: v })} />
          <NumField label="Per-release loss cap ($)"
            value={cfg.per_release_loss_cap} onChange={v => patch({ per_release_loss_cap: v })} />
        </div>
      </div>

      <div className="card p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        <NumField label="Pause after error (min)"
          value={cfg.pause_minutes} onChange={v => patch({ pause_minutes: v })} />
        <NumField label="Kill: consecutive errors"
          value={cfg.kill_consecutive_errors} onChange={v => patch({ kill_consecutive_errors: v })} />
        <NumField label="Kill: lock duration (min)"
          value={cfg.kill_lock_minutes} onChange={v => patch({ kill_lock_minutes: v })} />
        <NumField label="Kill: post-error trades"
          value={cfg.kill_post_error_count} onChange={v => patch({ kill_post_error_count: v })} />
        <NumField label="Kill: window (min)"
          value={cfg.kill_post_error_window_min} onChange={v => patch({ kill_post_error_window_min: v })} />
        <NumField label="Impulsive trade window (sec)"
          value={cfg.impulsive_window_sec} onChange={v => patch({ impulsive_window_sec: v })} />
        <NumField label="Recovery max trades/hr"
          value={cfg.recovery_max_trades_per_hour} onChange={v => patch({ recovery_max_trades_per_hour: v })} />
        <NumField label="Recovery exit: calm streak"
          value={cfg.recovery_calm_streak_to_exit} onChange={v => patch({ recovery_calm_streak_to_exit: v })} />
        <NumField label="Recovery exit: idle (min)"
          value={cfg.recovery_idle_minutes_to_exit} onChange={v => patch({ recovery_idle_minutes_to_exit: v })} />
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => { if (confirm('Reset Behavior Engine state? Clears pause/lock and counters.')) resetBehavior(); }}
          className="text-xs text-text-muted hover:text-accent-yellow underline"
        >
          Reset behavior state (start fresh)
        </button>
      </div>

      {overrideLog.length > 0 && (
        <div>
          <h3 className="text-[11px] uppercase tracking-wider text-accent-red mb-2 mt-4">
            Override log — {overrideLog.length} bypass{overrideLog.length === 1 ? '' : 'es'}
          </h3>
          <div className="card p-3 space-y-1.5 max-h-64 overflow-auto">
            {[...overrideLog].reverse().map(o => (
              <div key={o.id} className="text-xs flex items-start gap-2 border-b border-bg-border last:border-0 pb-1.5 last:pb-0">
                <span className="text-text-muted font-mono shrink-0">
                  {new Date(o.at).toLocaleString()}
                </span>
                <span className="text-accent-red font-semibold uppercase text-[10px] mt-0.5">{o.previous_mode}</span>
                <span className="text-text-secondary flex-1">{o.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function NumField({ label, value, onChange }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{label}</div>
      <input
        type="number"
        min="0"
        value={value ?? 0}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="w-full bg-bg border border-bg-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent-green/50"
      />
    </div>
  );
}

function CategoryRow({ cat, colors, onPatch, onRemove, onAddTag, onRemoveTag }) {
  const [draftTag, setDraftTag] = useState('');
  function commitTag() {
    if (!draftTag.trim()) return;
    onAddTag(draftTag);
    setDraftTag('');
  }
  return (
    <div className="card p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${COLOR_DOT[cat.color] || COLOR_DOT.muted}`} />
        <input
          value={cat.label}
          onChange={e => onPatch({ label: e.target.value })}
          className="flex-1 bg-transparent text-sm font-medium border-b border-transparent hover:border-bg-border focus:outline-none focus:border-accent-green/50 px-1 py-0.5"
        />
        <select
          value={cat.color}
          onChange={e => onPatch({ color: e.target.value })}
          className="bg-bg border border-bg-border rounded px-2 py-0.5 text-[11px] focus:outline-none"
        >
          {colors.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={onRemove} className="text-text-muted hover:text-accent-red p-1">
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(cat.tags || []).map(t => (
          <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] bg-bg-hover rounded border border-bg-border">
            {t.label}
            <button onClick={() => onRemoveTag(t.id)} className="text-text-muted hover:text-accent-red ml-0.5">
              <X size={9} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draftTag}
          onChange={e => setDraftTag(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commitTag()}
          placeholder={`Add tag to ${cat.label}…`}
          className="flex-1 bg-bg border border-bg-border rounded px-2 py-1 text-xs focus:outline-none focus:border-accent-green/50"
        />
        <button
          onClick={commitTag}
          disabled={!draftTag.trim()}
          className="px-2.5 py-1 text-[11px] bg-accent-green text-bg rounded font-medium disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function AccountRow({ account, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account);

  function save() { onSave(draft); setEditing(false); }
  function cancel() { setDraft(account); setEditing(false); }

  if (!editing) {
    return (
      <div className="card p-4 group">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-medium">{account.firm_name}</div>
            {account.platform && (
              <div className="text-[11px] text-text-muted mt-0.5">{account.platform}</div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-1.5 mt-2 text-xs font-mono text-text-secondary">
              <div>Size <span className="text-text-primary">{fmtMoney(account.account_size)}</span></div>
              <div>{account.eod_rule ? 'DD (EOD)' : 'Trail DD'} <span className="text-text-primary">{fmtMoney(account.trailing_drawdown_limit)}</span></div>
              <div>Daily Loss <span className="text-text-primary">{account.daily_loss_limit ? fmtMoney(account.daily_loss_limit) : '—'}</span></div>
              <div>Max Profit <span className="text-text-primary">{fmtMoney(account.max_daily_profit)}</span></div>
              <div>Balance <span className="text-text-primary">{fmtMoney(account.current_balance)}</span></div>
              {account.profit_target != null && (
                <div>Target <span className="text-text-primary">{fmtMoney(account.profit_target)}</span></div>
              )}
              {account.max_contracts != null && (
                <div>Max <span className="text-text-primary">{account.max_contracts} mini{account.max_contracts_micros ? ` / ${account.max_contracts_micros} µ` : ''}</span></div>
              )}
              {Array.isArray(account.scaling_plan) && account.scaling_plan.length > 0 && (
                <div>Scaling <span className="text-text-primary">{account.scaling_plan.map(t => t.contracts).join('/')} mini</span></div>
              )}
              <div>EOD <span className="text-text-primary">{account.eod_rule ? 'Yes' : 'No'}</span></div>
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => setEditing(true)} className="p-1 text-text-secondary hover:text-text-primary">
              <Edit2 size={14} />
            </button>
            <button onClick={() => onDelete(account.id)} className="p-1 text-text-secondary hover:text-accent-red">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3 border-accent-green/30">
      <input
        value={draft.firm_name}
        onChange={e => setDraft({ ...draft, firm_name: e.target.value })}
        placeholder="Firm name"
        className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm font-medium focus:outline-none focus:border-accent-green/50"
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Account size</div>
          <NumberField value={draft.account_size} onChange={v => setDraft({ ...draft, account_size: v })} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Max drawdown</div>
          <NumberField value={draft.trailing_drawdown_limit} onChange={v => setDraft({ ...draft, trailing_drawdown_limit: v })} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Daily loss limit</div>
          <NumberField value={draft.daily_loss_limit} onChange={v => setDraft({ ...draft, daily_loss_limit: v })} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Max daily profit</div>
          <NumberField value={draft.max_daily_profit} onChange={v => setDraft({ ...draft, max_daily_profit: v })} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Current balance</div>
          <NumberField value={draft.current_balance} onChange={v => setDraft({ ...draft, current_balance: v })} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Profit target</div>
          <NumberField value={draft.profit_target} onChange={v => setDraft({ ...draft, profit_target: v })} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Max contracts (minis)</div>
          <NumberField prefix="" value={draft.max_contracts} onChange={v => setDraft({ ...draft, max_contracts: v })} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Max contracts (micros)</div>
          <NumberField prefix="" value={draft.max_contracts_micros} onChange={v => setDraft({ ...draft, max_contracts_micros: v })} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Drawdown type</div>
          <input
            value={draft.drawdown_type ?? ''}
            onChange={e => setDraft({ ...draft, drawdown_type: e.target.value })}
            placeholder="e.g. EOD Realized"
            className="w-full bg-bg border border-bg-border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent-green/50"
          />
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Platform</div>
        <input
          value={draft.platform ?? ''}
          onChange={e => setDraft({ ...draft, platform: e.target.value })}
          placeholder="e.g. NinjaTrader / Tradovate · TradingView"
          className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={!!draft.eod_rule}
          onChange={e => setDraft({ ...draft, eod_rule: e.target.checked })}
          className="accent-accent-green"
        />
        EOD drawdown rule
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={cancel} className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
        <button onClick={save} className="px-3 py-1 text-xs bg-accent-green text-bg rounded font-medium">Save</button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const accounts = useStore(s => s.accounts);
  const settings = useStore(s => s.settings);
  const addAccount    = useStore(s => s.addAccount);
  const updateAccount = useStore(s => s.updateAccount);
  const deleteAccount = useStore(s => s.deleteAccount);
  const updateSettings = useStore(s => s.updateSettings);
  const exportData = useStore(s => s.exportData);
  const importData = useStore(s => s.importData);

  const fileRef = useRef(null);
  const [importMsg, setImportMsg] = useState('');

  async function downloadJson() {
    const json = await exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading-dashboard-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        await importData(e.target.result);
        setImportMsg('Imported.');
        setTimeout(() => setImportMsg(''), 2000);
      } catch (err) {
        setImportMsg('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  const categories = settings.tag_categories || [];
  function setCategories(next) { updateSettings({ tag_categories: next }); }
  const COLORS = ['green', 'red', 'yellow', 'blue', 'muted'];
  const newId = () => Math.random().toString(36).slice(2, 10);

  function addCategory() {
    setCategories([
      ...categories,
      { id: newId(), label: 'New category', color: 'muted', tags: [] }
    ]);
  }
  function patchCategory(catId, patch) {
    setCategories(categories.map(c => c.id === catId ? { ...c, ...patch } : c));
  }
  function removeCategory(catId) {
    if (!confirm('Delete this category and all its tags? Tags applied to trades will be cleared.')) return;
    setCategories(categories.filter(c => c.id !== catId));
  }
  function addTagToCategory(catId, label) {
    const text = label.trim();
    if (!text) return;
    setCategories(categories.map(c =>
      c.id === catId
        ? { ...c, tags: [...(c.tags || []), { id: newId(), label: text }] }
        : c
    ));
  }
  function removeTagFromCategory(catId, tagId) {
    setCategories(categories.map(c =>
      c.id === catId ? { ...c, tags: c.tags.filter(t => t.id !== tagId) } : c
    ));
  }

  function addNewAccount() {
    addAccount({
      firm_name: 'New account',
      account_size: 50000,
      trailing_drawdown_limit: 2000,
      daily_loss_limit: 1500,
      max_daily_profit: 0,
      eod_rule: false,
      current_balance: 50000,
      profit_target: null,
      max_contracts: null,
      max_contracts_micros: null,
      platform: '',
      drawdown_type: ''
    });
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-text-secondary mt-1">Account rules, tags, instruments, and backups.</p>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wider text-text-secondary">Prop Firm Accounts</h2>
          <button
            onClick={addNewAccount}
            className="flex items-center gap-1 text-xs text-accent-green hover:text-accent-green-soft"
          >
            <Plus size={12} /> Add account
          </button>
        </div>
        <div className="space-y-2">
          {accounts.map(a => (
            <AccountRow
              key={a.id}
              account={a}
              onSave={(patch) => updateAccount(a.id, patch)}
              onDelete={(id) => { if (confirm(`Delete account "${a.firm_name}"?`)) deleteAccount(id); }}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wider text-text-secondary">Tag Categories</h2>
          <button
            onClick={addCategory}
            className="flex items-center gap-1 text-xs text-accent-green hover:text-accent-green-soft"
          >
            <Plus size={12} /> Add category
          </button>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Group tags into categories — Setups, Mistakes, Exit/TP, Timeframe, Confidence. Each trade can have multiple tags per category.
        </p>
        <div className="space-y-3">
          {categories.map(cat => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              colors={COLORS}
              onPatch={(patch) => patchCategory(cat.id, patch)}
              onRemove={() => removeCategory(cat.id)}
              onAddTag={(label) => addTagToCategory(cat.id, label)}
              onRemoveTag={(tagId) => removeTagFromCategory(cat.id, tagId)}
            />
          ))}
        </div>
      </section>

      <BehaviorSettingsSection />

      <WebhookSettings />

      <section>
        <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-3">Instruments</h2>
        <div className="card p-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs font-mono">
          {Object.entries(INSTRUMENTS).map(([k, v]) => (
            <div key={k} className="flex justify-between border border-bg-border rounded px-2 py-1.5">
              <span className="font-semibold">{k}</span>
              <span className="text-text-secondary">${v.pointValue}/pt</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-3">Backup</h2>
        <div className="flex gap-2">
          <button
            onClick={downloadJson}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent-green text-bg rounded text-sm font-medium hover:bg-accent-green-soft"
          >
            <Download size={14} /> Export JSON
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2 border border-bg-border text-text-secondary hover:text-text-primary rounded text-sm"
          >
            <Upload size={14} /> Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleImportFile(e.target.files[0])}
          />
          {importMsg && <span className="self-center text-xs text-accent-green">{importMsg}</span>}
        </div>
        <p className="text-xs text-text-muted mt-2">
          Export saves all data to JSON for OneDrive backup. Import replaces current data.
        </p>
      </section>
    </div>
  );
}
