import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Star, Calendar as CalIcon, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { fmtMoney } from '../utils/calculations';

function todayIso() { return new Date().toISOString().slice(0, 10); }

function shiftIso(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateLong(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function MoodPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => {
        const active = value && n <= value;
        return (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            className={`p-1 transition-colors ${active ? 'text-accent-yellow' : 'text-text-muted hover:text-text-secondary'}`}
            title={`${n} / 5`}
          >
            <Star size={20} fill={active ? 'currentColor' : 'none'} />
          </button>
        );
      })}
      {value && (
        <button
          onClick={() => onChange(null)}
          className="ml-2 text-[11px] text-text-muted hover:text-text-secondary"
        >
          clear
        </button>
      )}
    </div>
  );
}

function MoodBlock({ label, mood, note, onMood, onNote, hint }) {
  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm uppercase tracking-wider text-text-secondary">{label}</h3>
          {hint && <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>}
        </div>
        <MoodPicker value={mood} onChange={onMood} />
      </div>
      <textarea
        value={note ?? ''}
        onChange={e => onNote(e.target.value)}
        placeholder="Optional note — what's driving this rating?"
        rows={2}
        className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50 resize-none"
      />
    </section>
  );
}

export default function JournalPage() {
  const sessions = useStore(s => s.sessions);
  const trades = useStore(s => s.trades);
  const addSession = useStore(s => s.addSession);

  const [date, setDate] = useState(todayIso);
  const [draft, setDraft] = useState({});

  const sessionsByDate = useMemo(() => {
    const map = {};
    for (const s of sessions) map[s.date] = s;
    return map;
  }, [sessions]);

  const stored = sessionsByDate[date];

  useEffect(() => {
    setDraft(stored || {
      date,
      premarket_plan: '',
      mood_before: null,
      mood_before_note: '',
      mood_after: null,
      mood_after_note: '',
      lessons_learned: ''
    });
  }, [date, stored]);

  // Debounced autosave when draft changes
  useEffect(() => {
    if (!draft.date) return;
    const hasContent =
      (draft.premarket_plan && draft.premarket_plan.trim()) ||
      (draft.mood_before != null) || (draft.mood_after != null) ||
      (draft.mood_before_note && draft.mood_before_note.trim()) ||
      (draft.mood_after_note && draft.mood_after_note.trim()) ||
      (draft.lessons_learned && draft.lessons_learned.trim());
    if (!hasContent && !stored) return;

    const t = setTimeout(() => {
      addSession({ ...draft, updated_at: new Date().toISOString() });
    }, 600);
    return () => clearTimeout(t);
  }, [draft]);

  function patch(p) { setDraft(d => ({ ...d, ...p })); }

  const dayTrades = trades.filter(t => t.date === date);
  const dayPnl = dayTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const dayWins = dayTrades.filter(t => t.pnl > 0).length;
  const dayLosses = dayTrades.filter(t => t.pnl < 0).length;

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [sessions]
  );

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
          <p className="text-sm text-text-secondary mt-1">
            One entry per day — pre-trade notes, mood, and lessons learned. Autosaves as you type.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setDate(shiftIso(date, -1))}
          className="p-1.5 rounded border border-bg-border hover:bg-bg-hover"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-2 px-3 py-1.5 border border-bg-border rounded bg-bg-card">
          <CalIcon size={14} className="text-text-secondary" />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="bg-transparent text-sm font-mono focus:outline-none"
          />
        </div>
        <button
          onClick={() => setDate(shiftIso(date, 1))}
          className="p-1.5 rounded border border-bg-border hover:bg-bg-hover"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={() => setDate(todayIso())}
          className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded ml-2"
        >
          Today
        </button>
        {stored && <span className="ml-3 text-[11px] text-accent-green">● saved</span>}
      </div>

      <div className="card p-4 flex items-baseline justify-between gap-4">
        <div>
          <div className="font-semibold text-text-primary">{fmtDateLong(date)}</div>
          <div className="text-xs text-text-secondary mt-0.5">
            {dayTrades.length === 0
              ? 'No trades on this day.'
              : `${dayTrades.length} trade${dayTrades.length === 1 ? '' : 's'} · ${dayWins}W / ${dayLosses}L`}
          </div>
        </div>
        {dayTrades.length > 0 && (
          <div className={`text-2xl font-mono font-semibold ${dayPnl > 0 ? 'text-accent-green' : dayPnl < 0 ? 'text-accent-red' : 'text-text-secondary'}`}>
            {fmtMoney(dayPnl)}
          </div>
        )}
      </div>

      <section className="card p-4 space-y-3">
        <div>
          <h3 className="text-sm uppercase tracking-wider text-text-secondary">📝 Pre-Trade Notes (Before the Day Starts)</h3>
          <div className="text-[11px] text-text-muted mt-0.5">
            Levels, directional bias, key catalysts, and anything you want to remember before market open.
          </div>
        </div>
        <textarea
          value={draft.premarket_plan ?? ''}
          onChange={e => patch({ premarket_plan: e.target.value })}
          placeholder={
            "ES: We have supply at 5220-5216 which is also CPI high/pre-market high.\n" +
            "We already bounced from demand at 5200 going into open so the plan for today:\n" +
            "  A. Go retest the low we just created at demand for a bounce into 5220.\n" +
            "  B. Market may want to test CPI low. If we end up there I'm interested in a break and reclaim."
          }
          rows={6}
          className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50 resize-y font-mono"
        />
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MoodBlock
          label="Mood — before"
          hint="At the open, pre-trade."
          mood={draft.mood_before}
          note={draft.mood_before_note}
          onMood={v => patch({ mood_before: v })}
          onNote={v => patch({ mood_before_note: v })}
        />
        <MoodBlock
          label="Mood — after"
          hint="End of session, post-trades."
          mood={draft.mood_after}
          note={draft.mood_after_note}
          onMood={v => patch({ mood_after: v })}
          onNote={v => patch({ mood_after_note: v })}
        />
      </div>

      <section className="card p-4 space-y-3">
        <div>
          <h3 className="text-sm uppercase tracking-wider text-text-secondary">Lessons learned / what to improve</h3>
          <div className="text-[11px] text-text-muted mt-0.5">What went wrong, what you'd do differently, key takeaway.</div>
        </div>
        <textarea
          value={draft.lessons_learned ?? ''}
          onChange={e => patch({ lessons_learned: e.target.value })}
          placeholder="Sized too big on the open against a midrange level — wait for the level reclaim before sizing up."
          rows={5}
          className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50 resize-y"
        />
      </section>

      {sortedSessions.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-2">Past entries</h2>
          <div className="space-y-1">
            {sortedSessions.map(s => (
              <button
                key={s.date}
                onClick={() => setDate(s.date)}
                className={`w-full text-left card px-3 py-2 hover:border-accent-green/30 transition-colors flex items-center gap-3 ${s.date === date ? 'border-accent-green/40' : ''}`}
              >
                <span className="text-xs font-mono text-text-secondary w-32 shrink-0">{fmtDateShort(s.date)}</span>
                <span className="text-xs text-text-secondary truncate flex-1">
                  {s.premarket_plan?.slice(0, 80) || s.lessons_learned?.slice(0, 80) || <em className="text-text-muted">—</em>}
                </span>
                <span className="flex items-center gap-2 text-[11px] text-text-muted shrink-0">
                  {s.mood_before != null && <span>before {s.mood_before}/5</span>}
                  {s.mood_after  != null && <span>after {s.mood_after}/5</span>}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
