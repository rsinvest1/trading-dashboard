import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, ArrowLeft, Edit2, Trash2, X, ImagePlus, Calendar as CalIcon, Tag,
  Newspaper, BookOpen, ClipboardPaste, Upload
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { TICKERS } from '../utils/instruments';
import { fmtMoney, fmtPct, fmtR, realizedR } from '../utils/calculations';
import { EVENT_KEYS } from '../utils/events';
import OneNotePlaybookImporter from '../components/OneNotePlaybookImporter';

const uid = () => Math.random().toString(36).slice(2, 10);

const SAMPLE_PLAYBOOK = {
  title: "2-Year bond auction '26",
  date: '2026-03-24',
  time: '13:02',
  setup_name: 'Bond auction tail fade',
  instruments: ['MGC', 'GC'],
  catalysts: [
    {
      id: uid(),
      time: '13:03',
      headline: 'US 2-Year Note Bid-to-Cover',
      details: 'Actual 2.440 (Forecast –, Previous 2.630)',
      tags: ['Forex', 'US Bonds', 'US Indexes', 'USD']
    },
    {
      id: uid(),
      time: '13:02',
      headline: 'US 2-Year Note Auction',
      details: [
        'High Yield 3.936% (Tailed by 1.8 basis points)',
        'Bid-to-cover 2.44',
        'Sells $69 bln',
        'Awards 20.78% of bids at high',
        'Primary Dealers take 24.12%',
        'Direct 16.5%',
        'Indirect 59.38%'
      ].join('\n'),
      tags: ['US Bonds']
    },
    {
      id: uid(),
      time: '13:02',
      headline: 'US 2-Year Note High Yield',
      details: 'Actual 3.936% (Forecast –, Previous 3.455%)',
      tags: ['Forex', 'US Bonds', 'US Indexes', 'USD']
    },
    {
      id: uid(),
      time: '',
      headline: 'US to order 3,000 82nd Airborne soldiers to Middle East — WSJ',
      details: '',
      tags: ['Geopolitics']
    }
  ],
  context:
    'Extreme bullish day, tariffs, USD. 3-month & 6-month auction @11:30. UB already up 2 std dev ATR, +1.4%. ' +
    'Traders have taken profits on the release mini pop-up, 1-tick failure at the highs. ' +
    'Fade the failed continuation on MGC into VWAP / prior resistance band ~4,412.',
  charts: [],
  outcome: 'Sell 5 MGC limit @ 4,425.6 — risk -$200, target +$1,800.'
};

function fmtDateLong(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ChipList({ items, onRemove, color = 'blue' }) {
  const colorMap = {
    blue:   'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
    green:  'bg-accent-green/10 text-accent-green border-accent-green/30',
    yellow: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30',
    red:    'bg-accent-red/10 text-accent-red border-accent-red/30',
    muted:  'bg-bg-hover text-text-secondary border-bg-border'
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border ${colorMap[color]}`}
        >
          {item}
          {onRemove && (
            <button onClick={() => onRemove(i)} className="opacity-60 hover:opacity-100">
              <X size={10} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

const RATING_OPTIONS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'];

function RatingBadge({ rating, className = '' }) {
  if (!rating) return null;
  const tone = /^A/.test(rating)
    ? 'text-accent-green border-accent-green/30 bg-accent-green/10'
    : /^B/.test(rating)
      ? 'text-accent-yellow border-accent-yellow/30 bg-accent-yellow/10'
      : 'text-text-muted border-bg-border bg-bg-hover';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-mono rounded border ${tone} ${className}`}>
      {rating}
    </span>
  );
}

function PlaybookStats({ stats }) {
  const tone = stats.totalPnl > 0 ? 'text-accent-green' : stats.totalPnl < 0 ? 'text-accent-red' : 'text-text-muted';
  return (
    <div className="grid grid-cols-4 gap-2 text-[11px] font-mono mb-3">
      <div>
        <div className="text-text-muted text-[10px] uppercase tracking-wider">Trades</div>
        <div className="text-text-primary">{stats.count}</div>
      </div>
      <div>
        <div className="text-text-muted text-[10px] uppercase tracking-wider">Win rate</div>
        <div className="text-text-primary">{stats.count ? fmtPct(stats.winRate) : '—'}</div>
      </div>
      <div>
        <div className="text-text-muted text-[10px] uppercase tracking-wider">Net P&L</div>
        <div className={tone}>{fmtMoney(stats.totalPnl)}</div>
      </div>
      <div>
        <div className="text-text-muted text-[10px] uppercase tracking-wider">Avg R</div>
        <div className="text-text-primary">{fmtR(stats.avgR)}</div>
      </div>
    </div>
  );
}

