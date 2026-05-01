import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import StatCard from '../components/StatCard';
import StreakBadge from '../components/StreakBadge';
import PropFirmRiskBar from '../components/PropFirmRiskBar';
import TendenciesSection from '../components/TendenciesSection';
import StrengthsPanel from '../components/StrengthsPanel';
import InSessionControlPanel from '../components/InSessionControlPanel';
import PnlByTickerChart from '../components/charts/PnlByTickerChart';
import DayOfWeekChart from '../components/charts/DayOfWeekChart';
import IntradayHeatmap from '../components/charts/IntradayHeatmap';
import {
  totalPnL, winLossCounts, winRate, profitFactor, avgRR, avgWin, avgLoss,
  expectancy, bestTrade, worstTrade, maxDrawdown, sharpeRatio, streaks,
  filterByPeriod, fmtMoney, fmtPct, fmtNum
} from '../utils/calculations';

const PERIODS = [
  { id: 'day',   label: 'Day' },
  { id: 'week',  label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all',   label: 'All' }
];

export default function DashboardPage() {
  const trades = useStore(s => s.trades);
  const accounts = useStore(s => s.accounts);
  const [period, setPeriod] = useState('all');

  const filtered = useMemo(() => filterByPeriod(trades, period), [trades, period]);
  const today = new Date().toISOString().slice(0, 10);
  const todayPnL = useMemo(
    () => trades.filter(t => t.date === today).reduce((s, t) => s + (Number(t.pnl) || 0), 0),
    [trades, today]
  );

  const stats = useMemo(() => {
    const pnl = totalPnL(filtered);
    const wl = winLossCounts(filtered);
    const wr = winRate(filtered);
    const pf = profitFactor(filtered);
    const rr = avgRR(filtered);
    const aw = avgWin(filtered);
    const al = avgLoss(filtered);
    const exp = expectancy(filtered);
    const best = bestTrade(filtered);
    const worst = worstTrade(filtered);
    const dd = maxDrawdown(filtered);
    const sh = sharpeRatio(filtered);
    const sk = streaks(filtered);
    return { pnl, wl, wr, pf, rr, aw, al, exp, best, worst, dd, sh, sk };
  }, [filtered]);

  const tone = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'neutral');

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">
            {trades.length === 0
              ? 'No trades yet — add a trade or import a CSV to see stats.'
              : `${trades.length} total trade${trades.length === 1 ? '' : 's'} tracked`}
          </p>
        </div>
        <div className="flex gap-1 bg-bg-card p-1 rounded-lg border border-bg-border">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                period === p.id
                  ? 'bg-accent-green text-bg font-medium'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total P&L" value={fmtMoney(stats.pnl)} tone={tone(stats.pnl)} />
        <StatCard
          label="Trades"
          value={stats.wl.total}
          sub={`${stats.wl.wins}W · ${stats.wl.losses}L${stats.wl.breakeven ? ` · ${stats.wl.breakeven}BE` : ''}`}
        />
        <StatCard label="Win Rate" value={fmtPct(stats.wr)} tone={stats.wr >= 50 ? 'pos' : 'neg'} />
        <StatCard label="Profit Factor" value={fmtNum(stats.pf)} tone={stats.pf >= 1 ? 'pos' : 'neg'} />
        <StatCard label="Avg R:R" value={fmtNum(stats.rr)} />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Max Drawdown" value={fmtMoney(stats.dd)} tone="neg" />
        <StatCard label="Sharpe (annl)" value={fmtNum(stats.sh)} />
        <StatCard label="Expectancy" value={fmtMoney(stats.exp)} tone={tone(stats.exp)} />
        <StatCard
          label="Best Trade"
          value={stats.best ? fmtMoney(stats.best.pnl) : '—'}
          sub={stats.best?.ticker}
          tone="pos"
        />
        <StatCard
          label="Worst Trade"
          value={stats.worst ? fmtMoney(stats.worst.pnl) : '—'}
          sub={stats.worst?.ticker}
          tone="neg"
        />
        <StatCard label="Avg Win / Loss" value={`${fmtMoney(stats.aw)} / ${fmtMoney(stats.al)}`} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <StreakBadge streaks={stats.sk} />
        <StatCard label="Today's P&L" value={fmtMoney(todayPnL)} tone={tone(todayPnL)} />
        <StatCard label="Period" value={PERIODS.find(p => p.id === period).label} sub="Adjust above" mono={false} />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-3">Behavior Engine</h2>
        <InSessionControlPanel />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-3">Prop Firm Risk</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map(acc => (
            <PropFirmRiskBar key={acc.id} account={acc} dailyPnL={todayPnL} />
          ))}
        </div>
      </section>

      <StrengthsPanel />

      <section>
        <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-3">Analytics</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <PnlByTickerChart />
          <DayOfWeekChart />
          <div className="lg:col-span-2">
            <IntradayHeatmap />
          </div>
        </div>
      </section>

      <TendenciesSection />
    </div>
  );
}
