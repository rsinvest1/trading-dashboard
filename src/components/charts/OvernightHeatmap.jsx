import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { intradayHeatmap } from '../../utils/analytics';
import { fmtMoney } from '../../utils/calculations';

const DAYS = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' }
];
// Overnight (Globex) session: 18:00 ET → 05:00 ET next morning.
const HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

function bgStyle(pnl, max) {
  if (pnl === 0 || !max) return { backgroundColor: '#121821' };
  const intensity = Math.min(1, Math.abs(pnl) / max);
  const opacity = 0.15 + intensity * 0.65;
  const color = pnl > 0 ? '34, 197, 94' : '239, 68, 68';
  return { backgroundColor: `rgba(${color}, ${opacity.toFixed(2)})` };
}

export default function OvernightHeatmap() {
  const trades = useStore(s => s.trades);
  // Reuse the same hour×day buckets as the intraday heatmap — it already keys
  // every hour by `dow|hour`; here we just render the overnight columns.
  const cells = useMemo(() => intradayHeatmap(trades), [trades]);

  // Scale colour intensity to the overnight cells only, so it isn't dwarfed by
  // larger RTH days.
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const { dow } of DAYS) {
      for (const h of HOURS) {
        const c = cells[`${dow}|${h}`];
        if (c) m = Math.max(m, Math.abs(c.pnl));
      }
    }
    return m;
  }, [cells]);

  // Hide entirely when there's no overnight activity at all.
  const hasAny = DAYS.some(({ dow }) => HOURS.some(h => cells[`${dow}|${h}`]));
  if (!hasAny) return null;

  return (
    <div className="card p-4">
      <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-3">Overnight Heatmap (P&L by hour × ON)</h3>
      <div className="flex flex-col gap-1 text-[10px]">
        <div className="grid grid-cols-[40px_repeat(12,1fr)] gap-1">
          <div />
          {HOURS.map(h => (
            <div key={h} className="text-center text-text-muted font-mono">{h.toString().padStart(2, '0')}</div>
          ))}
        </div>
        {DAYS.map(({ dow, label }) => (
          <div key={dow} className="grid grid-cols-[40px_repeat(12,1fr)] gap-1">
            <div className="text-text-muted font-mono uppercase tracking-wider self-center">{label}</div>
            {HOURS.map(h => {
              const cell = cells[`${dow}|${h}`];
              if (!cell) {
                return <div key={h} className="h-12 rounded-sm bg-bg-card/50 border border-bg-border" />;
              }
              return (
                <div
                  key={h}
                  className="h-12 rounded-sm border border-bg-border/40 flex items-center justify-center cursor-default"
                  style={bgStyle(cell.pnl, maxAbs)}
                  title={`${label} ${h.toString().padStart(2, '0')}:00 — ${fmtMoney(cell.pnl)} · ${cell.count} trades · ${cell.winRate.toFixed(0)}% WR`}
                >
                  <span className={`text-[9px] font-mono ${cell.pnl > 0 ? 'text-accent-green' : cell.pnl < 0 ? 'text-accent-red' : 'text-text-muted'}`}>
                    {cell.count}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        <div className="mt-2 flex items-center gap-3 text-text-muted">
          <span>18:00 → 05:00 ET · Cell value = trade count · Color = net P&L</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34,197,94,0.7)' }} /> profitable
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(239,68,68,0.7)' }} /> losing
          </span>
        </div>
      </div>
    </div>
  );
}
