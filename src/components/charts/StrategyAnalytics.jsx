import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  ScatterChart, Scatter, CartesianGrid
} from 'recharts';
import { fmtMoney } from '../../utils/calculations';

// ── Shared tooltip shell ────────────────────────────────────────────────
function Tip({ children }) {
  return (
    <div className="bg-bg-card border border-bg-border rounded p-2 text-xs shadow-lg">
      {children}
    </div>
  );
}

// ── 1. P&L by Strategy ──────────────────────────────────────────────────
function StrategyTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Tip>
      <div className="font-semibold mb-1">{d.name}</div>
      <div className="font-mono">
        Net <span className={d.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}>{fmtMoney(d.pnl)}</span>
      </div>
      <div className="text-text-secondary">{d.count} trade{d.count !== 1 ? 's' : ''} · {d.winRate.toFixed(0)}% WR</div>
    </Tip>
  );
}

function PnlByStrategy({ filtered, strategies }) {
  const data = useMemo(() => {
    const map = {};
    for (const t of filtered) {
      const key = t.strategy_id || '__none__';
      if (!map[key]) map[key] = { pnl: 0, wins: 0, count: 0 };
      map[key].pnl   += Number(t.pnl) || 0;
      map[key].count += 1;
      if ((Number(t.pnl) || 0) > 0) map[key].wins += 1;
    }
    const stratMap = Object.fromEntries(strategies.map(s => [s.id, s.name]));
    return Object.entries(map)
      .map(([id, v]) => ({
        name: id === '__none__' ? 'Untagged' : (stratMap[id] || 'Unknown'),
        pnl:  Number(v.pnl.toFixed(2)),
        count: v.count,
        winRate: v.count ? (v.wins / v.count) * 100 : 0
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [filtered, strategies]);

  if (!data.length) return null;

  return (
    <div className="card p-4 h-64">
      <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-3">P&amp;L by Strategy</h3>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 10, left: 10, bottom: 4 }}>
          <XAxis type="number" tickFormatter={v => fmtMoney(v).replace('$', '')} stroke="#6b7280" fontSize={10} />
          <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={80} />
          <Tooltip content={<StrategyTip />} cursor={{ fill: '#1a2230' }} />
          <ReferenceLine x={0} stroke="#374151" />
          <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 2. Rules Adherence vs P&L ───────────────────────────────────────────
function AdherenceTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Tip>
      <div className="font-semibold mb-1">{d.stratName}</div>
      <div className="text-text-secondary">{d.date} · {d.ticker} {d.side}</div>
      <div className="font-mono mt-1">
        P&amp;L <span className={d.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}>{fmtMoney(d.pnl)}</span>
      </div>
      <div className="text-text-secondary">{d.followed}/{d.total} rules ({d.adherence.toFixed(0)}%)</div>
    </Tip>
  );
}

function AdherenceScatter({ filtered, strategies }) {
  const data = useMemo(() => {
    const stratMap = Object.fromEntries(strategies.map(s => [s.id, s]));
    return filtered
      .filter(t => t.strategy_id && t.rules_followed?.length > 0)
      .map(t => {
        const strat = stratMap[t.strategy_id];
        if (!strat) return null;
        const total = (strat.entry_rules?.length || 0) + (strat.exit_rules?.length || 0);
        if (!total) return null;
        const followed = t.rules_followed.length;
        return {
          adherence: (followed / total) * 100,
          pnl: Number(t.pnl) || 0,
          stratName: strat.name,
          followed, total,
          date: t.date,
          ticker: t.ticker,
          side: t.side
        };
      })
      .filter(Boolean);
  }, [filtered, strategies]);

  if (data.length < 3) return null;

  return (
    <div className="card p-4 h-64">
      <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-1">Rules Adherence vs P&amp;L</h3>
      <p className="text-[10px] text-text-muted mb-2">Each dot = one trade. X = % of rules followed.</p>
      <ResponsiveContainer width="100%" height="80%">
        <ScatterChart margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#1e2a3a" />
          <XAxis
            type="number" dataKey="adherence" domain={[0, 100]}
            tickFormatter={v => `${v}%`} stroke="#6b7280" fontSize={10}
          />
          <YAxis
            type="number" dataKey="pnl"
            tickFormatter={v => fmtMoney(v).replace('$', '')} stroke="#6b7280" fontSize={10}
          />
          <ReferenceLine y={0} stroke="#374151" />
          <Tooltip content={<AdherenceTip />} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} shape={(props) => {
            const { cx, cy, payload } = props;
            return <circle cx={cx} cy={cy} r={4} fill={payload.pnl >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.75} />;
          }} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 3. P&L by Tag Category ──────────────────────────────────────────────
function TagTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Tip>
      <div className="font-semibold mb-1">{d.name}</div>
      <div className="font-mono">
        Net <span className={d.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}>{fmtMoney(d.pnl)}</span>
      </div>
      <div className="text-text-secondary">{d.count} tagged trade{d.count !== 1 ? 's' : ''}</div>
    </Tip>
  );
}

function PnlByTag({ filtered, tagCategories }) {
  const data = useMemo(() => {
    return tagCategories
      .map(cat => {
        let pnl = 0, count = 0;
        for (const t of filtered) {
          const catTags = t.tags?.[cat.id];
          if (catTags?.length) { pnl += Number(t.pnl) || 0; count++; }
        }
        return { name: cat.label, pnl: Number(pnl.toFixed(2)), count };
      })
      .filter(d => d.count > 0)
      .sort((a, b) => b.pnl - a.pnl);
  }, [filtered, tagCategories]);

  if (!data.length) return null;

  return (
    <div className="card p-4 h-64">
      <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-3">P&amp;L by Tag Category</h3>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 10, left: 10, bottom: 4 }}>
          <XAxis type="number" tickFormatter={v => fmtMoney(v).replace('$', '')} stroke="#6b7280" fontSize={10} />
          <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={80} />
          <Tooltip content={<TagTip />} cursor={{ fill: '#1a2230' }} />
          <ReferenceLine x={0} stroke="#374151" />
          <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#22c55e' : '#ef4444'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Exported composite ──────────────────────────────────────────────────
export default function StrategyAnalytics({ filtered, strategies, tagCategories }) {
  const hasStrategies = strategies?.length > 0;
  const hasTrades = filtered?.length > 0;

  if (!hasTrades || !hasStrategies) return null;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PnlByStrategy filtered={filtered} strategies={strategies} />
        <PnlByTag filtered={filtered} tagCategories={tagCategories || []} />
      </div>
      <AdherenceScatter filtered={filtered} strategies={strategies} />
    </>
  );
}
