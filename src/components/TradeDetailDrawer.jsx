import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Star, ImagePlus, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useImage, putImage, deleteImage, newImageId } from '../utils/imageStore';
import { fmtMoney, fmtDuration } from '../utils/calculations';
import TpSlEditor from './TpSlEditor';
import TagPicker from './TagPicker';
import RulesChecklist from './RulesChecklist';

function StarRating({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => {
        const active = value && n <= value;
        return (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            className={`p-0.5 transition-colors ${active ? 'text-accent-yellow' : 'text-text-muted hover:text-text-secondary'}`}
            title={`${n} / 5`}
          >
            <Star size={16} fill={active ? 'currentColor' : 'none'} />
          </button>
        );
      })}
      {value && (
        <button
          onClick={() => onChange(null)}
          className="ml-1 text-[10px] text-text-muted hover:text-text-secondary"
        >
          clear
        </button>
      )}
    </div>
  );
}

async function fileToDataUrl(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.max(1, Math.round(img.width  * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// `value` is an image id (→ IndexedDB); `onChange(imageId | null)`.
function ScreenshotSlot({ value, onChange }) {
  const fileRef = useRef(null);
  const url = useImage(value);
  async function pick(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await fileToDataUrl(file);
    const imageId = newImageId();
    await putImage(imageId, dataUrl);
    onChange(imageId);
  }
  if (value) {
    return (
      <div className="relative group">
        <img src={url || undefined} alt="screenshot" className="w-full rounded border border-bg-border" />
        <button
          onClick={() => { deleteImage(value); onChange(null); }}
          className="absolute top-2 right-2 p-1.5 bg-black/60 text-text-secondary hover:text-accent-red rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove"
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  }
  return (
    <div
      onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
      onDragOver={e => e.preventDefault()}
      onClick={() => fileRef.current?.click()}
      className="border-2 border-dashed border-bg-border hover:border-accent-green/50 rounded-lg p-4 text-center cursor-pointer transition-colors"
    >
      <ImagePlus size={18} className="mx-auto text-text-secondary mb-1" />
      <div className="text-[11px] text-text-muted">Drop, paste, or click to add a chart screenshot</div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => pick(e.target.files?.[0])}
      />
    </div>
  );
}

function Section({ title, children, right }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-text-secondary font-semibold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function playbookLabel(p) {
  const parts = [];
  if (p.event_key) parts.push(p.event_key);
  const instance = [p.date, p.time].filter(Boolean).join(' ');
  if (instance) parts.push(instance);
  parts.push(p.title || p.setup_name || 'Untitled release');
  return parts.filter(Boolean).join(' - ');
}

export default function TradeDetailDrawer({ tradeId, onClose }) {
  const trade   = useStore(s => s.trades.find(t => t.id === tradeId)) || null;
  const accounts = useStore(s => s.accounts);
  const playbooks = useStore(s => s.playbooks);
  const updateTrade = useStore(s => s.updateTrade);
  const deleteTrade = useStore(s => s.deleteTrade);

  // Local notes draft so typing doesn't re-render every other component on every keystroke
  const [notesDraft, setNotesDraft] = useState('');
  useEffect(() => { setNotesDraft(trade?.notes ?? ''); }, [trade?.id]);

  // ESC to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!trade) return null;

  const account = accounts.find(a => a.id === trade.account_id);
  const u = (patch) => updateTrade(trade.id, patch);

  function commitNotes() {
    const next = notesDraft.trim() || null;
    if (next !== (trade.notes ?? null)) u({ notes: next });
  }

  function handleDelete() {
    if (confirm(`Delete trade ${trade.ticker} ${trade.date} ${trade.time}?`)) {
      deleteTrade(trade.id);
      onClose();
    }
  }

  const pnlTone = trade.pnl > 0 ? 'text-accent-green' : trade.pnl < 0 ? 'text-accent-red' : 'text-text-muted';
  const sideTone = trade.side === 'Long' ? 'text-accent-green' : 'text-accent-red';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-md bg-bg-card border-l border-bg-border h-full overflow-y-auto shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-bg-card border-b border-bg-border px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-sm font-semibold">{trade.ticker}</span>
            <span className="text-[11px] text-text-muted truncate">{trade.symbol}</span>
            <span className={`text-xs font-medium ${sideTone}`}>{trade.side}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              className="p-1.5 text-text-muted hover:text-accent-red rounded"
              title="Delete trade"
            >
              <Trash2 size={14} />
            </button>
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-4 py-4 space-y-5">
          {/* Quick facts */}
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="card p-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Date</div>
              <div className="text-text-primary">{trade.date}</div>
              <div className="text-text-muted text-[10px]">{trade.time}</div>
            </div>
            <div className="card p-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Qty / Entry / Exit</div>
              <div className="text-text-primary">{trade.contracts} @ {trade.entry ?? '—'}</div>
              <div className="text-text-muted">→ {trade.exit ?? 'open'}</div>
            </div>
            <div className="card p-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Net P&L</div>
              <div className={`font-semibold ${pnlTone}`}>{fmtMoney(trade.pnl)}</div>
              <div className="text-text-muted text-[10px]">{trade.fees != null ? `fees ${fmtMoney(-trade.fees)}` : ''}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
            <span>Account: <span className="text-text-secondary">{account?.firm_name ?? '—'}</span></span>
            <span>Hold: <span className="text-text-secondary font-mono">{fmtDuration(trade.duration_sec)}</span></span>
          </div>

          {/* Risk & Targets */}
          <Section title="Risk & Targets">
            <TpSlEditor trade={trade} onUpdate={u} />
          </Section>

          {/* Strategy */}
          <Section title="Strategy">
            <RulesChecklist trade={trade} onUpdate={u} />
          </Section>

          {/* Tags */}
          <Section title="Tags">
            <TagPicker
              value={trade.tags || {}}
              onChange={tags => u({ tags })}
            />
          </Section>

          {/* Playbook */}
          <Section title="Playbook (date-specific)">
            <select
              value={trade.playbook_id ?? ''}
              onChange={e => u({ playbook_id: e.target.value || null })}
              className="w-full bg-bg border border-bg-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent-green/50"
            >
              <option value="">— none —</option>
              {[...playbooks]
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {playbookLabel(p)}
                  </option>
                ))}
            </select>
          </Section>

          {/* Execution rating */}
          <Section title="Execution Rating">
            <StarRating
              value={trade.execution_rating}
              onChange={v => u({ execution_rating: v })}
            />
          </Section>

          {/* Notes */}
          <Section title="Notes">
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              onBlur={commitNotes}
              placeholder="Reflections, what worked, what to improve…"
              rows={5}
              className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent-green/50 resize-y"
            />
          </Section>

          {/* Screenshot */}
          <Section title="Screenshot">
            <ScreenshotSlot
              value={trade.screenshot_id}
              onChange={v => u({ screenshot_id: v })}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
