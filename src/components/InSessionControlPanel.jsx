import { useEffect, useMemo, useState } from 'react';
import { Activity, ShieldCheck, AlertTriangle, Lock, RefreshCw, Pause, Play, Square, Radio } from 'lucide-react';
import { useStore } from '../store/useStore';
import { guardStatus } from '../utils/dayGuard';
import { fmtMoney } from '../utils/calculations';

function ageSec(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 1000);
}
function fmtAge(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function modeBadge(mode) {
  switch (mode) {
    case 'paused':   return { Icon: Pause,     color: 'text-accent-red',    label: 'PAUSED'   };
    case 'locked':   return { Icon: Lock,      color: 'text-accent-red',    label: 'LOCKED'   };
    case 'recovery': return { Icon: RefreshCw, color: 'text-accent-yellow', label: 'RECOVERY' };
    default:         return { Icon: ShieldCheck, color: 'text-accent-green', label: 'NORMAL'  };
  }
}

function emotionTone(em) {
  switch (em) {
    case 'calm':       return 'text-accent-green';
    case 'neutral':    return 'text-text-secondary';
    case 'frustrated': return 'text-accent-yellow';
    case 'urgent':     return 'text-accent-red';
    default:           return 'text-text-muted';
  }
}

export default function InSessionControlPanel() {
  const trades = useStore(s => s.trades);
  const bs     = useStore(s => s.behaviorState);
  const cfg    = useStore(s => s.settings.behavior);

  // Re-render every second so age/countdown stays live
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => t.date === today);
  const errorsToday = todayTrades.filter(t => t.trade_type === 'error').length;
  const tradesAfterFirstError = (() => {
    const firstErrorIdx = todayTrades.findIndex(t => t.trade_type === 'error');
    if (firstErrorIdx < 0) return 0;
    return todayTrades.length - firstErrorIdx - 1;
  })();
  const impulsiveCount = todayTrades.filter(t => t.impulsive_trade_flag).length;
  const overtradingScore = impulsiveCount >= 5 ? 3 : impulsiveCount >= 3 ? 2 : impulsiveCount >= 1 ? 1 : 0;

  const lastTrade = todayTrades[todayTrades.length - 1];
  const lastStatus = lastTrade?.trade_type ?? null;
  const lastTradeAt = bs.last_trade_at;
  const lastTradeAgeSec = ageSec(lastTradeAt);
  const badge = modeBadge(bs.mode);
  const allowed = bs.mode === 'normal' || bs.mode === 'recovery';

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary font-semibold">
          <Activity size={14} /> In-Session Control
        </h3>
        <div className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold ${badge.color}`}>
          <badge.Icon size={14} /> {badge.label}
        </div>
      </div>

      {/* Release control + hard day-guard */}
      <ReleaseControl />

      {/* Live state grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label="Last trade"
          value={lastStatus ? lastStatus.toUpperCase() : '—'}
          tone={lastStatus === 'error' ? 'text-accent-red' : lastStatus === 'plan' ? 'text-accent-green' : 'text-text-muted'}
          sub={fmtAge(lastTradeAgeSec)}
        />
        <Stat
          label="Emotion"
          value={bs.last_emotion ? bs.last_emotion.toUpperCase() : '—'}
          tone={emotionTone(bs.last_emotion)}
        />
        <Stat
          label="Next trade allowed"
          value={allowed ? 'YES' : 'BLOCKED'}
          tone={allowed ? 'text-accent-green' : 'text-accent-red'}
        />
        <Stat
          label="Errors today"
          value={errorsToday}
          tone={errorsToday >= 2 ? 'text-accent-red' : errorsToday > 0 ? 'text-accent-yellow' : 'text-accent-green'}
        />
        <Stat
          label="After-error trades"
          value={tradesAfterFirstError}
          tone={tradesAfterFirstError >= cfg?.kill_post_error_count ? 'text-accent-red' : 'text-text-primary'}
        />
        <Stat
          label="Overtrading score"
          value={`${overtradingScore} / 3`}
          tone={overtradingScore >= 3 ? 'text-accent-red' : overtradingScore >= 1 ? 'text-accent-yellow' : 'text-accent-green'}
          sub={overtradingScore >= 3 ? 'loss of control' : overtradingScore >= 1 ? `${impulsiveCount} impulsive` : 'in control'}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'text-text-primary', sub }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`font-mono font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}

