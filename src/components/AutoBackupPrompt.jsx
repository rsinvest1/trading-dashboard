import { useEffect, useRef, useState } from 'react';
import { Download, X, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/useStore';

// Watches the count of strategies + playbooks. When it grows (i.e. the user
// added a new one), it surfaces a non-blocking toast offering to download a
// full JSON backup — guarding against the per-browser localStorage data loss
// that bit us before. Editing existing records does not trigger it.
export default function AutoBackupPrompt() {
  const strategies = useStore(s => s.strategies);
  const playbooks  = useStore(s => s.playbooks);
  const exportData = useStore(s => s.exportData);

  const count = strategies.length + playbooks.length;
  const prev = useRef(count);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (count > prev.current) setShow(true);
    prev.current = count;
  }, [count]);

  function download() {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading-dashboard-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 card border border-accent-green/40 p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <ShieldCheck size={18} className="text-accent-green shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">New data added</div>
          <p className="text-xs text-text-secondary mt-0.5">
            Your data lives only in this browser. Download a backup so you don't lose it.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={download}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-green text-bg rounded text-xs font-medium hover:bg-accent-green-soft"
            >
              <Download size={13} /> Download backup
            </button>
            <button
              onClick={() => setShow(false)}
              className="px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
            >
              Later
            </button>
          </div>
        </div>
        <button onClick={() => setShow(false)} className="text-text-muted hover:text-text-primary shrink-0">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
