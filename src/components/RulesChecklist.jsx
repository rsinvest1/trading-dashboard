import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { useStore } from '../store/useStore';

function RuleRow({ rule, checked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-start gap-2 w-full text-left text-xs py-1.5 px-1 rounded hover:bg-bg-hover/40 transition-colors"
    >
      <span
        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
          checked
            ? 'bg-accent-green border-accent-green text-bg'
            : 'border-bg-border'
        }`}
      >
        {checked && <Check size={10} strokeWidth={3} />}
      </span>
      <span className={checked ? 'text-text-primary' : 'text-text-secondary'}>
        {rule.text}
      </span>
    </button>
  );
}

export default function RulesChecklist({ trade, onUpdate }) {
  const strategies = useStore(s => s.strategies);

  const strategy = useMemo(
    () => strategies.find(p => p.id === trade.strategy_id) || null,
    [strategies, trade.strategy_id]
  );

  const followed = new Set(trade.rules_followed || []);

  function setStrategy(id) {
    onUpdate({ strategy_id: id || null, rules_followed: [] });
  }
  function toggleRule(ruleId) {
    const next = new Set(followed);
    if (next.has(ruleId)) next.delete(ruleId);
    else next.add(ruleId);
    onUpdate({ rules_followed: [...next] });
  }
  function checkAll() {
    if (!strategy) return;
    const all = [
      ...(strategy.entry_rules || []),
      ...(strategy.exit_rules  || [])
    ].map(r => r.id);
    onUpdate({ rules_followed: all });
  }

  const allRules  = strategy ? [...(strategy.entry_rules || []), ...(strategy.exit_rules || [])] : [];
  const total     = allRules.length;
  const followedCount = allRules.filter(r => followed.has(r.id)).length;
  const pct       = total ? (followedCount / total) * 100 : 0;

  return (
    <div className="space-y-3">
      <select
        value={trade.strategy_id || ''}
        onChange={e => setStrategy(e.target.value)}
        className="w-full bg-bg border border-bg-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent-green/50"
      >
        <option value="">— select strategy —</option>
        {strategies.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {strategies.length === 0 && (
        <div className="text-[11px] text-text-muted italic">
          No strategies yet. Create one on the Strategies page.
        </div>
      )}

      {strategy && (
        <>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-text-secondary">
                Rules followed
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-text-primary">{followedCount} / {total}</span>
                <button
                  onClick={checkAll}
                  className="text-[10px] uppercase tracking-wider text-accent-green hover:underline"
                >
                  Check all
                </button>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-border overflow-hidden">
              <div
                className="h-full bg-accent-green transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {(strategy.entry_rules?.length || 0) > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Entry criteria</div>
              <div className="space-y-0.5">
                {strategy.entry_rules.map(r => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    checked={followed.has(r.id)}
                    onToggle={() => toggleRule(r.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {(strategy.exit_rules?.length || 0) > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Exit criteria</div>
              <div className="space-y-0.5">
                {strategy.exit_rules.map(r => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    checked={followed.has(r.id)}
                    onToggle={() => toggleRule(r.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {strategy.description && (
            <div className="text-[11px] text-text-muted italic border-l-2 border-bg-border pl-2">
              {strategy.description}
            </div>
          )}
        </>
      )}
    </div>
  );
}