function PlaybookCard({ playbook, stats, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card p-4 text-left hover:border-accent-green/40 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-text-primary group-hover:text-accent-green transition-colors">
          {playbook.title || 'Untitled'}
        </h3>
        <span className="text-xs text-text-muted font-mono shrink-0">
          {fmtDateShort(playbook.date)}
        </span>
      </div>
      {playbook.setup_name && (
        <div className="text-xs text-accent-yellow mb-2">{playbook.setup_name}</div>
      )}
      {playbook.context && (
        <p className="text-xs text-text-secondary line-clamp-2 mb-3">
          {playbook.context}
        </p>
      )}
      {stats && <PlaybookStats stats={stats} />}
      <div className="flex items-center gap-3 text-[11px] text-text-muted">
        {playbook.instruments?.length > 0 && (
          <span className="font-mono">{playbook.instruments.join(' · ')}</span>
        )}
        <span>{playbook.catalysts?.length || 0} catalyst{playbook.catalysts?.length === 1 ? '' : 's'}</span>
        <span>{playbook.charts?.length || 0} chart{playbook.charts?.length === 1 ? '' : 's'}</span>
      </div>
    </button>
  );
}

function EventCard({ eventKey, rating, releases, onClick }) {
  const newest = releases[0];
  const instruments = [...new Set(releases.flatMap(r => r.instruments || []))];
  return (
    <button
      onClick={onClick}
      className="card p-4 text-left hover:border-accent-green/40 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-text-primary group-hover:text-accent-green transition-colors leading-snug">
          {eventKey}
        </h3>
        <RatingBadge rating={rating} className="shrink-0 mt-0.5" />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-text-muted flex-wrap">
        {instruments.length > 0 && (
          <span className="font-mono">{instruments.join(' · ')}</span>
        )}
        <span>{releases.length} release{releases.length === 1 ? '' : 's'}</span>
        {newest && (
          <span className="ml-auto font-mono">{fmtDateShort(newest.date)}</span>
        )}
      </div>
    </button>
  );
}

