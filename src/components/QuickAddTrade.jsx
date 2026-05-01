import { useState } from 'react';
import { Zap, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { TICKERS } from '../utils/instruments';

export default function QuickAddTrade() {
  const accounts = useStore(s => s.accounts);
  const ingest   = useStore(s => s.ingestTrade);
  const mode     = useStore(s => s.behaviorState.mode);
  const [open, setOpen] = useState(false);

  // Default fields
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const time  = now.toTimeString().slice(0, 5);

  const [draft, setDraft] = useState({
    date: today, time,
    ticker: 'NQ', symbol: 'NQ',
    side: 'Long',
    contracts: 1,
    entry: '',
    exit: '',
    pnl: 0,
    fees: 0,
    account_id: accounts[0]?.id ?? null
  });

  function patch(p) { setDraft(d => ({ ...d, ...p })); }

  function reset() {
    const n = new Date();
    setDraft({
      date: n.toISOString().slice(0, 10),
      time: n.toTimeString().slice(0, 5),
      ticker: 'NQ', symbol: 'NQ',
      side: 'Long',
      contracts: 1, entry: '', exit: '',
      pnl: 0, fees: 0,
      account_id: accounts[0]?.id ?? null
    });
  }

  function submit() {
    if (!draft.account_id) return;
    ingest({
      date: draft.date,
      time: draft.time,
      ticker: draft.ticker,
      symbol: draft.symbol || draft.ticker,
      side: draft.side,
      contracts: Number(draft.contracts) || 0,
      entry: draft.entry === '' ? null : Number(draft.entry),
      exit:  draft.exit  === '' ? null : Number(draft.exit),
      pnl:   Number(draft.pnl) || 0,
      fees:  Number(draft.fees) || 0,
      account_id: draft.account_id,
      source: 'quick_add'
    });
    setOpen(false);
    reset();
  }

  const disabled = mode === 'locked' || mode === 'paused';

  return (
    <>
      <button
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        title={disabled ? `Trading is ${mode}` : 'Log a new trade'}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded font-semibold transition-colors ${
          disabled
            ? 'bg-bg-hover text-text-muted cursor-not-allowed'
            : 'bg-accent-green text-bg hover:bg-accent-green-soft'
        }`}
      >
        <Zap size={14} /> Quick Add
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-bg-card border border-bg-border rounded-lg w-full max-w-md">
            <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Zap size={16} className="text-accent-green" /> Quick Add Trade
              </h2>
              <button onClick={() => setOpen(false)} className="text-text-secondary hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Date</Label>
                  <input type="date" value={draft.date} onChange={e => patch({ date: e.target.value })}
                    className={inputCls} />
                </div>
                <div>
                  <Label>Time</Label>
                  <input type="time" value={draft.time} onChange={e => patch({ time: e.target.value })}
                    className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Ticker</Label>
                  <select value={draft.ticker} onChange={e => patch({ ticker: e.target.value, symbol: e.target.value })}
                    className={inputCls}>
                    {TICKERS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Side</Label>
                  <select value={draft.side} onChange={e => patch({ side: e.target.value })} className={inputCls}>
                    <option value="Long">Long</option>
                    <option value="Short">Short</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Qty</Label>
                  <input type="number" min="0" step="1" value={draft.contracts}
                    onChange={e => patch({ contracts: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <Label>Entry</Label>
                  <input type="number" step="any" value={draft.entry}
                    onChange={e => patch({ entry: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <Label>Exit</Label>
                  <input type="number" step="any" value={draft.exit}
                    onChange={e => patch({ exit: e.target.value })} className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Net P&L ($)</Label>
                  <input type="number" step="any" value={draft.pnl}
                    onChange={e => patch({ pnl: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <Label>Fees ($)</Label>
                  <input type="number" step="any" value={draft.fees}
                    onChange={e => patch({ fees: e.target.value })} className={inputCls} />
                </div>
              </div>

              <div>
                <Label>Account</Label>
                <select value={draft.account_id ?? ''} onChange={e => patch({ account_id: e.target.value || null })}
                  className={inputCls}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.firm_name}</option>)}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setOpen(false)}
                  className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">
                  Cancel
                </button>
                <button onClick={submit}
                  className="px-4 py-1.5 text-sm bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft">
                  Log trade
                </button>
              </div>
              <p className="text-[10px] text-text-muted text-center">
                You'll be asked to classify this trade (Plan / Error) and your emotional state.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls = "w-full bg-bg border border-bg-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent-green/50";
function Label({ children }) {
  return <div className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">{children}</div>;
}
