import { useState } from 'react';
import { AlertTriangle, Check, ShieldCheck, Flame } from 'lucide-react';
import { useStore } from '../store/useStore';
import { fmtMoney } from '../utils/calculations';

const EMOTIONS = [
  { id: 'calm',       label: 'Calm',       desc: 'Centered, executing my plan',     color: 'text-accent-green' },
  { id: 'neutral',    label: 'Neutral',    desc: 'Routine, nothing notable',         color: 'text-text-secondary' },
  { id: 'frustrated', label: 'Frustrated', desc: 'Annoyed, off rhythm',              color: 'text-accent-yellow' },
  { id: 'urgent',     label: 'Urgent',     desc: 'Recovery mode — chasing P&L',      color: 'text-accent-red' }
];

const ERROR_EMOTIONS = [
  { id: 'frustration', label: 'Frustration' },
  { id: 'urgency',     label: 'Urgency / Recovery' },
  { id: 'fomo',        label: 'FOMO' },
  { id: 'anger',       label: 'Anger' }
];

export default function PostTradeModal() {
  const pendingId = useStore(s => s.behaviorState.pending_classification_id);
  const trade     = useStore(s => s.trades.find(t => t.id === pendingId));
  const classify  = useStore(s => s.classifyTrade);

  const [tradeType, setTradeType] = useState('plan');
  const [emotion,   setEmotion]   = useState(null);
  const [errorReason,  setErrorReason]  = useState('');
  const [errorEmotion, setErrorEmotion] = useState(null);

  if (!pendingId || !trade) return null;

  const isError = tradeType === 'error';
  const canSubmit = !!emotion && (!isError || (errorReason.trim().length > 0 && errorEmotion));

  function submit() {
    if (!canSubmit) return;
    classify(pendingId, {
      trade_type: tradeType,
      post_trade_state: emotion,
      error_reason: isError ? errorReason.trim().slice(0, 100) : null,
      error_emotion: isError ? errorEmotion : null
    });
    // reset for next trade
    setTradeType('plan');
    setEmotion(null);
    setErrorReason('');
    setErrorEmotion(null);
  }

  const pnlTone = trade.pnl > 0 ? 'text-accent-green' : trade.pnl < 0 ? 'text-accent-red' : 'text-text-muted';

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-bg-card border border-bg-border rounded-lg w-full max-w-lg shadow-2xl">

        {/* Header — non-dismissable to enforce classification */}
        <div className={`px-5 py-3 border-b border-bg-border flex items-center justify-between gap-3 ${isError ? 'bg-accent-red/10' : 'bg-bg-hover'}`}>
          <div className="flex items-center gap-2">
            {isError ? <AlertTriangle size={18} className="text-accent-red" /> : <ShieldCheck size={18} className="text-accent-green" />}
            <h2 className="font-semibold text-sm uppercase tracking-wider">
              {isError ? 'Error detected — classify and acknowledge' : 'Classify this trade'}
            </h2>
          </div>
          <span className="text-[10px] text-text-muted">Required</span>
        </div>

        {/* Trade summary */}
        <div className="px-5 py-3 border-b border-bg-border grid grid-cols-4 gap-2 text-xs font-mono">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Symbol</div>
            <div>{trade.ticker}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Side</div>
            <div className={trade.side === 'Long' ? 'text-accent-green' : 'text-accent-red'}>{trade.side}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Qty</div>
            <div>{trade.contracts}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Net P&L</div>
            <div className={`font-semibold ${pnlTone}`}>{fmtMoney(trade.pnl)}</div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Trade type */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">
              Trade type
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTradeType('plan')}
                className={`p-3 rounded border-2 text-left transition-colors ${
                  tradeType === 'plan'
                    ? 'border-accent-green bg-accent-green/10'
                    : 'border-bg-border hover:border-text-muted'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Check size={14} className="text-accent-green" />
                  <span className="text-sm font-semibold">Plan trade</span>
                </div>
                <div className="text-[11px] text-text-muted">Followed setup, executed cleanly</div>
              </button>
              <button
                onClick={() => setTradeType('error')}
                className={`p-3 rounded border-2 text-left transition-colors ${
                  tradeType === 'error'
                    ? 'border-accent-red bg-accent-red/10'
                    : 'border-bg-border hover:border-text-muted'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Flame size={14} className="text-accent-red" />
                  <span className="text-sm font-semibold">Error trade</span>
                </div>
                <div className="text-[11px] text-text-muted">Outside plan / emotional execution</div>
              </button>
            </div>
          </div>

          {/* Emotional state */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">
              Current emotional state
            </div>
            <div className="grid grid-cols-2 gap-2">
              {EMOTIONS.map(e => (
                <button
                  key={e.id}
                  onClick={() => setEmotion(e.id)}
                  className={`p-2.5 rounded border text-left transition-colors ${
                    emotion === e.id
                      ? 'border-accent-green bg-bg-hover'
                      : 'border-bg-border hover:border-text-muted'
                  }`}
                >
                  <div className={`text-sm font-semibold ${e.color}`}>{e.label}</div>
                  <div className="text-[10px] text-text-muted">{e.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Error-only required fields */}
          {isError && (
            <div className="space-y-3 p-3 bg-accent-red/5 border border-accent-red/30 rounded">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-accent-red block mb-1.5">
                  What happened? <span className="text-text-muted normal-case">(max 100 chars)</span>
                </label>
                <input
                  value={errorReason}
                  onChange={e => setErrorReason(e.target.value.slice(0, 100))}
                  placeholder="e.g. Sized up after a loss without a setup"
                  className="w-full bg-bg border border-bg-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent-red/50"
                  autoFocus
                />
                <div className="text-[10px] text-text-muted mt-1 text-right">{errorReason.length}/100</div>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-accent-red block mb-1.5">
                  Driving emotion
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {ERROR_EMOTIONS.map(em => (
                    <button
                      key={em.id}
                      onClick={() => setErrorEmotion(em.id)}
                      className={`py-1.5 px-2 text-xs rounded border transition-colors ${
                        errorEmotion === em.id
                          ? 'border-accent-red bg-accent-red/15 text-accent-red'
                          : 'border-bg-border text-text-secondary hover:border-text-muted'
                      }`}
                    >
                      {em.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end pt-1">
            <button
              onClick={submit}
              disabled={!canSubmit}
              className={`px-5 py-2 rounded font-medium text-sm transition-colors ${
                canSubmit
                  ? isError
                    ? 'bg-accent-red text-white hover:bg-accent-red-soft'
                    : 'bg-accent-green text-bg hover:bg-accent-green-soft'
                  : 'bg-bg-hover text-text-muted cursor-not-allowed'
              }`}
            >
              {isError ? 'Acknowledge & start pause' : 'Save & continue'}
            </button>
          </div>
          {!canSubmit && (
            <div className="text-[11px] text-text-muted text-right">
              {!emotion ? 'Select an emotional state to continue.' :
               isError && !errorReason.trim() ? 'Describe what happened.' :
               isError && !errorEmotion ? 'Pick the driving emotion.' : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
