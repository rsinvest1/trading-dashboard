import { useState } from 'react';
import { Upload, X, FileText, Eye, Trash2, Check, AlertCircle, Download } from 'lucide-react';
import { useStore } from '../store/useStore';
import { SAMPLE_RELEASE_JOURNALS } from '../utils/sampleReleaseJournals';
import { normalizeReleaseJournal, importanceTone, gradeTone } from '../utils/releaseJournalSchema';
import ReleaseReviewModal from './ReleaseReviewModal';

const TONE = {
  green:  'bg-accent-green/10 text-accent-green border-accent-green/30',
  yellow: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30',
  red:    'bg-accent-red/10 text-accent-red border-accent-red/30',
  blue:   'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
  muted:  'bg-bg-hover text-text-secondary border-bg-border'
};
const Badge = ({ tone = 'muted', children, mono = false }) => (
  <span className={`inline-flex items-center px-2 py-0.5 text-[10px] rounded border ${TONE[tone]} ${mono ? 'font-mono' : ''}`}>
    {children}
  </span>
);

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read ' + file.name));
    reader.readAsText(file);
  });
}

// One row in either the samples or imported list.
function JournalRow({ journal, imported, onView, onImport, onDelete }) {
  const grade = journal.trackedAssets?.find(a => a.role === 'PRIMARY')?.classification?.tradabilityGrade;
  return (
    <div className="card p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary truncate">{journal.releaseName}</span>
          <Badge tone={importanceTone(journal.importance)} mono>{(journal.importance || '').replace('_', '+')}</Badge>
          {grade && <Badge tone={gradeTone(grade)} mono>{grade}</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-text-muted mt-1">
          <Badge tone="blue" mono>{journal.releaseKey}</Badge>
          <span className="font-mono">{journal.trackedAssets?.length || 0} assets</span>
          <span>{(journal.headlines?.length || 0)} headlines</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onView}
          className="flex items-center gap-1 px-2.5 py-1 text-xs border border-bg-border rounded text-text-secondary hover:text-accent-green hover:border-accent-green/40"
        >
          <Eye size={13} /> View
        </button>
        {onImport && (
          imported
            ? <span className="flex items-center gap-1 px-2.5 py-1 text-xs text-accent-green"><Check size={13} /> Imported</span>
            : <button
                onClick={onImport}
                className="flex items-center gap-1 px-2.5 py-1 text-xs bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft"
              >
                <Download size={13} /> Import
              </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="Remove imported journal" className="p-1 text-text-muted hover:text-accent-red">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function AutoJournalImporter({ onClose }) {
  const releaseJournals     = useStore(s => s.releaseJournals);
  const addReleaseJournal   = useStore(s => s.addReleaseJournal);
  const deleteReleaseJournal = useStore(s => s.deleteReleaseJournal);

  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const importedIds = new Set((releaseJournals || []).map(j => j.releaseId));

  async function handleFiles(fileList) {
    setError('');
    const arr = [...fileList];
    let n = 0;
    for (const f of arr) {
      try {
        const text = await readFileText(f);
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const raw of list) {
          if (!raw || (!raw.releaseKey && !raw.releaseName)) {
            setError(`${f.name}: not a release journal (missing releaseKey/releaseName).`);
            continue;
          }
          addReleaseJournal(raw);
          n++;
        }
      } catch (e) {
        setError(`${f.name}: ${e.message || 'invalid JSON'}`);
      }
    }
    if (n) { setFlash(`Imported ${n} package${n === 1 ? '' : 's'}`); setTimeout(() => setFlash(''), 3000); }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4">
        <div className="bg-bg-card border border-bg-border rounded-lg w-full max-w-3xl max-h-[90vh] overflow-auto">
          <div className="flex items-center justify-between p-4 border-b border-bg-border sticky top-0 bg-bg-card z-10">
            <h2 className="font-semibold flex items-center gap-2">
              <FileText size={16} /> Import Auto Journal
            </h2>
            <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
              <X size={18} />
            </button>
          </div>

          <div className="p-4 space-y-5">
            <p className="text-xs text-text-secondary">
              Release Journal packages are produced by the separate Release Journal Worker
              (screenshots, market behavior, headlines, peak/MAE). Import a completed package
              to review it here. This is additive — your trades, stats, and playbooks are untouched.
            </p>

            {/* Upload */}
            <label className="border-2 border-dashed border-bg-border hover:border-accent-green rounded-lg p-5 flex flex-col items-center gap-2 cursor-pointer transition-colors">
              <Upload size={24} className="text-text-secondary" />
              <div className="text-sm text-text-primary">Drop a journal <span className="font-mono">.json</span> package or click to browse</div>
              <div className="text-[11px] text-text-muted">Accepts a single <span className="font-mono">metadata.json</span> or an array of packages.</div>
              <input
                type="file"
                accept=".json,application/json"
                multiple
                className="hidden"
                onChange={e => e.target.files?.length && handleFiles(e.target.files)}
              />
            </label>

            {error && (
              <div className="text-xs text-accent-red flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" /> <div>{error}</div>
              </div>
            )}
            {flash && (
              <div className="text-xs text-accent-green flex items-center gap-1.5">
                <Check size={14} /> {flash}
              </div>
            )}

            {/* Sample packages */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">Sample packages</div>
              {SAMPLE_RELEASE_JOURNALS.map(j => (
                <JournalRow
                  key={j.releaseId}
                  journal={j}
                  imported={importedIds.has(j.releaseId)}
                  onView={() => setViewing(j)}
                  onImport={() => addReleaseJournal(j)}
                />
              ))}
            </div>

            {/* Imported journals */}
            {releaseJournals.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">
                  Imported journals ({releaseJournals.length})
                </div>
                {[...releaseJournals]
                  .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
                  .map(j => (
                    <JournalRow
                      key={j.releaseId}
                      journal={j}
                      onView={() => setViewing(normalizeReleaseJournal(j))}
                      onDelete={() => deleteReleaseJournal(j.releaseId)}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {viewing && <ReleaseReviewModal journal={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
