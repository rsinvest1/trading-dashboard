import { Plus, Trash2 } from 'lucide-react';
import {
  initialTargetDollars, tradeRiskDollars, plannedR, realizedR,
  fmtMoney, fmtR
} from '../utils/calculations';

const uid = () => Math.random().toString(36).slice(2, 10);

function LevelRow({ level, onChange, onRemove, kind }) {
  function patch(p) { onChange({ ...level, ...p }); }
  const tone = kind === 'tp' ? 'text-accent-green' : 'text-accent-red';
  return (
    <div className="grid grid-cols-[28px_1fr_1fr_1fr_28px] gap-2 items-center">
      <span className={`text-[10px] font-mono uppercase tracking-wider ${tone}`}>
        {kind.toUpperCase()}
      </span>
      <input
        type="number"
        step="any"
        value={level.price ?? ''}
        onChange={e => patch({ price: e.target.value === '' ? null : Number(e.target.value) })}
        placeholder="Price"
        className="bg-bg border border-bg-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent-green/50"
      />
      <input
        type="number"
        step="1"
        min="0"
        value={level.contracts ?? ''}
        onChange={e => patch({ contracts: e.target.value === '' ? null : Number(e.target.value) })}
        placeholder="Qty"
        className="bg-bg border border-bg-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent-green/50"
      />
      <input
        type="number"
        step="1"
        min="0"
        max="100"
        value={level.percent ?? ''}
        onChange={e => patch({ percent: e.target.value === '' ? null : Number(e.target.value) })}
        placeholder="%"
        className="bg-bg border border-bg-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent-green/50"
      />
      <button
        onClick={onRemove}
        className="text-text-muted hover:text-accent-red"
        title="Remove level"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

export default function TpSlEditor({ trade, onUpdate }) {
  const tp = trade.tp_levels || [];
  const sl = trade.sl_levels || [];

  function setTp(next) { onUpdate({ tp_levels: next }); }
  function setSl(next) { onUpdate({ sl_levels: next }); }

  function addTp() { setTp([...tp, { id: uid(), price: null, contracts: null, percent: null }]); }
  function addSl() { setSl([...sl, { id: uid(), price: null, contracts: null, percent: null }]); }

  function patchTp(i, lvl) { const c = [...tp]; c[i] = lvl; setTp(c); }
  function patchSl(i, lvl) { const c = [...sl]; c[i] = lvl; setSl(c); }
  function removeTp(i) { setTp(tp.filter((_, idx) => idx !== i)); }
  function removeSl(i) { setSl(sl.filter((_, idx) => idx !== i)); }

  const target  = initialTargetDollars(trade);
  const risk    = tradeRiskDollars(trade);
  const pR      = plannedR(trade);
  const rR      = realizedR(trade);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">Exit Levels</div>
        <div className="flex gap-1">
          <button
            onClick={addTp}
            className="flex items-center gap-1 px-2 py-1 text-[11px] border border-accent-green/40 text-accent-green rounded hover:bg-accent-green/10"
          >
            <Plus size={11} /> TP
          </button>
          <button
            onClick={addSl}
            className="flex items-center gap-1 px-2 py-1 text-[11px] border border-accent-red/40 text-accent-red rounded hover:bg-accent-red/10"
          >
            <Plus size={11} /> SL
          </button>
        </div>
      </div>

      {(tp.length === 0 && sl.length === 0) ? (
        <div className="text-[11px] text-text-muted italic">
          Add TP or SL levels to compute Target, Risk, and R-multiple.
        </div>
      ) : (
        <div className="space-y-2">
          {tp.length > 0 && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[28px_1fr_1fr_1fr_28px] gap-2 px-1 text-[10px] uppercase tracking-wider text-text-muted">
                <span />
                <span>Price</span>
                <span>Qty</span>
                <span>%</span>
                <span />
              </div>
              {tp.map((lvl, i) => (
                <LevelRow
                  key={lvl.id || i}
                  level={lvl}
                  kind="tp"
                  onChange={l => patchTp(i, l)}
                  onRemove={() => removeTp(i)}
                />
              ))}
            </div>
          )}
          {sl.length > 0 && (
            <div className="space-y-1.5">
              {sl.map((lvl, i) => (
                <LevelRow
                  key={lvl.id || i}
                  level={lvl}
                  kind="sl"
                  onChange={l => patchSl(i, l)}
                  onRemove={() => removeSl(i)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {(target > 0 || risk > 0) && (
        <div className="grid grid-cols-2 gap-y-1 gap-x-4 pt-2 border-t border-bg-border text-xs font-mono">
          <span className="text-accent-green">Initial Target</span>
          <span className="text-right text-accent-green">{fmtMoney(target)}</span>

          <span className="text-accent-red">Trade Risk</span>
          <span className="text-right text-accent-red">{fmtMoney(-risk)}</span>

          <span className="text-text-secondary">Planned R-Multiple</span>
          <span className={`text-right ${pR == null ? 'text-text-muted' : pR >= 1 ? 'text-accent-green' : 'text-accent-yellow'}`}>
            {fmtR(pR)}
          </span>

          <span className="text-text-secondary">Realized R-Multiple</span>
          <span className={`text-right ${rR == null ? 'text-text-muted' : rR > 0 ? 'text-accent-green' : rR < 0 ? 'text-accent-red' : 'text-text-muted'}`}>
            {fmtR(rR)}
          </span>
        </div>
      )}
    </div>
  );
}
