import { fmtMoney } from '../utils/calculations';

function pctOf(used, limit) {
  if (!limit) return 0;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

function toneFor(pct) {
  if (pct >= 80) return 'bg-accent-red';
  if (pct >= 50) return 'bg-accent-yellow';
  return 'bg-accent-green';
}

// For scaling-plan accounts (e.g. LucidFlex Funded): the tier that applies at the
// given realized profit, plus the next tier up (if any).
function scalingTier(plan, profit) {
  const sorted = [...plan].sort((a, b) => a.min - b.min);
  let cur = sorted[0] || null;
  let next = null;
  for (const t of sorted) {
    if (profit >= t.min) cur = t;
    else { next = t; break; }
  }
  return { cur, next };
}

export default function PropFirmRiskBar({ account, dailyPnL = 0 }) {
  const dailyUsed = dailyPnL < 0 ? -dailyPnL : 0;
  const dailyPct = pctOf(dailyUsed, account.daily_loss_limit);
  const profitUsed = dailyPnL > 0 ? dailyPnL : 0;
  const profitPct = pctOf(profitUsed, account.max_daily_profit);

  const drawdown = Math.max(0, account.account_size - account.current_balance);
  const ddPct = pctOf(drawdown, account.trailing_drawdown_limit);

  const profit = (account.current_balance ?? 0) - (account.account_size ?? 0);
  const hasTarget = account.profit_target != null && account.profit_target > 0;
  const targetPct = hasTarget
    ? Math.max(0, Math.min(100, (profit / account.profit_target) * 100))
    : 0;

  const hasScaling = Array.isArray(account.scaling_plan) && account.scaling_plan.length > 0;
  const { cur: scaleCur, next: scaleNext } = hasScaling
    ? scalingTier(account.scaling_plan, profit)
    : { cur: null, next: null };

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-text-primary truncate">{account.firm_name}</div>
          {account.platform && (
            <div className="text-[10px] text-text-muted truncate">{account.platform}</div>
          )}
        </div>
        <div className="text-xs text-text-secondary font-mono shrink-0">
          Bal {fmtMoney(account.current_balance)}
        </div>
      </div>

      {hasTarget && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-secondary">Profit target</span>
            <span className="font-mono">
              <span className={profit < 0 ? 'text-accent-red' : 'text-accent-green'}>
                {fmtMoney(profit)}
              </span>
              {' / '}
              {fmtMoney(account.profit_target)}
            </span>
          </div>
          <div className="h-2 rounded bg-bg-hover overflow-hidden">
            <div className="h-full bg-accent-green transition-all" style={{ width: `${targetPct}%` }} />
          </div>
        </div>
      )}

      {account.daily_loss_limit ? (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-secondary">Daily loss</span>
            <span className="font-mono">
              {fmtMoney(dailyUsed)} / {fmtMoney(account.daily_loss_limit)}
            </span>
          </div>
          <div className="h-2 rounded bg-bg-hover overflow-hidden">
            <div className={`h-full ${toneFor(dailyPct)} transition-all`} style={{ width: `${dailyPct}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">Daily loss</span>
          <span className="font-mono text-text-muted">No daily limit</span>
        </div>
      )}

      {!!account.max_daily_profit && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-secondary">Daily profit consistency</span>
            <span className="font-mono">
              {fmtMoney(profitUsed)} / {fmtMoney(account.max_daily_profit)}
            </span>
          </div>
          <div className="h-2 rounded bg-bg-hover overflow-hidden">
            <div className={`h-full ${profitPct >= 100 ? 'bg-accent-yellow' : 'bg-accent-green'} transition-all`} style={{ width: `${profitPct}%` }} />
          </div>
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-text-secondary">
            {account.eod_rule ? 'Drawdown (EOD)' : 'Trailing drawdown'}
          </span>
          <span className="font-mono">
            {fmtMoney(drawdown)} / {fmtMoney(account.trailing_drawdown_limit)}
          </span>
        </div>
        <div className="h-2 rounded bg-bg-hover overflow-hidden">
          <div className={`h-full ${toneFor(ddPct)} transition-all`} style={{ width: `${ddPct}%` }} />
        </div>
      </div>

      {hasScaling && scaleCur && (
        <div>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-text-secondary">Size allowed now</span>
            <span className="font-mono text-accent-green">
              {scaleCur.contracts} mini · {scaleCur.micros} µ
            </span>
          </div>
          <div className="text-[10px] text-text-muted font-mono">
            profit {fmtMoney(profit)}
            {scaleNext
              ? ` · ${scaleNext.contracts} mini at ${fmtMoney(scaleNext.min)}`
              : ' · max tier reached'}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {account.max_contracts != null && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-secondary">
              Max {account.max_contracts} mini{account.max_contracts_micros ? ` · ${account.max_contracts_micros} µ` : ''}
            </span>
          )}
          {account.drawdown_type && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-secondary">
              {account.drawdown_type}
            </span>
          )}
        </div>
        {account.eod_rule && (
          <div className="text-[10px] uppercase tracking-wider text-accent-yellow/80 shrink-0">
            EOD rule active
          </div>
        )}
      </div>
    </div>
  );
}
