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

export default function PropFirmRiskBar({ account, dailyPnL = 0 }) {
  const dailyUsed = dailyPnL < 0 ? -dailyPnL : 0;
  const dailyPct = pctOf(dailyUsed, account.daily_loss_limit);

  const drawdown = Math.max(0, account.account_size - account.current_balance);
  const ddPct = pctOf(drawdown, account.trailing_drawdown_limit);

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-medium text-text-primary">{account.firm_name}</div>
        <div className="text-xs text-text-secondary font-mono">
          Bal {fmtMoney(account.current_balance)}
        </div>
      </div>

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

      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-text-secondary">Trailing drawdown</span>
          <span className="font-mono">
            {fmtMoney(drawdown)} / {fmtMoney(account.trailing_drawdown_limit)}
          </span>
        </div>
        <div className="h-2 rounded bg-bg-hover overflow-hidden">
          <div className={`h-full ${toneFor(ddPct)} transition-all`} style={{ width: `${ddPct}%` }} />
        </div>
      </div>

      {account.eod_rule && (
        <div className="text-[10px] uppercase tracking-wider text-accent-yellow/80">
          EOD rule active
        </div>
      )}
    </div>
  );
}