function EventDetail({ eventKey, releases, eventMeta, onBack, onAddRelease, onOpenRelease, onRatingChange, onNextNotesChange }) {
  const [editingRating, setEditingRating] = useState(false);
  const [ratingDraft, setRatingDraft] = useState(eventMeta?.rating || '');
  const [nextNotes, setNextNotes] = useState(eventMeta?.nextReleaseNotes || '');

  function saveRating() {
    onRatingChange(ratingDraft.trim() || null);
    setEditingRating(false);
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft size={14} /> All playbooks
        </button>
        <button
          onClick={onAddRelease}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft"
        >
          <Plus size={12} /> Add release
        </button>
      </div>

      <header>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h1 className="text-2xl font-semibold tracking-tight">{eventKey}</h1>
          {editingRating ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={ratingDraft}
                onChange={e => setRatingDraft(e.target.value)}
                onBlur={saveRating}
                onKeyDown={e => { if (e.key === 'Enter') saveRating(); if (e.key === 'Escape') setEditingRating(false); }}
                list="rating-options-event"
                placeholder="A+, A-, B+…"
                className="bg-bg border border-accent-green/50 rounded px-2 py-0.5 text-xs font-mono w-20 focus:outline-none"
              />
              <datalist id="rating-options-event">
                {RATING_OPTIONS.map(r => <option key={r} value={r} />)}
              </datalist>
            </div>
          ) : (
            <button
              onClick={() => { setRatingDraft(eventMeta?.rating || ''); setEditingRating(true); }}
              className="flex items-center gap-1.5 group/rating"
            >
              {eventMeta?.rating
                ? <RatingBadge rating={eventMeta.rating} />
                : <span className="text-xs text-text-muted border border-dashed border-bg-border rounded px-2 py-0.5">+ rating</span>
              }
              <Edit2 size={11} className="text-text-muted opacity-0 group-hover/rating:opacity-100 transition-opacity" />
            </button>
          )}
        </div>
        <p className="text-sm text-text-muted">
          {releases.length} release{releases.length === 1 ? '' : 's'} logged
        </p>
      </header>

      <div className="space-y-2">
        {releases.length === 0 ? (
          <div className="card p-6 text-center text-sm text-text-muted">
            No releases yet. Click "Add release" to log the first one.
          </div>
        ) : (
          releases.map(p => (
            <button
              key={p.id}
              onClick={() => onOpenRelease(p.id)}
              className="card p-4 w-full text-left hover:border-accent-green/40 transition-colors group"
            >
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-text-primary group-hover:text-accent-green transition-colors">
                    {fmtDateShort(p.date)}{p.time ? ` · ${p.time}` : ''}
                  </span>
                  {p.instruments?.length > 0 && (
                    <span className="text-[11px] text-text-muted font-mono">{p.instruments.join(' · ')}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-text-muted shrink-0">
                  {p.charts?.length > 0 && (
                    <span>{p.charts.length} chart{p.charts.length === 1 ? '' : 's'}</span>
                  )}
                  {p.outcome && <span className="text-accent-green">✓ outcome</span>}
                </div>
              </div>
              {p.catalysts?.length > 0 && (
                <div className="text-xs text-text-secondary mb-1.5 leading-relaxed">
                  {p.catalysts.map(c => c.headline).filter(Boolean).join(' · ')}
                </div>
              )}
              {p.context && (
                <p className="text-xs text-text-muted line-clamp-2">{p.context}</p>
              )}
            </button>
          ))
        )}
      </div>

      <section className="pt-2">
        <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-2">
          Settings for next release
        </h2>
        <textarea
          value={nextNotes}
          onChange={e => setNextNotes(e.target.value)}
          onBlur={() => onNextNotesChange(nextNotes)}
          placeholder="Pre-trade setup, bias, levels, instruments to watch for the next occurrence of this event…"
          rows={5}
          className="w-full bg-bg-card border border-bg-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-green/50 resize-y"
        />
      </section>
    </div>
  );
}

function PlaybookDetail({ playbook, stats, backLabel, onBack, onEdit, onDelete }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft size={14} /> {backLabel || 'All playbooks'}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-bg-border rounded"
          >
            <Edit2 size={12} /> Edit
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-text-secondary hover:text-accent-red border border-bg-border rounded"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{playbook.title}</h1>
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <CalIcon size={14} />
            {fmtDateLong(playbook.date)}{playbook.time ? `  ·  ${playbook.time}` : ''}
          </span>
          {playbook.setup_name && (
            <>
              <span className="text-text-muted">·</span>
              <span className="text-accent-yellow">{playbook.setup_name}</span>
            </>
          )}
          {playbook.event_key && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-accent-blue/30 bg-accent-blue/10 text-accent-blue font-mono">
              {playbook.event_key}
            </span>
          )}
        </div>
        {playbook.instruments?.length > 0 && (
          <ChipList items={playbook.instruments} color="green" />
        )}
      </header>

      {stats && (
        <section className="card p-4">
          <PlaybookStats stats={stats} />
          <p className="text-[11px] text-text-muted -mt-1">
            Performance of trades linked to this playbook (set via the Playbook column / trade drawer).
          </p>
        </section>
      )}

      {playbook.catalysts?.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary mb-3">
            <Newspaper size={14} /> Catalysts
          </h2>
          <div className="space-y-2">
            {playbook.catalysts.map(c => (
              <div key={c.id} className="card p-3">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <div className="font-medium text-text-primary">{c.headline}</div>
                  {c.time && <span className="text-xs font-mono text-text-muted shrink-0">{c.time}</span>}
                </div>
                {c.details && (
                  <div className="text-sm text-text-secondary whitespace-pre-line">{c.details}</div>
                )}
                {c.tags?.length > 0 && (
                  <div className="mt-2">
                    <ChipList items={c.tags} color="blue" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {playbook.context && (
        <section>
          <h2 className="flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary mb-3">
            <BookOpen size={14} /> Context
          </h2>
          <div className="card p-4 text-sm text-text-primary whitespace-pre-line leading-relaxed">
            {playbook.context}
          </div>
        </section>
      )}

      {playbook.charts?.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-3">
            Charts ({playbook.charts.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {playbook.charts.map(c => (
              <div key={c.id} className="card p-2">
                <img src={c.dataUrl} alt={c.caption || ''} className="w-full rounded" />
                {c.caption && (
                  <div className="text-xs text-text-secondary mt-2 px-1">{c.caption}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {playbook.outcome && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-text-secondary mb-3">
            Trade / Outcome
          </h2>
          <div className="card p-4 text-sm text-text-primary whitespace-pre-line">
            {playbook.outcome}
          </div>
        </section>
      )}
    </div>
  );
}

function CatalystRow({ catalyst, onChange, onRemove }) {
  function patch(p) { onChange({ ...catalyst, ...p }); }
  return (
    <div className="card p-3 space-y-2">
      <div className="flex gap-2">
        <input
          value={catalyst.time}
          onChange={e => patch({ time: e.target.value })}
          placeholder="13:02"
          className="bg-bg border border-bg-border rounded px-2 py-1 text-xs font-mono w-20 focus:outline-none focus:border-accent-green/50"
        />
        <input
          value={catalyst.headline}
          onChange={e => patch({ headline: e.target.value })}
          placeholder="Headline (e.g. US 2-Year Note Auction)"
          className="bg-bg border border-bg-border rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:border-accent-green/50"
        />
        <button onClick={onRemove} className="text-text-muted hover:text-accent-red px-2">
          <X size={14} />
        </button>
      </div>
      <textarea
        value={catalyst.details}
        onChange={e => patch({ details: e.target.value })}
        placeholder="Details — bullets or key numbers (one per line)"
        rows={2}
        className="bg-bg border border-bg-border rounded px-2 py-1 text-xs w-full focus:outline-none focus:border-accent-green/50 resize-none"
      />
      <input
        value={(catalyst.tags || []).join(', ')}
        onChange={e => patch({ tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
        placeholder="Tags (comma-separated): Forex, US Bonds, USD"
        className="bg-bg border border-bg-border rounded px-2 py-1 text-xs w-full focus:outline-none focus:border-accent-green/50"
      />
    </div>
  );
}

async function fileToDataUrl(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale === 1) return resolve(reader.result);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ChartUploader({ charts, onChange }) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [hint, setHint] = useState('');
  // Keep the latest charts available inside listeners bound once on mount.
  const chartsRef = useRef(charts);
  chartsRef.current = charts;

  function flash(msg) {
    setHint(msg);
    setTimeout(() => setHint(''), 2500);
  }

  async function addFiles(files) {
    const imgs = [...files].filter(f => f && f.type?.startsWith('image/'));
    if (!imgs.length) return 0;
    const next = [...chartsRef.current];
    for (const f of imgs) {
      try {
        const dataUrl = await fileToDataUrl(f);
        next.push({ id: uid(), dataUrl, caption: '' });
      } catch (e) { /* skip */ }
    }
    onChange(next);
    return imgs.length;
  }

  // Global paste — works anywhere on the page while the form is open, so you
  // can capture with the Windows Snipping Tool and just press Ctrl+V (no need
  // to click into the box first). Text pastes are ignored so other inputs work.
  useEffect(() => {
    async function onPaste(e) {
      const files = [...(e.clipboardData?.items || [])]
        .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
        .map(it => it.getAsFile())
        .filter(Boolean);
      if (files.length) {
        e.preventDefault();
        const n = await addFiles(files);
        if (n) flash(`Pasted ${n} chart${n === 1 ? '' : 's'}`);
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // Button-driven paste via the async Clipboard API (Chrome over HTTPS/localhost).
  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          files.push(new File([blob], `snip-${Date.now()}.png`, { type }));
        }
      }
      if (files.length) {
        const n = await addFiles(files);
        flash(`Pasted ${n} chart${n === 1 ? '' : 's'}`);
      } else {
        flash('No image on the clipboard — snip first, then paste');
      }
    } catch (err) {
      flash('Clipboard blocked by browser — press Ctrl+V instead');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) { addFiles(files).then(n => n && flash(`Added ${n} chart${n === 1 ? '' : 's'}`)); return; }
    // Fallback: image dragged as a data-transfer item (some apps don't expose .files)
    const items = [...(e.dataTransfer?.items || [])]
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
      .map(it => it.getAsFile())
      .filter(Boolean);
    if (items.length) addFiles(items).then(n => n && flash(`Added ${n} chart${n === 1 ? '' : 's'}`));
  }

  return (
    <div>
      <div
        tabIndex={0}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors focus:outline-none ${
          dragOver
            ? 'border-accent-green bg-accent-green/10'
            : 'border-bg-border hover:border-accent-green/50 focus:border-accent-green/50'
        }`}
      >
        <ImagePlus size={20} className="mx-auto text-text-secondary mb-1" />
        <div className="text-xs text-text-secondary">
          {dragOver
            ? 'Drop to add chart'
            : 'Snip with the Windows Snipping Tool, then press Ctrl+V — or drop / click to browse'}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => addFiles([...e.target.files])}
        />
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-bg-border rounded text-text-secondary hover:text-accent-green hover:border-accent-green/40 transition-colors"
        >
          <ClipboardPaste size={13} /> Paste from clipboard
        </button>
        {hint && <span className="text-xs text-accent-green">{hint}</span>}
      </div>
      {charts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
          {charts.map((c, i) => (
            <div key={c.id} className="relative group">
              <img src={c.dataUrl} alt="" className="w-full h-24 object-cover rounded border border-bg-border" />
              <input
                value={c.caption}
                onChange={e => {
                  const next = [...charts];
                  next[i] = { ...c, caption: e.target.value };
                  onChange(next);
                }}
                placeholder="Caption…"
                className="w-full mt-1 bg-bg border border-bg-border rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-accent-green/50"
              />
              <button
                onClick={() => onChange(charts.filter(x => x.id !== c.id))}
                className="absolute top-1 right-1 bg-bg/80 text-accent-red opacity-0 group-hover:opacity-100 rounded p-0.5"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaybookForm({ initial, onCancel, onSave }) {
  const playbookEventMeta = useStore(s => s.playbookEventMeta);
  const setEventMeta      = useStore(s => s.setEventMeta);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate]   = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime]   = useState(initial?.time ?? '');
  const [setupName, setSetupName] = useState(initial?.setup_name ?? '');
  const [eventKey, setEventKey] = useState(initial?.event_key ?? '');
  const [rating, setRating] = useState(() => {
    const k = initial?.event_key?.trim();
    return k ? (playbookEventMeta[k]?.rating || '') : '';
  });
  const [instruments, setInstruments] = useState(initial?.instruments ?? []);
  const [catalysts, setCatalysts] = useState(initial?.catalysts ?? []);
  const [context, setContext] = useState(initial?.context ?? '');
  const [outcome, setOutcome] = useState(initial?.outcome ?? '');
  const [charts, setCharts]   = useState(initial?.charts ?? []);

  // When the user types a new event key, pull in the stored rating for that event
  useEffect(() => {
    const k = eventKey.trim();
    if (k) setRating(playbookEventMeta[k]?.rating || '');
  }, [eventKey]); // intentionally omit playbookEventMeta — only fire on key change

  function addCatalyst() {
    setCatalysts([...catalysts, { id: uid(), time: '', headline: '', details: '', tags: [] }]);
  }
  function updateCatalyst(idx, val) {
    const next = [...catalysts]; next[idx] = val; setCatalysts(next);
  }
  function removeCatalyst(idx) {
    setCatalysts(catalysts.filter((_, i) => i !== idx));
  }

  function toggleInstrument(t) {
    setInstruments(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function submit() {
    if (!title.trim()) return;
    const ek = eventKey.trim() || null;
    if (ek && rating.trim()) setEventMeta(ek, { rating: rating.trim() });
    onSave({
      title: title.trim(), date, time, setup_name: setupName.trim(),
      event_key: ek,
      instruments, catalysts, context: context.trim(), outcome: outcome.trim(), charts
    });
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{initial?.id ? 'Edit release' : 'New release'}</h2>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="px-3 py-1.5 text-xs bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft disabled:opacity-40"
          >
            Save release
          </button>
        </div>
      </div>

      <section className="card p-4 space-y-3">
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title — e.g. 2-Year bond auction '26"
          className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-lg font-semibold focus:outline-none focus:border-accent-green/50"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="bg-bg border border-bg-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-green/50"
          />
          <input
            value={time}
            onChange={e => setTime(e.target.value)}
            placeholder="HH:MM"
            className="bg-bg border border-bg-border rounded px-3 py-2 text-sm font-mono w-24 focus:outline-none focus:border-accent-green/50"
          />
          <input
            value={setupName}
            onChange={e => setSetupName(e.target.value)}
            placeholder="Setup name (optional) — e.g. Bond auction tail fade"
            className="flex-1 bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
          />
        </div>
        <div>
          <div className="flex gap-2">
            <input
              list="event-key-options"
              value={eventKey}
              onChange={e => setEventKey(e.target.value)}
              placeholder="Event key — match financialjuice headline exactly, e.g. US ADP Wkly Employment Change"
              className="flex-1 bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
            />
            {eventKey.trim() && (
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  list="rating-options-form"
                  value={rating}
                  onChange={e => setRating(e.target.value)}
                  placeholder="Rating"
                  className="bg-bg border border-bg-border rounded px-2 py-2 text-sm font-mono w-24 focus:outline-none focus:border-accent-green/50"
                />
                <datalist id="rating-options-form">
                  {RATING_OPTIONS.map(r => <option key={r} value={r} />)}
                </datalist>
              </div>
            )}
          </div>
          <datalist id="event-key-options">
            {EVENT_KEYS.map(k => <option key={k} value={k} />)}
          </datalist>
          <p className="text-[11px] text-text-muted mt-1">
            Match the exact financialjuice.com headline. Rating (A+, A-, B+…) is shared across all releases for this event.
          </p>
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-1.5 text-sm uppercase tracking-wider text-text-secondary mb-2">
          <Tag size={14} /> Instruments
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {TICKERS.map(t => (
            <button
              key={t}
              onClick={() => toggleInstrument(t)}
              className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
                instruments.includes(t)
                  ? 'bg-accent-green/20 text-accent-green border-accent-green/40'
                  : 'bg-bg-card text-text-secondary border-bg-border hover:border-text-secondary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1.5 text-sm uppercase tracking-wider text-text-secondary">
            <Newspaper size={14} /> Catalysts
          </h3>
          <button onClick={addCatalyst} className="flex items-center gap-1 text-xs text-accent-green hover:text-accent-green-soft">
            <Plus size={12} /> Add
          </button>
        </div>
        <div className="space-y-2">
          {catalysts.length === 0 && (
            <div className="text-xs text-text-muted italic">No catalysts yet. Add the news / releases that drove this setup.</div>
          )}
          {catalysts.map((c, i) => (
            <CatalystRow
              key={c.id}
              catalyst={c}
              onChange={v => updateCatalyst(i, v)}
              onRemove={() => removeCatalyst(i)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-1.5 text-sm uppercase tracking-wider text-text-secondary mb-2">
          <BookOpen size={14} /> Context
        </h3>
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          placeholder="Market state, why this setup, levels, risk — anything that matters for next time."
          rows={5}
          className="w-full bg-bg-card border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50 resize-y"
        />
      </section>

      <section>
        <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-2">Charts</h3>
        <ChartUploader charts={charts} onChange={setCharts} />
      </section>

      <section>
        <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-2">Trade / Outcome (optional)</h3>
        <textarea
          value={outcome}
          onChange={e => setOutcome(e.target.value)}
          placeholder="What you took, P&L, what to do differently next time."
          rows={3}
          className="w-full bg-bg-card border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50 resize-y"
        />
      </section>
    </div>
  );
}

const EMPTY_STATS = { count: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgR: null };

export default function PlaybookPage() {
  const playbooks          = useStore(s => s.playbooks);
  const trades             = useStore(s => s.trades);
  const playbookEventMeta  = useStore(s => s.playbookEventMeta);
  const setEventMeta       = useStore(s => s.setEventMeta);
  const addPlaybook        = useStore(s => s.addPlaybook);
  const updatePlaybook     = useStore(s => s.updatePlaybook);
  const deletePlaybook     = useStore(s => s.deletePlaybook);

  // Per-playbook performance from trades linked via playbook_id.
  const stats = useMemo(() => {
    const out = {};
    for (const p of playbooks) {
      const ts = trades.filter(t => t.playbook_id === p.id);
      const wins = ts.filter(t => t.pnl > 0).length;
      const losses = ts.filter(t => t.pnl < 0).length;
      const totalPnl = ts.reduce((acc, t) => acc + (Number(t.pnl) || 0), 0);
      const rs = ts.map(realizedR).filter(r => r != null);
      const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
      out[p.id] = {
        count: ts.length, wins, losses,
        winRate: (wins + losses) ? (wins / (wins + losses)) * 100 : 0,
        totalPnl, avgR
      };
    }
    return out;
  }, [playbooks, trades]);

  const [view, setView]           = useState('list'); // list | event | detail | form
  const [activeId, setActive]     = useState(null);
  const [activeEventKey, setActiveEventKey] = useState(null);
  const [editing, setEditing]     = useState(null);
  const [filter, setFilter]       = useState('');
  const [showImporter, setShowImporter] = useState(false);

  const sorted = useMemo(
    () => [...playbooks].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [playbooks]
  );

  // Group sorted playbooks: keyed (by event_key) and ungrouped (no event_key).
  // Apply filter at the group level — a group is included if its key matches OR
  // any of its releases match.
  const { groups, ungrouped } = useMemo(() => {
    const q = filter.toLowerCase().trim();
    const keyed = {};
    const ung = [];
    for (const p of sorted) {
      const matches = !q ||
        (p.event_key || '').toLowerCase().includes(q) ||
        (p.title || '').toLowerCase().includes(q) ||
        (p.setup_name || '').toLowerCase().includes(q) ||
        (p.instruments || []).some(i => i.toLowerCase().includes(q)) ||
        (p.context || '').toLowerCase().includes(q);
      if (!matches) continue;
      if (p.event_key) {
        if (!keyed[p.event_key]) keyed[p.event_key] = [];
        keyed[p.event_key].push(p);
      } else {
        ung.push(p);
      }
    }
    return { groups: keyed, ungrouped: ung };
  }, [sorted, filter]);

  const active = playbooks.find(p => p.id === activeId);
  const activeReleases = activeEventKey
    ? sorted.filter(p => p.event_key === activeEventKey)
    : [];

  function openEventDetail(key) {
    setActiveEventKey(key);
    setView('event');
  }

  function openDetail(id, fromEventKey = null) {
    setActive(id);
    if (fromEventKey !== null) setActiveEventKey(fromEventKey);
    setView('detail');
  }

  function openNew() { setEditing(null); setView('form'); }

  function openNewRelease(prefillEventKey) {
    setEditing({ event_key: prefillEventKey });
    setView('form');
  }

  function openEdit() { setEditing(active); setView('form'); }

  function handleSave(data) {
    if (editing?.id) {
      updatePlaybook(editing.id, data);
      if (activeEventKey) {
        setView('event');
      } else {
        setActive(editing.id); // re-assert so active resolves after save
        setView('detail');
      }
    } else {
      addPlaybook({ ...data });
      const ek = data.event_key || activeEventKey;
      if (ek) {
        setActiveEventKey(ek);
        setView('event');
      } else {
        setView('list');
      }
    }
  }

  function handleDelete() {
    if (!active) return;
    if (!confirm(`Delete this release?`)) return;
    deletePlaybook(active.id);
    setActive(null);
    setView(activeEventKey ? 'event' : 'list');
  }

  function seedSample() { addPlaybook(SAMPLE_PLAYBOOK); }

  // ── Form view ────────────────────────────────────────────────────────────
  if (view === 'form') {
    function cancelReturn() {
      if (editing?.id) return setView(activeEventKey ? 'event' : 'detail');
      return setView(activeEventKey ? 'event' : 'list');
    }
    return (
      <div className="p-6">
        <PlaybookForm
          key={editing?.id ?? 'new'}
          initial={editing}
          onCancel={cancelReturn}
          onSave={handleSave}
        />
      </div>
    );
  }

  // ── Release detail view ──────────────────────────────────────────────────
  if (view === 'detail' && active) {
    return (
      <div className="p-6">
        <PlaybookDetail
          playbook={active}
          stats={stats[active.id] || EMPTY_STATS}
          backLabel={activeEventKey ? activeEventKey : 'All playbooks'}
          onBack={() => activeEventKey ? setView('event') : setView('list')}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </div>
    );
  }

  // ── Event detail view ────────────────────────────────────────────────────
  if (view === 'event' && activeEventKey) {
    return (
      <div className="p-6">
        <EventDetail
          eventKey={activeEventKey}
          releases={activeReleases}
          eventMeta={playbookEventMeta[activeEventKey]}
          onBack={() => setView('list')}
          onAddRelease={() => openNewRelease(activeEventKey)}
          onOpenRelease={id => openDetail(id, activeEventKey)}
          onRatingChange={r => setEventMeta(activeEventKey, { rating: r })}
          onNextNotesChange={notes => setEventMeta(activeEventKey, { nextReleaseNotes: notes })}
        />
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  const hasAny = playbooks.length > 0;
  const groupEntries = Object.entries(groups);
  const totalVisible = groupEntries.length + ungrouped.length;

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Playbook</h1>
          <p className="text-sm text-text-secondary mt-1">
            Events grouped by release key. Click an event to see its release history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImporter(true)}
            className="flex items-center gap-1 px-3 py-2 text-sm border border-bg-border text-text-secondary hover:text-text-primary rounded"
          >
            <Upload size={14} /> Import from OneNote
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft"
          >
            <Plus size={14} /> New release
          </button>
        </div>
      </div>

      {showImporter && <OneNotePlaybookImporter onClose={() => setShowImporter(false)} />}

      {hasAny && (
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by event key, instrument, or context…"
          className="w-full max-w-md bg-bg-card border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50"
        />
      )}

      {!hasAny ? (
        <div className="card p-10 text-center space-y-3">
          <div className="text-text-secondary">No playbooks yet.</div>
          <div className="flex gap-2 justify-center flex-wrap">
            <button
              onClick={openNew}
              className="px-4 py-2 text-sm bg-accent-green text-bg rounded font-medium"
            >
              + Create your first release
            </button>
            <button
              onClick={() => setShowImporter(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-bg-border text-text-secondary hover:text-text-primary rounded"
            >
              <Upload size={14} /> Import from OneNote
            </button>
            <button
              onClick={seedSample}
              className="px-4 py-2 text-sm border border-bg-border text-text-secondary hover:text-text-primary rounded"
            >
              Seed bond-auction sample
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Grouped event cards */}
          {groupEntries.length > 0 && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {groupEntries.map(([key, releases]) => (
                  <EventCard
                    key={key}
                    eventKey={key}
                    rating={playbookEventMeta[key]?.rating}
                    releases={releases}
                    onClick={() => openEventDetail(key)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ungrouped (no event_key) — legacy/flat style */}
          {ungrouped.length > 0 && (
            <div>
              {groupEntries.length > 0 && (
                <h2 className="text-xs uppercase tracking-wider text-text-muted mb-3">
                  Uncategorized (no event key)
                </h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {ungrouped.map(p => (
                  <PlaybookCard
                    key={p.id}
                    playbook={p}
                    stats={stats[p.id] || EMPTY_STATS}
                    onClick={() => { setActiveEventKey(null); openDetail(p.id, null); }}
                  />
                ))}
              </div>
            </div>
          )}

          {totalVisible === 0 && filter && (
            <div className="text-sm text-text-muted">No playbooks match that filter.</div>
          )}
        </div>
      )}
    </div>
  );
}
