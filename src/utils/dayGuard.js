import { tradeSessionDate, currentSessionDate } from './calculations';

// ── Hard day-guard (client-side, no Netlify) ─────────────────────────────
// Two simple limits on top of the emotional Behavior Engine:
//   • daily_loss_lock     — PER ACCOUNT: lock an account once its session-day
//                           P&L (all trades, release or not) hits <= -$X.
//   • per_release_loss_cap — block new entries on a release once it hits -$X.
// Releases are an OPTIONAL tracker (no count limit). All derived from `trades`
// in localStorage; nothing here touches the network.

// Per-session guard slice. Reset when the CME session date rolls over
// (handled in the store's tickBehavior).
export function defaultDayGuard() {
  return {
    session_date: null,
    releases: [],            // { id, label, started_at, ended_at }
    active_release_id: null
  };
}

export function sumPnl(trades) {
  return (trades || []).reduce((s, t) => s + (Number(t.pnl) || 0), 0);
}

// Trades belonging to a given CME session date.
export function dayTrades(trades, sessionDate) {
  return (trades || []).filter(t => tradeSessionDate(t) === sessionDate);
}

// Derived status for the day's hard limits. Pure — no mutation.
//   cfg: settings.behavior (daily_loss_lock, per_release_loss_cap)
export function guardStatus(trades, dayGuard, cfg, sessionDate = currentSessionDate()) {
  const dailyLossLock = cfg?.daily_loss_lock ?? 1200;
  const perReleaseCap = cfg?.per_release_loss_cap ?? 600;
  const g = dayGuard || defaultDayGuard();

  const dt = dayTrades(trades, sessionDate);

  // Per-account session-day P&L → which accounts are locked.
  const accountPnl = {};
  for (const t of dt) {
    const k = t.account_id || 'unknown';
    accountPnl[k] = (accountPnl[k] || 0) + (Number(t.pnl) || 0);
  }
  const lockedAccounts = Object.keys(accountPnl).filter(k => accountPnl[k] <= -dailyLossLock);

  // Active release (optional) → its P&L vs the per-release cap.
  const releases = g.releases || [];
  const active = releases.find(r => r.id === g.active_release_id) || null;
  const activeTrades = active ? dt.filter(t => t.release_id === active.id) : [];
  const activePnl = sumPnl(activeTrades);
  const activeAccountId = activeTrades[0]?.account_id || null;
  const releaseCapped = !!active && activePnl <= -perReleaseCap;

  return {
    sessionDate, dailyLossLock, perReleaseCap,
    accountPnl, lockedAccounts,
    active, activePnl, activeAccountId, releaseCapped,
    canStartRelease: !active
  };
}
