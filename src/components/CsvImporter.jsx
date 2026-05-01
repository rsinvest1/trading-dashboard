import { useState } from 'react';
import { Upload, AlertCircle, Check, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { parseQuantowerCsv } from '../utils/csvParser';
import { aggregateFills, defaultAccountMap, tradeFingerprint } from '../utils/tradeAggregator';
import { fmtMoney } from '../utils/calculations';

export default function CsvImporter({ onClose }) {
  const accounts = useStore(s => s.accounts);
  const existingTrades = useStore(s => s.trades);
  const addTrades = useStore(s => s.addTrades);
  const ingestTrade = useStore(s => s.ingestTrade);

  const [stage, setStage] = useState('idle'); // idle | parsed | imported
  const [rawTrades, setRawTrades] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [accountMap, setAccountMap] = useState({});
  const [errors, setErrors] = useState([]);
  const [stats, setStats] = useState({ fills: 0, trades: 0, dupes: 0, fresh: 0 });
  const [filename, setFilename] = useState('');
  // Live mode: each fresh trade goes through the Behavior Engine
  // (auto-on when all fresh trades are from today)
  const [liveMode, setLiveMode] = useState(false);

  function handleFile(file) {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => parseText(e.target.result);
    reader.readAsText(file);
  }

  function parseText(text) {
    const { fills, errors: parseErrors } = parseQuantowerCsv(text);
    if (parseErrors.length && fills.length === 0) {
      setErrors(parseErrors);
      return;
    }
    const trades = aggregateFills(fills);
    const rawAccounts = [...new Set(fills.map(f => f.account))];
    const map = defaultAccountMap(rawAccounts, accounts);

    const existingFingerprints = new Set(
      existingTrades.map(t => t.fingerprint || tradeFingerprint(t))
    );
    const fresh = trades.filter(t => !existingFingerprints.has(t.fingerprint));
    const dupes = trades.filter(t =>  existingFingerprints.has(t.fingerprint));

    setRawTrades(fresh);
    setDuplicates(dupes);
    setAccountMap(map);
    setErrors(parseErrors);
    setStats({
      fills: fills.length,
      trades: trades.length,
      dupes: dupes.length,
      fresh: fresh.length
    });
    // Auto-suggest live mode if every fresh trade is from today
    const today = new Date().toISOString().slice(0, 10);
    const allToday = fresh.length > 0 && fresh.every(t => t.date === today);
    setLiveMode(allToday);
    setStage('parsed');
  }

  function confirmImport() {
    const mapped = rawTrades.map(t => {
      const { account_id_raw, ...rest } = t;
      return { ...rest, account_id: accountMap[account_id_raw] ?? null };
    });
    if (liveMode) {
      // Push each through the Behavior Engine — this triggers
      // the post-trade modal sequentially via pending_classification_id
      for (const t of mapped) ingestTrade(t);
    } else {
      addTrades(mapped);
    }
    setStage('imported');
  }

  const totalPnL = rawTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const wins   = rawTrades.filter(t => t.pnl > 0).length;
  const losses = rawTrades.filter(t => t.pnl < 0).length;
  const rawAccounts = Object.keys(accountMap);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-bg-card border border-bg-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-bg-border">
          <h2 className="font-semibold">Import Trades from CSV</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {stage === 'idle' && (
            <>
              <label className="border-2 border-dashed border-bg-border hover:border-accent-green rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors">
                <Upload size={32} className="text-text-secondary" />
                <div className="text-sm text-text-primary">Drop a Quantower / Rithmic CSV or click to browse</div>
                <div className="text-xs text-text-muted">Expected columns: Account, Date/Time, Symbol, Side, Quantity, Price, Net P/L</div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </label>
              {errors.length > 0 && (
                <div className="text-xs text-accent-red space-y-1">
                  {errors.slice(0, 5).map((er, i) => <div key={i}>{er}</div>)}
                </div>
              )}
            </>
          )}

          {stage === 'parsed' && (
            <>
              <div className="text-xs text-text-secondary">Parsed <span className="text-text-primary font-mono">{filename}</span></div>
              <div className="grid grid-cols-5 gap-2">
                <div className="card p-3">
                  <div className="stat-label">Fills</div>
                  <div className="text-xl font-semibold font-mono">{stats.fills}</div>
                </div>
                <div className="card p-3">
                  <div className="stat-label">New</div>
                  <div className="text-xl font-semibold font-mono text-accent-green">{stats.fresh}</div>
                </div>
                <div className="card p-3">
                  <div className="stat-label">Duplicates</div>
                  <div className={`text-xl font-semibold font-mono ${stats.dupes > 0 ? 'text-accent-yellow' : 'text-text-muted'}`}>
                    {stats.dupes}
                  </div>
                </div>
                <div className="card p-3">
                  <div className="stat-label">W / L (new)</div>
                  <div className="text-xl font-semibold font-mono">
                    <span className="text-accent-green">{wins}</span>
                    {' / '}
                    <span className="text-accent-red">{losses}</span>
                  </div>
                </div>
                <div className="card p-3">
                  <div className="stat-label">Net P&L (new)</div>
                  <div className={`text-xl font-semibold font-mono ${totalPnL >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {fmtMoney(totalPnL)}
                  </div>
                </div>
              </div>

              {stats.dupes > 0 && (
                <div className="text-xs text-accent-yellow flex items-start gap-2 px-1">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    Skipping <strong>{stats.dupes}</strong> trade{stats.dupes === 1 ? '' : 's'} already in your log
                    (matched by account, symbol, time, prices, qty &amp; P&amp;L). Only the {stats.fresh} new trade{stats.fresh === 1 ? '' : 's'} will be imported.
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm uppercase tracking-wider text-text-secondary mb-2">Account mapping</h3>
                <div className="space-y-2">
                  {rawAccounts.map(raw => (
                    <div key={raw} className="flex items-center gap-3 text-sm">
                      <code className="font-mono text-xs bg-bg-hover px-2 py-1 rounded text-text-primary flex-1 truncate">{raw}</code>
                      <span className="text-text-muted">→</span>
                      <select
                        value={accountMap[raw] ?? ''}
                        onChange={e => setAccountMap({ ...accountMap, [raw]: e.target.value })}
                        className="bg-bg border border-bg-border rounded px-2 py-1 text-sm flex-1"
                      >
                        <option value="">— unmapped —</option>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>{a.firm_name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {errors.length > 0 && (
                <div className="text-xs text-accent-yellow flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>{errors.length} parse warning{errors.length === 1 ? '' : 's'} — first {Math.min(3, errors.length)}: {errors.slice(0, 3).join('; ')}</div>
                </div>
              )}

              {stats.fresh > 0 && (
                <label className="flex items-start gap-2 p-3 rounded border border-bg-border bg-bg-hover/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={liveMode}
                    onChange={e => setLiveMode(e.target.checked)}
                    className="mt-0.5 accent-accent-green"
                  />
                  <div>
                    <div className="text-sm font-medium">Live mode — classify each trade now</div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      Each new trade triggers the Plan/Error + emotion modal and feeds the Behavior Engine
                      (pause / kill switch / recovery). Recommended when importing today's trades.
                    </div>
                  </div>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
                <button
                  onClick={confirmImport}
                  disabled={stats.fresh === 0}
                  className="px-4 py-2 text-sm bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {stats.fresh === 0
                    ? 'Nothing new to import'
                    : liveMode
                      ? `Import & classify ${stats.fresh} trade${stats.fresh === 1 ? '' : 's'}`
                      : `Import ${stats.fresh} new trade${stats.fresh === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}

          {stage === 'imported' && (
            <div className="text-center py-8 space-y-3">
              <div className="inline-flex p-3 bg-accent-green/10 rounded-full">
                <Check size={32} className="text-accent-green" />
              </div>
              <div className="text-lg font-semibold">Imported {stats.fresh} new trade{stats.fresh === 1 ? '' : 's'}</div>
              <div className="text-sm text-text-secondary">
                {fmtMoney(totalPnL)} net P&L · {stats.fills} fills
                {stats.dupes > 0 && <> · skipped {stats.dupes} duplicate{stats.dupes === 1 ? '' : 's'}</>}
              </div>
              <button onClick={onClose} className="mt-2 px-4 py-2 text-sm bg-accent-green text-bg rounded font-medium">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
