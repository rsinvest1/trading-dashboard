import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { useStore } from '../../store/useStore';
import { pnlByTicker } from '../../utils/analytics';
import { fmtMoney } from '../../utils/calculations';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-bg-card border border-bg-border rounded p-2 text-xs">
      <div className="font-semibold mb-1">{d.key}</div>
      <div className="font-mono">
        Net <span className={d.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}>{fmtMoney(d.pnl)}</span>
      </div>
      <div className="text-text-secondary">{d.count} trades · {d.winRate.toFixed(0)}% WR</div>
      <div className="text-text-secondary">PF {isFinite(d.profitFactor) ? d.profitFactor.toFixed(2) : '∞'}</div>
    </div>
  );
}

export default function PnlByTickerChart() {
  const trades = useStore(s => s.trades);
  const data = useMemo(() => pnlByTicker(trades), [trades]);

  if (!data.length) return null;

  return (
    <div className="card p-4 h-72">
      <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-3">P&L by Instrument</h3>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <XAxis type="number" tickFormatter={v => fmtMoney(v).replace('$', '')} stroke="#6b7280" fontSize={10} />
          <YAxis type="category" dataKey="key" stroke="#9ca3af" fontSize={11} width={45} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1a2230' }} />
          <ReferenceLine x={0} stroke="#374151" />
          <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
