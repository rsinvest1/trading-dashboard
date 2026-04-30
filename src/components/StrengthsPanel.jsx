import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { computeStrengths } from '../utils/analytics';
import { fmtMoney } from '../utils/calculations';

export default function StrengthsPanel() {
  const trades   = useStore(s => s.trades);
  const accounts = useStore(s => s.accounts);
  const strengths = useMemo(() => computeStrengths(trades, accounts), [trades, accounts]);

  if (!strengths.length) {
    return (
      <section>
        <h2 className="flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary mb-3">
          <Sparkles size={14} className="text-accent-green" /> Main Strengths
        </h2>
        <div className="card p-6 text-center text-sm text-text-muted">
          {trades.length < 5
            ? 'Need at least 5 trades to surface strengths.'
            : 'No clear edges yet — waiting on a positive expectancy in any bucket.'}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary mb-3">
        <Sparkles size={14} className="text-accent-green" /> Main Strengths
        <span className="text-[11px] normal-case text-text-muted font-normal">— where you make money</span>
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {strengths.map((s, i) => (
          <div key={i} className="card p-3 border-accent-green/20">
            <div className="stat-label text-accent-green/80">{s.dim}</div>
            <div className="text-lg font-semibold mt-1 truncate">{s.value}</div>
            <div className="text-sm font-mono font-semibold text-accent-green mt-0.5">
              {fmtMoney(s.pnl)}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