// ── Release control + hard day-guard (per-account daily lock + release cap) ─
function ReleaseControl() {
  const trades   = useStore(s => s.trades);
  const dayGuard = useStore(s => s.behaviorState.dayGuard);
  const cfg      = useStore(s => s.settings.behavior);
  const accounts = useStore(s => s.accounts);
  const startRelease  = useStore(s => s.startRelease);
  const endRelease    = useStore(s => s.endRelease);
  const cancelRelease = useStore(s => s.cancelRelease);
  const [label, setLabel] = useState('');

  const st = useMemo(() => guardStatus(trades, dayGuard, cfg), [trades, dayGuard, cfg]);
  const acctName = (id) => accounts.find(a => a.id === id)?.firm_name || id;

  const acctIds = Object.keys(st.accountPnl);
  const relPct  = st.active ? Math.min(100, Math.round((Math.max(0, -st.activePnl) / st.perReleaseCap) * 100)) : 0;
  const relTone = st.releaseCapped ? 'text-accent-red' : st.activePnl < 0 ? 'text-accent-yellow' : 'text-accent-green';

  function start() { startRelease(label); setLabel(''); }

  return (
    <div className="rounded-lg border border-bg-border bg-bg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-secondary font-semibold">
          <Radio size={12} /> Release control
        </span>
        <span className="text-[11px] font-mono text-text-muted">
          cap {fmtMoney(-st.dailyLossLock)}/acct · {fmtMoney(-st.perReleaseCap)}/release
        </span>
      </div>

      {/* Per-account day P&L vs the hard lock */}
      <div className="space-y-2">
        {acctIds.length === 0 && (
          <div className="text-[11px] text-text-muted">No trades yet this session.</div>
        )}
        {acctIds.map(id => {
          const pnl = st.accountPnl[id];
          const locked = st.lockedAccounts.includes(id);
          const pct = Math.min(100, Math.round((Math.max(0, -pnl) / st.dailyLossLock) * 100));
          const tone = locked ? 'text-accent-red' : pnl < 0 ? 'text-accent-yellow' : 'text-accent-green';
          return (
            <div key={id} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-muted truncate max-w-[55%]">{acctName(id)}</span>
                <span className={`font-mono font-semibold ${tone}`}>
                  {fmtMoney(pnl)} {locked && <span className="ml-1 text-accent-red">· LOCKED</span>}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
                <div className={`h-full ${locked ? 'bg-accent-red' : 'bg-accent-yellow'}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Optional release tracker (per-release -$ cap) */}
      {st.active ? (
        <div className="space-y-1 border-t border-bg-border pt-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-primary font-medium truncate max-w-[60%]">{st.active.label}</span>
            <span className={`font-mono font-semibold ${relTone}`}>
              {fmtMoney(st.activePnl)} / {fmtMoney(-st.perReleaseCap)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
            <div className={`h-full ${st.releaseCapped ? 'bg-accent-red' : 'bg-accent-yellow'}`} style={{ width: `${relPct}%` }} />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={endRelease}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-bg-hover hover:bg-bg-border text-text-primary">
              <Square size={12} /> End release
            </button>
            <button onClick={cancelRelease}
              title="Didn't fire — discard this release"
              className="px-2 py-1.5 text-xs rounded text-text-muted hover:text-accent-red">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 border-t border-bg-border pt-2">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && start()}
            placeholder="Track a release (e.g. 08:30 CPI)"
            className="flex-1 bg-bg-card border border-bg-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent-green/50"
          />
          <button onClick={start}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-green text-bg font-semibold hover:bg-accent-green-soft">
            <Play size={12} /> Start
          </button>
        </div>
      )}
    </div>
  );
}
