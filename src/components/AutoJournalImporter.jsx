import { useEffect, useState } from 'react';
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

function RecentPackageRow({ pkg, imported, importing, onImport }) {
  return (
    <div className="card p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary truncate">{pkg.releaseName}</span>
          {pkg.releaseKey && <Badge tone="blue" mono>{pkg.releaseKey}</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-text-muted mt-1">
          {pkg.releaseId && <span className="font-mono truncate">{pkg.releaseId}</span>}
          <span className="font-mono truncate">{pkg.slug}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {imported
          ? <span className="flex items-center gap-1 px-2.5 py-1 text-xs text-accent-green"><Check size={13} /> Imported</span>
          : <button
              onClick={onImport}
              disabled={importing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download size={13} /> {importing ? 'Importing' : 'Import'}
            </button>
        }
      </div>
    </div>
  );
}

export default function AutoJournalImporter({ onClose }) {
  const releaseJournals     = useStore(s => s.releaseJournals);
  const addReleaseJournal   = useStore(s => s.addReleaseJournal);
  const importReleaseJournalPackage = useStore(s => s.importReleaseJournalPackage);
  const deleteReleaseJournal = useStore(s => s.deleteReleaseJournal);

  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [recentPackages, setRecentPackages] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState('');
  const [importingPath, setImportingPath] = useState('');

  const importedIds = new Set((releaseJournals || []).map(j => j.releaseId));
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    if (!isDev) return;

    let active = true;
    async function loadRecentPackages() {
      setRecentLoading(true);
      setRecentError('');
      try {
        const res = await fetch('/api/dev/journals');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (active) setRecentPackages(Array.isArray(data) ? data : []);
      } catch (e) {
        if (active) setRecentError(e.message || 'Could not scan release journal packages');
      } finally {
        if (active) setRecentLoading(false);
      }
    }

    loadRecentPackages();
    return () => { active = false; };
  }, [isDev]);

  const recentGroups = [];
  for (const pkg of recentPackages) {
    let group = recentGroups[recentGroups.length - 1];
    if (!group || group.date !== pkg.date) {
      group = { date: pkg.date, packages: [] };
      recentGroups.push(group);
    }
    group.packages.push(pkg);
  }

  function importPayload(raw, label) {
    const list = Array.isArray(raw) ? raw : [raw];
    const stats = { imported: 0, linkedTrades: 0, createdPlaybooks: 0 };
    for (const item of list) {
      if (!item || (!item.releaseKey && !item.releaseName)) {
        setError(`${label}: not a release journal (missing releaseKey/releaseName).`);
        continue;
      }
      const result = importReleaseJournalPackage(item);
      stats.imported++;
      stats.linkedTrades += result?.linkedTrades || 0;
      if (result?.createdPlaybook) stats.createdPlaybooks++;
    }
    return stats;
  }

  function showImported(stats) {
    const n = stats?.imported || 0;
    if (!n) return;
    const extras = [
      stats.linkedTrades ? `${stats.linkedTrades} trade${stats.linkedTrades === 1 ? '' : 's'} linked` : '',
      stats.createdPlaybooks ? `${stats.createdPlaybooks} release instance${stats.createdPlaybooks === 1 ? '' : 's'} created` : '',
    ].filter(Boolean);
    setFlash(`Imported ${n} package${n === 1 ? '' : 's'}${extras.length ? ` · ${extras.join(' · ')}` : ''}`);
    setTimeout(() => setFlash(''), 3000);
  }

  async function handleFiles(fileList) {
    setError('');
    const arr = [...fileList];
    const totals = { imported: 0, linkedTrades: 0, createdPlaybooks: 0 };
    for (const f of arr) {
      try {
        const text = await readFileText(f);
        const parsed = JSON.parse(text);
        const stats = importPayload(parsed, f.name);
        totals.imported += stats.imported;
        totals.linkedTrades += stats.linkedTrades;
        totals.createdPlaybooks += stats.createdPlaybooks;
      } catch (e) {
        setError(`${f.name}: ${e.message || 'invalid JSON'}`);
      }
    }
    showImported(totals);
  }

  async function handleRecentImport(pkg) {
    setError('');
    setImportingPath(pkg.path);
    try {
      const res = await fetch(`/api/dev/journals/metadata?path=${encodeURIComponent(pkg.path)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      const stats = importPayload(parsed, pkg.releaseName || pkg.slug || pkg.path);
      showImported(stats);
    } catch (e) {
      setError(`${pkg.releaseName || pkg.slug}: ${e.message || 'could not import package'}`);
    } finally {
      setImportingPath('');
    }
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

            {isDev && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Recent packages</div>
                  {recentLoading && <div className="text-[10px] text-text-muted">Scanning...</div>}
                </div>
                {recentError && (
                  <div className="text-xs text-accent-red flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" /> <div>{recentError}</div>
                  </div>
                )}
                {!recentLoading && !recentError && recentPackages.length === 0 && (
                  <div className="text-xs text-text-muted border border-bg-border rounded p-3">
                    No release journal packages found in the last 7 days.
                  </div>
                )}
                {recentGroups.map(group => (
                  <div key={group.date} className="space-y-1.5">
                    <div className="text-[11px] text-text-secondary font-mono">{group.date}</div>
                    {group.packages.map(pkg => (
                      <RecentPackageRow
                        key={pkg.path}
                        pkg={pkg}
                        imported={pkg.releaseId && importedIds.has(pkg.releaseId)}
                        importing={importingPath === pkg.path}
                        onImport={() => handleRecentImport(pkg)}
                      />
                    ))}
                  </div>
                ))}
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
