import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { fmtMoney } from '../utils/calculations';

const VIEWS = [
  { id: 'month', label: 'Month' },
  { id: 'year',  label: 'Year' }
];

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function monthGrid(year, month) {
  // month is 0-indexed. Build a 6×7 grid of Date objects, Mon-first.
  const first = new Date(year, month, 1);
  // 0=Sun .. 6=Sat → convert to Mon=0 .. Sun=6
  const firstWeekday = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekday);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return cells;
}

function aggregateByDay(trades) {
  const map = {};
  for (const t of trades) {
    if (!map[t.date]) map[t.date] = { pnl: 0, count: 0 };
    map[t.date].pnl += Number(t.pnl) || 0;
    map[t.date].count++;
  }
  return map;
}

function bgFor(pnl, max) {
  if (pnl === 0 || !max) return 'bg-bg-card';
  const intensity = Math.min(1, Math.abs(pnl) / max);
  const opacity = 0.15 + intensity * 0.55;
  if (pnl > 0) return `bg-accent-green/[${opacity.toFixed(2)}]`;
  return `bg-accent-red/[${opacity.toFixed(2)}]`;
}

function bgStyle(pnl, max) {
  if (pnl === 0 || !max) return {};
  const intensity = Math.min(1, Math.abs(pnl) / max);
  const opacity = 0.12 + intensity * 0.55;
  const color = pnl > 0 ? '34, 197, 94' : '239, 68, 68';
  return { backgroundColor: `rgba(${color}, ${opacity.toFixed(2)})` };
}

