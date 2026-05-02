import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Lock, Pause, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';

// ── Single hook: ticks the Behavior Engine every second ──────────────────
export function useBehaviorTick() {
  const tick = useStore(s => s.tickBehavior);
  useEffect(() => {
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [tick]);
}

function fmtCountdown(target) {
  if (!target) return '0:00';
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

// ── Persistent rule banner (top of app) ──────────────────────────────────
export function PersistentRuleBanner() {
  const mode = useStore(s => s.behaviorState.mode);
  if (mode !== 'normal') return null;
  return (
    <div className="bg-bg-hover border-b border-bg-border px-4 py-1.5 text-[11px] flex items-center justify-center gap-2 text-text-secondary">
      <ShieldAlert size={12} className="text-accent-yellow" />
      Rule: After an error trade, take a mandatory pause. Discipline before P&L.
    </div>
  );
}

// ── Top banner shown when paused (after error) ───────────────────────────
export function PauseCountdown() {
  useTick();
  const mode  = useStore(s => s.behaviorState.mode);
  const until = useStore(s => s.behaviorState.pause_until);
  if (mode !== 'paused' || !until) return null;
  return (
    <div className="bg-accent-red text-white px-4 py-3 flex items-center justify-center gap-3 font-semibold animate-pulse-soft">
      <Pause size={16} />
      <span className="uppercase tracking-wider text-sm">Error detected — pause required</span>
      <span className="font-mono bg-black/30 rounded px-2 py-0.5 text-sm">{fmtCountdown(until)}</span>
      <span className="text-xs opacity-90 ml-2">No new trades during this period.</span>
    </div>
  );
}

// ── Subtle banner for Recovery mode ──────────────────────────────────────
export function RecoveryBanner() {
  const mode = useStore(s => s.behaviorState.mode);
  const cfg  = useStore(s => s.settings.behavior);
  if (mode !== 'recovery') return null;
  return (
    <div className="bg-accent-yellow/15 border-b border-accent-yellow/40 text-accent-yellow px-4 py-2 flex items-center justify-center gap-2 text-sm">
      <RefreshCw size={14} />
      <span className="font-semibold uppercase tracking-wider text-[11px]">Recovery mode active</span>
      <span className="text-[11px] opacity-90">
        Reduced cap: max {cfg?.recovery_max_trades_per_hour ?? 2} trades/hour.
        Exits after {cfg?.recovery_calm_streak_to_exit ?? 2} consecutive Calm states.
      </span>
    </div>
  );
}

// ── Full-page block when locked (kill switch) ────────────────────────────
export function KillSwitchScreen() {
  useTick();
  const mode = useStore(s => s.behaviorState.mode);
  const until = useStore(s => s.behaviorState.lock_until);
  const consecErrors = useStore(s => s.behaviorState.consecutive_errors);
  const overrideLock = useStore(s => s.overrideLock);
  const minChars = useStore(s => s.settings.behavior?.override_min_reason_chars ?? 20);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideNote, setOverrideNote] = useState('');

  if (mode !== 'locked') return null;

  function doOverride() {
    if (!overrideNote.trim() || overrideNote.trim().length < minChars) return;
    overrideLock(overrideNote.trim());
    setShowOverride(false);
    setOverrideNote('');
  }

  return (
    <div className="fixed inset-0 z-[70] bg-bg flex items-center justify-center p-6">
      <div className="max-w-xl w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-accent-red/15 border-2 border-accent-red">
          <Lock size={36} className="text-accent-red" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-accent-red mb-2">TRADING LOCKED</h1>
          <p className="text-lg text-text-primary">Behavioral risk detected</p>
          <p className="text-sm text-text-secondary mt-2">
            {consecErrors >= 2
              ? 'Consecutive error trades have triggered a cool-down.'
              : 'Too many trades after an error — impulsive pattern detected.'}
          </p>
        </div>

        <div className="card p-6 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-text-muted">Lock expires in</div>
          <div className="text-5xl font-mono text-accent-red font-bold">
            {fmtCountdown(until)}
          </div>
          <div className="text-xs text-text-muted">
            Step away from the screen. Reset, then come back.
          </div>
        </div>

        {!showOverride ? (
          <button
            onClick={() => setShowOverride(true)}
            className="text-[11px] text-text-muted hover:text-accent-red underline"
          >
            Override (logged for accountability)
          </button>
        ) : (
          <div className="card p-4 space-y-3 text-left border-accent-red/30">
            <div className="text-xs text-accent-red font-semibold uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle size={14} /> This override will be permanently logged
            </div>
            <textarea
              value={overrideNote}
              onChange={e => setOverrideNote(e.target.value)}
              placeholder={`Why are you overriding the lock? (min ${minChars} chars — be honest)`}
              rows={3}
              className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-red/50 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">{overrideNote.trim().length}/{minChars}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowOverride(false); setOverrideNote(''); }}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                >
                  Stay locked
                </button>
                <button
                  onClick={doOverride}
                  disabled={overrideNote.trim().length < minChars}
                  className="px-3 py-1.5 text-xs bg-accent-red text-white rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Override anyway
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Composite root component ─────────────────────────────────────────────
export default function BehaviorOverlay() {
  useBehaviorTick();
  return (
    <>
      <PauseCountdown />
      <RecoveryBanner />
      <KillSwitchScreen />
    </>
  );
}
