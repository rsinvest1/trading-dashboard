import { useMemo, useState } from 'react';
import { Upload, X, Check, AlertCircle, BookOpen, Image as ImageIcon } from 'lucide-react';
import { useStore } from '../store/useStore';
import { parseOneNoteMhtml } from '../utils/oneNoteParser';
import { downscaleDataUrl } from '../utils/image';
import { putImage, newImageId } from '../utils/imageStore';
import { CANONICAL_EVENT_KEYS, resolveCanonicalEventKey } from '../utils/events';

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read ' + file.name));
    reader.readAsText(file);
  });
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// Raw (pre-downscale) byte estimate of what will be written to localStorage.
function estimateBytes(drafts, includeImages) {
  let n = 0;
  for (const d of drafts) {
    if (!d.include) continue;
    n += (d.context?.length || 0) + (d.title?.length || 0);
    if (includeImages) for (const c of d.charts) n += (c.dataUrl?.length || 0);
  }
  return n;
}

export default function OneNotePlaybookImporter({ onClose }) {
  const addPlaybooks = useStore(s => s.addPlaybooks);

  const [stage, setStage] = useState('idle'); // idle | review | importing | imported
  const [drafts, setDrafts] = useState([]);   // each augmented with `include`
  const [files, setFiles] = useState([]);     // names
  const [errors, setErrors] = useState([]);
  const [notes, setNotes] = useState([]);     // info notes (e.g. didn't split)
  const [includeImages, setIncludeImages] = useState(true);
  const [bulkEventKey, setBulkEventKey] = useState('');
  const [importedCount, setImportedCount] = useState(0);

  async function handleFiles(fileList) {
    const arr = [...fileList];
    if (!arr.length) return;
    const allDrafts = [];
    const errs = [];
    const info = [];
    for (const f of arr) {
      try {
        const text = await readFileText(f);
        const { drafts: ds, meta } = parseOneNoteMhtml(text, f.name);
        if (!ds.length) {
          errs.push(`${f.name}: no playbook pages detected`);
          continue;
        }
        if (meta.splitMethod === 'single' && ds.length === 1) {
          info.push(`${f.name}: couldn't detect page breaks — imported as a single playbook. Re-export per page if you expected several.`);
        }
        allDrafts.push(...ds);
      } catch (e) {
        errs.push(e.message || String(e));
      }
    }
    setFiles(arr.map(f => f.name));
    setErrors(errs);
    setNotes(info);
    setDrafts(allDrafts.map(d => ({ ...d, include: true })));
    if (allDrafts.length) setStage('review');
  }

  function patchDraft(idx, patch) {
    setDrafts(ds => ds.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  const selected = useMemo(() => drafts.filter(d => d.include), [drafts]);
  const totalCharts = useMemo(
    () => selected.reduce((n, d) => n + d.charts.length, 0),
    [selected]
  );
  const estBytes = useMemo(
    () => estimateBytes(drafts, includeImages),
    [drafts, includeImages]
  );
  const sizeWarn = includeImages && estBytes > 3.5 * 1024 * 1024;

  function applyBulkKey() {
    const key = resolveCanonicalEventKey(bulkEventKey, '');
    if (!key) return;
    setDrafts(ds => ds.map(d => ({ ...d, event_key: key })));
  }

  async function confirmImport() {
    setStage('importing');
    // Apply bulk event key to any draft that still has none
    const fallbackKey = resolveCanonicalEventKey(bulkEventKey, '') || null;
    const out = [];
    for (const d of selected) {
      let charts = [];
      if (includeImages && d.charts.length) {
        for (const c of d.charts) {
          const dataUrl = await downscaleDataUrl(c.dataUrl, 1280, 0.7);
          const imageId = newImageId();
          await putImage(imageId, dataUrl);
          charts.push({ id: c.id, imageId, caption: c.caption || '' });
        }
      }
      out.push({
        title: (d.title || '').trim() || 'Untitled OneNote page',
        date: d.date || '',
        setup_name: '',
        event_key: resolveCanonicalEventKey(d.event_key || d.title, fallbackKey) || fallbackKey,
        instruments: d.instruments || [],
        catalysts: [],
        context: d.context || '',
        charts,
        outcome: ''
      });
    }
    addPlaybooks(out);
    setImportedCount(out.length);
    setStage('imported');
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-bg-card border border-bg-border rounded-lg w-full max-w-3xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-bg-border">
          <h2 className="font-semibold flex items-center gap-2">
            <BookOpen size={16} /> Import Releases from OneNote
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {stage === 'idle' && (
            <>
              <label className="border-2 border-dashed border-bg-border hover:border-accent-green rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors">
                <Upload size={32} className="text-text-secondary" />
                <div className="text-sm text-text-primary">Drop OneNote .mht exports or click to browse</div>
                <div className="text-xs text-text-muted text-center max-w-md">
                  In OneNote: <span className="text-text-secondary">File → Export → Section (or Notebook) → Single File Web Page (*.mht)</span>.
                  Each page becomes one Playbook (text → context, embedded charts → images). You can select several files.
                </div>
                <input
                  type="file"
                  accept=".mht,.mhtml,multipart/related,message/rfc822"
                  multiple
                  className="hidden"
                  onChange={e => e.target.files?.length && handleFiles(e.target.files)}
                />
              </label>
              {errors.length > 0 && (
                <div className="text-xs text-accent-red space-y-1">
                  {errors.slice(0, 6).map((er, i) => <div key={i}>{er}</div>)}
                </div>
              )}
            </>
          )}

          {stage === 'review' && (
            <>
              <div className="text-xs text-text-secondary">
                Parsed <span className="text-text-primary font-mono">{files.join(', ')}</span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="card p-3">
                  <div className="stat-label">Files</div>
                  <div className="text-xl font-semibold font-mono">{files.length}</div>
                </div>
                <div className="card p-3">
                  <div className="stat-label">Releases</div>
                  <div className="text-xl font-semibold font-mono text-accent-green">{selected.length}</div>
                </div>
                <div className="card p-3">
                  <div className="stat-label">Charts</div>
                  <div className="text-xl font-semibold font-mono">{includeImages ? totalCharts : 0}</div>
                </div>
                <div className="card p-3">
                  <div className="stat-label">Est. size</div>
                  <div className={`text-xl font-semibold font-mono ${sizeWarn ? 'text-accent-yellow' : 'text-text-primary'}`}>
                    {fmtMB(estBytes)}
                  </div>
                </div>
              </div>

              {notes.map((n, i) => (
                <div key={i} className="text-xs text-text-muted flex items-start gap-2 px-1">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>{n}</div>
                </div>
              ))}

              {sizeWarn && (
                <div className="text-xs text-accent-yellow flex items-start gap-2 px-1">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    This import is large. Charts are downscaled and stored in IndexedDB
                    (separate from the ~5&nbsp;MB localStorage budget), so this should be fine —
                    uncheck <strong>Include chart images</strong> only if you want text-only.
                  </div>
                </div>
              )}

              {/* Bulk controls */}
              <div className="card p-3 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                    Event key — applies to all releases in this file
                  </div>
                  <input
                    list="onenote-event-keys"
                    value={bulkEventKey}
                    onChange={e => setBulkEventKey(e.target.value)}
                    onBlur={applyBulkKey}
                    placeholder="e.g. Australia CPI  ·  US ADP Wkly Employment Change"
                    className="w-full bg-bg border border-bg-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent-green/50"
                  />
                  <p className="text-[11px] text-text-muted mt-1">
                    All releases in this file belong to one recurring event. Tab out or select from the list to apply.
                  </p>
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeImages}
                    onChange={e => setIncludeImages(e.target.checked)}
                    className="mt-0.5 accent-accent-green"
                  />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <ImageIcon size={13} /> Include chart images
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      Imports embedded screenshots as Playbook charts (downscaled). Uncheck to import text only and save space.
                    </div>
                  </div>
                </label>
              </div>

              <datalist id="onenote-event-keys">
                {CANONICAL_EVENT_KEYS.map(k => <option key={k} value={k} />)}
              </datalist>

              {/* Per-draft rows */}
              <div className="space-y-2">
                {drafts.map((d, i) => (
                  <div
                    key={d.id}
                    className={`card p-3 space-y-2 ${d.include ? '' : 'opacity-50'}`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={d.include}
                        onChange={e => patchDraft(i, { include: e.target.checked })}
                        className="mt-2 accent-accent-green shrink-0"
                      />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            value={d.title}
                            onChange={e => patchDraft(i, { title: e.target.value })}
                            placeholder="Title"
                            className="flex-1 bg-bg border border-bg-border rounded px-2 py-1 text-sm font-medium focus:outline-none focus:border-accent-green/50"
                          />
                          <input
                            type="date"
                            value={d.date || ''}
                            onChange={e => patchDraft(i, { date: e.target.value })}
                            className="bg-bg border border-bg-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-accent-green/50"
                          />
                        </div>
                        {d.event_key && (
                          <span className="inline-flex items-center px-2 py-0.5 text-[10px] rounded border border-accent-blue/30 bg-accent-blue/10 text-accent-blue font-mono">
                            {d.event_key}
                          </span>
                        )}
                        {d.context && (
                          <p className="text-[11px] text-text-secondary line-clamp-2 whitespace-pre-line">
                            {d.context}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-[10px] text-text-muted">
                          {d.charts.length > 0 && (
                            <span className="flex items-center gap-1">
                              <ImageIcon size={11} /> {d.charts.length} chart{d.charts.length === 1 ? '' : 's'}
                            </span>
                          )}
                          {d.instruments?.length > 0 && (
                            <span className="font-mono">{d.instruments.join(' · ')}</span>
                          )}
                          {d._meta?.source && <span className="truncate">{d._meta.source}</span>}
                        </div>
                      </div>
                      {includeImages && d.charts.length > 0 && (
                        <img
                          src={d.charts[0].dataUrl}
                          alt=""
                          className="w-16 h-16 object-cover rounded border border-bg-border shrink-0"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {errors.length > 0 && (
                <div className="text-xs text-accent-yellow flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>{errors.length} file warning{errors.length === 1 ? '' : 's'}: {errors.slice(0, 3).join('; ')}</div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                <button
                  onClick={confirmImport}
                  disabled={selected.length === 0}
                  className="px-4 py-2 text-sm bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {selected.length === 0
                    ? 'Select at least one'
                    : `Import ${selected.length} release${selected.length === 1 ? '' : 's'}${bulkEventKey.trim() ? ` · ${bulkEventKey.trim()}` : ''}`}
                </button>
              </div>
            </>
          )}

          {stage === 'importing' && (
            <div className="text-center py-10 space-y-3">
              <div className="text-sm text-text-secondary">Importing releases & downscaling charts…</div>
            </div>
          )}

          {stage === 'imported' && (
            <div className="text-center py-8 space-y-3">
              <div className="inline-flex p-3 bg-accent-green/10 rounded-full">
                <Check size={32} className="text-accent-green" />
              </div>
              <div className="text-lg font-semibold">
                Imported {importedCount} release{importedCount === 1 ? '' : 's'}
              </div>
              <div className="text-sm text-text-secondary">
                Added to your Playbook library — your existing playbooks and trades were left untouched.
              </div>
              <button onClick={onClose} className="mt-2 px-4 py-2 text-sm bg-accent-green text-bg rounded font-medium">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