function MonthView({ year, month, byDay, onSelectDay }) {
  const cells = useMemo(() => monthGrid(year, month), [year, month]);
  const todayIso = isoDate(new Date());

  const visiblePnls = cells
    .filter(c => c.getMonth() === month)
    .map(c => byDay[isoDate(c)]?.pnl || 0)
    .filter(v => v !== 0);
  const maxAbs = visiblePnls.length ? Math.max(...visiblePnls.map(Math.abs)) : 0;

  const monthPnl = cells
    .filter(c => c.getMonth() === month)
    .reduce((s, c) => s + (byDay[isoDate(c)]?.pnl || 0), 0);
  const monthTrades = cells
    .filter(c => c.getMonth() === month)
    .reduce((s, c) => s + (byDay[isoDate(c)]?.count || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-text-secondary">
          {monthTrades} trade{monthTrades === 1 ? '' : 's'} this month
        </div>
        <div className={`text-sm font-mono font-semibold ${monthPnl > 0 ? 'text-accent-green' : monthPnl < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
          Net {fmtMoney(monthPnl)}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-text-muted">
        {DAY_HEADERS.map(d => <div key={d} className="px-2 py-1 text-center">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const iso = isoDate(c);
          const inMonth = c.getMonth() === month;
          const isToday = iso === todayIso;
          const data = byDay[iso];
          const pnl = data?.pnl || 0;
          return (
            <button
              key={i}
              onClick={() => data && onSelectDay(iso)}
              disabled={!data}
              style={bgStyle(pnl, maxAbs)}
              className={`
                aspect-[5/4] rounded border text-left p-2 transition-all
                ${inMonth ? 'border-bg-border' : 'border-transparent opacity-30'}
                ${isToday ? 'ring-1 ring-accent-green/60' : ''}
                ${data ? 'hover:border-text-secondary cursor-pointer' : 'cursor-default'}
              `}
            >
              <div className={`text-xs font-mono ${inMonth ? 'text-text-primary' : 'text-text-muted'}`}>
                {c.getDate()}
              </div>
              {data && (
                <>
                  <div className={`text-sm font-mono font-semibold mt-1 ${pnl > 0 ? 'text-accent-green' : pnl < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
                    {fmtMoney(pnl)}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {data.count} trade{data.count === 1 ? '' : 's'}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function YearView({ year, byDay, onSelectDay }) {
  const months = Array.from({ length: 12 }, (_, m) => {
    const cells = monthGrid(year, m);
    const monthCells = cells.filter(c => c.getMonth() === m);
    const pnl = monthCells.reduce((s, c) => s + (byDay[isoDate(c)]?.pnl || 0), 0);
    const trades = monthCells.reduce((s, c) => s + (byDay[isoDate(c)]?.count || 0), 0);
    return { m, name: new Date(year, m, 1).toLocaleString('en-US', { month: 'short' }), pnl, trades, cells };
  });

  const allDayPnls = months.flatMap(m => m.cells
    .filter(c => c.getMonth() === m.m)
    .map(c => byDay[isoDate(c)]?.pnl || 0)
    .filter(v => v !== 0));
  const maxAbs = allDayPnls.length ? Math.max(...allDayPnls.map(Math.abs)) : 0;
  const yearPnl = months.reduce((s, m) => s + m.pnl, 0);
  const yearTrades = months.reduce((s, m) => s + m.trades, 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-text-secondary">
          {yearTrades} trade{yearTrades === 1 ? '' : 's'} this year
        </div>
        <div className={`text-sm font-mono font-semibold ${yearPnl > 0 ? 'text-accent-green' : yearPnl < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
          Net {fmtMoney(yearPnl)}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {months.map(({ m, name, pnl, trades, cells }) => (
          <div key={m} className="card p-3">
            <div className="flex justify-between items-baseline mb-2">
              <div className="text-xs uppercase tracking-wider text-text-secondary">{name}</div>
              <div className={`text-xs font-mono ${pnl > 0 ? 'text-accent-green' : pnl < 0 ? 'text-accent-red' : 'text-text-muted'}`}>
                {trades > 0 ? fmtMoney(pnl) : '—'}
              </div>
            </div>
            <div className="grid grid-cols-7 gap-px">
              {cells.map((c, i) => {
                const iso = isoDate(c);
                const inMonth = c.getMonth() === m;
                const data = byDay[iso];
                const dayPnl = data?.pnl || 0;
                return (
                  <button
                    key={i}
                    onClick={() => data && onSelectDay(iso)}
                    disabled={!data}
                    style={bgStyle(dayPnl, maxAbs)}
                    className={`
                      aspect-square rounded-sm
                      ${inMonth ? 'border border-bg-border' : 'opacity-0 pointer-events-none'}
                      ${data ? 'hover:ring-1 hover:ring-text-secondary cursor-pointer' : ''}
                    `}
                    title={data ? `${iso}: ${fmtMoney(dayPnl)} (${data.count} trade${data.count === 1 ? '' : 's'})` : ''}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayDrawer({ date, trades, accountById, onClose }) {
  const dayTrades = trades.filter(t => t.date === date);
  const totalPnl = dayTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const wins   = dayTrades.filter(t => t.pnl > 0).length;
  const losses = dayTrades.filter(t => t.pnl < 0).length;
  const sorted = [...dayTrades].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-lg bg-bg-card border-l border-bg-border overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-bg-border">
          <div>
            <div className="font-semibold">{dateLabel}</div>
            <div className="text-xs text-text-secondary mt-0.5">
              {dayTrades.length} trade{dayTrades.length === 1 ? '' : 's'} · {wins}W / {losses}L
            </div>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 border-b border-bg-border">
          <div className="stat-label">Day P&L</div>
          <div className={`text-3xl font-semibold font-mono mt-1 ${totalPnl > 0 ? 'text-accent-green' : totalPnl < 0 ? 'text-accent-red' : ''}`}>
            {fmtMoney(totalPnl)}
          </div>
        </div>

        <div className="divide-y divide-bg-border">
          {sorted.map(t => (
            <div key={t.id} className="p-4 hover:bg-bg-hover/30">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-text-secondary">{t.time}</span>
                  <span className="font-medium">{t.ticker}</span>
                  <span className={`text-xs ${t.side === 'Long' ? 'text-accent-green' : 'text-accent-red'}`}>{t.side}</span>
                  <span className="text-xs text-text-muted">×{t.contracts}</span>
                </div>
                <span className={`font-mono font-semibold text-sm ${t.pnl > 0 ? 'text-accent-green' : t.pnl < 0 ? 'text-accent-red' : ''}`}>
                  {fmtMoney(t.pnl)}
                </span>
              </div>
              <div className="text-[11px] text-text-muted mt-1 font-mono flex gap-3">
                {t.entry != null && <span>Entry {t.entry}</span>}
                {t.exit  != null && <span>Exit {t.exit}</span>}
                {t.account_id && accountById[t.account_id] && (
                  <span>{accountById[t.account_id].firm_name.split(' ')[0]}</span>
                )}
              </div>
              {t.notes && (
                <div className="text-xs text-text-secondary mt-2 italic">{t.notes}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const trades   = useStore(s => s.trades);
  const accounts = useStore(s => s.accounts);

  const [view, setView]   = useState('month');
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(null);

  const accountById = useMemo(
    () => Object.fromEntries(accounts.map(a => [a.id, a])),
    [accounts]
  );
  const byDay = useMemo(() => aggregateByDay(trades), [trades]);

  function shift(delta) {
    setCursor(c => {
      if (view === 'month') {
        const m = c.month + delta;
        const y = c.year + Math.floor(m / 12);
        return { year: y, month: ((m % 12) + 12) % 12 };
      }
      return { ...c, year: c.year + delta };
    });
  }

  function jumpToToday() {
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }

  function jumpToLatestTrade() {
    if (!trades.length) return;
    const latest = trades.reduce((m, t) => t.date > m ? t.date : m, trades[0].date);
    const d = new Date(latest + 'T00:00:00');
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }

  const heading = view === 'month'
    ? new Date(cursor.year, cursor.month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
    : String(cursor.year);

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-text-secondary mt-1">
            Daily P&L heatmap — click a day for details.
          </p>
        </div>
        <div className="flex gap-1 bg-bg-card p-1 rounded-lg border border-bg-border">
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                view === v.id ? 'bg-accent-green text-bg font-medium' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="p-1.5 rounded border border-bg-border hover:bg-bg-hover">
            <ChevronLeft size={16} />
          </button>
          <div className="text-lg font-semibold tracking-tight min-w-[180px]">{heading}</div>
          <button onClick={() => shift(1)} className="p-1.5 rounded border border-bg-border hover:bg-bg-hover">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex gap-2">
          {trades.length > 0 && (
            <button
              onClick={jumpToLatestTrade}
              className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded"
            >
              Latest trades
            </button>
          )}
          <button
            onClick={jumpToToday}
            className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded"
          >
            Today
          </button>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="card p-10 text-center text-sm text-text-secondary">
          No trades yet — import a CSV from the Trade Log to populate the calendar.
        </div>
      ) : view === 'month' ? (
        <MonthView year={cursor.year} month={cursor.month} byDay={byDay} onSelectDay={setSelectedDay} />
      ) : (
        <YearView year={cursor.year} byDay={byDay} onSelectDay={setSelectedDay} />
      )}

      {selectedDay && (
        <DayDrawer
          date={selectedDay}
          trades={trades}
          accountById={accountById}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}
