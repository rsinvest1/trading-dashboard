import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { useStore } from '../../store/useStore';
import { fmtMoney } from '../../utils/calculations';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-bg-card border border-bg-border rounded p-2 text-xs">
      <div className="font-semibold mb-1">{d.name}</div>
      <div className="font-mono">
        Net <span className={d.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}>{fmtMoney(d.pnl)}</span>
      </div>
      <div className="text-text-secondary">{d.count} trade{d.count !== 1 ? 's' : ''} · {d.winRate.toFixed(0)}% WR</div>
    </div>
  );
}

export default function PnlByPlaybookChart() {
  const trades    = useStore(s => s.trades);
  const playbooks = useStore(s => s.playbooks);

  const data = useMemo(() => {
    const nameById = Object.fromEntries(
      playbooks.map(p => [p.id, p.title || p.setup_name || `Playbook ${p.date || ''}`])
    );
    const UNASSIGNED = '__unassigned__';
    const map = {};
    for (const t of trades) {
      const key = t.playbook_id || UNASSIGNED;  // off-script trades go to one bucket
      const v = (map[key] ||= { pnl: 0, wins: 0, count: 0 });
      v.pnl += Number(t.pnl) || 0;
      v.count += 1;
      if ((Number(t.pnl) || 0) > 0) v.wins += 1;
    }
    return Object.entries(map)
      .map(([id, v]) => ({
        name: id === UNASSIGNED ? 'Unassigned' : (nameById[id] || 'Unknown'),
        unassigned: id === UNASSIGNED,
        pnl: Number(v.pnl.toFixed(2)),
        count: v.count,
        winRate: v.count ? (v.wins / v.count) * 100 : 0
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [trades, playbooks]);

  if (!data.length) return null;

  // Grow with the number of playbooks so every bar + label is visible.
  const chartHeight = Math.max(245, data.length * 28);

  return (
    <div className="card p-4">
      <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-3">P&L by Playbook</h3>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <XAxis type="number" tickFormatter={v => fmtMoney(v).replace('$', '')} stroke="#6b7280" fontSize={10} />
          <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={120} interval={0} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1a2230' }} />
          <ReferenceLine x={0} stroke="#374151" />
          <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'}
                fillOpacity={d.unassigned ? 0.45 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
