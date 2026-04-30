import { useState } from 'react';
import { Plus, Eye, X, Edit2, Check } from 'lucide-react';
import { useStore } from '../store/useStore';

const STATUSES = [
  { id: 'watching',   label: 'WATCHING',   tone: 'text-orange-400 border-orange-400/40 bg-orange-400/5' },
  { id: 'resolved',   label: 'RESOLVED',   tone: 'text-accent-green border-accent-green/40 bg-accent-green/5' },
  { id: 'eliminated', label: 'ELIMINATED', tone: 'text-text-muted border-text-muted/40 bg-text-muted/5' }
];

function statusMeta(id) {
  return STATUSES.find(s => s.id === id) ?? STATUSES[0];
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function TendencyForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'watching');

  function submit() {
    if (!name.trim()) return;
    onSave({ name: name.trim(), description: description.trim(), status });
  }

  return (
    <div className="card p-4 space-y-3 border-orange-400/30">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Tendency name (e.g. NO MAN'S LAND SIZING)"
        className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm uppercase tracking-wider font-bold text-orange-400 focus:outline-none focus:border-orange-400/50"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description — what triggers it, what to watch for, examples"
        rows={3}
        className="w-full bg-bg border border-bg-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-orange-400/50 resize-none"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {STATUSES.map(s => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={`px-2 py-1 text-[10px] tracking-wider font-bold border rounded ${
                status === s.id ? s.tone : 'text-text-muted border-bg-border'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
          <button onClick={submit} className="px-3 py-1 text-xs bg-accent-green text-bg rounded font-medium">Save</button>
        </div>
      </div>
    </div>
  );
}

function TendencyCard({ tendency, onLogSighting, onEdit, onDelete }) {
  const meta = statusMeta(tendency.status);
  const seen = tendency.seen_count || 0;
  return (
    <div className="card p-4 group hover:border-orange-400/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-mono font-bold uppercase tracking-wider text-orange-400 text-base">
            {tendency.name}
          </h3>
          {tendency.description && (
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">{tendency.description}</p>
          )}
        </div>
        <div className="shrink-0 text-right space-y-1.5 text-[11px] font-mono">
          <div className="text-text-muted">
            seen <span className="text-orange-400 font-bold">{seen}x</span>
          </div>
          <div className="text-text-muted">last: <span className="text-text-secondary">{fmtDate(tendency.last_seen_date)}</span></div>
          <div>
            <span className={`inline-block px-1.5 py-0.5 text-[10px] tracking-wider font-bold border rounded ${meta.tone}`}>
              {meta.label}
            </span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onLogSighting(tendency.id)}
          className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-orange-400"
          title="Log a sighting"
        >
          <Eye size={12} /> Log sighting
        </button>
        <button
          onClick={() => onEdit(tendency.id)}
          className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary"
        >
          <Edit2 size={12} /> Edit
        </button>
        <button
          onClick={() => onDelete(tendency.id)}
          className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-accent-red ml-auto"
        >
          <X size={12} /> Delete
        </button>
      </div>
    </div>
  );
}

export default function TendenciesSection() {
  const tendencies = useStore(s => s.tendencies);
  const addTendency = useStore(s => s.addTendency);
  const updateTendency = useStore(s => s.updateTendency);
  const deleteTendency = useStore(s => s.deleteTendency);
  const logTendencySighting = useStore(s => s.logTendencySighting);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const sorted = [...tendencies].sort((a, b) => {
    const order = { watching: 0, resolved: 1, eliminated: 2 };
    return (order[a.status] ?? 0) - (order[b.status] ?? 0);
  });

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-text-secondary">
          Active Tendencies
          <span className="ml-3 text-[11px] normal-case text-text-muted font-normal">
            — you populate, Claude watches
          </span>
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
          >
            <Plus size={14} /> Add tendency
          </button>
        )}
      </div>

      <div className="space-y-2">
        {adding && (
          <TendencyForm
            onCancel={() => setAdding(false)}
            onSave={(data) => { addTendency(data); setAdding(false); }}
          />
        )}

        {sorted.map(t =>
          editingId === t.id ? (
            <TendencyForm
              key={t.id}
              initial={t}
              onCancel={() => setEditingId(null)}
              onSave={(data) => { updateTendency(t.id, data); setEditingId(null); }}
            />
          ) : (
            <TendencyCard
              key={t.id}
              tendency={t}
              onLogSighting={logTendencySighting}
              onEdit={setEditingId}
              onDelete={deleteTendency}
            />
          )
        )}

        {!adding && tendencies.length === 0 && (
          <div className="card p-6 text-center text-sm text-text-muted border-dashed">
            No tendencies tracked yet — add one to start watching for recurring patterns.
          </div>
        )}
      </div>
    </section>
  );
}
