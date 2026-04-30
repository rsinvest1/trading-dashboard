import { useStore } from '../store/useStore';

const COLOR_MAP = {
  green:  { active: 'bg-accent-green/20 text-accent-green border-accent-green/50',
            idle:   'border-bg-border text-text-secondary hover:border-accent-green/40' },
  red:    { active: 'bg-accent-red/20 text-accent-red border-accent-red/50',
            idle:   'border-bg-border text-text-secondary hover:border-accent-red/40' },
  yellow: { active: 'bg-accent-yellow/20 text-accent-yellow border-accent-yellow/50',
            idle:   'border-bg-border text-text-secondary hover:border-accent-yellow/40' },
  blue:   { active: 'bg-accent-blue/20 text-accent-blue border-accent-blue/50',
            idle:   'border-bg-border text-text-secondary hover:border-accent-blue/40' },
  muted:  { active: 'bg-bg-hover text-text-primary border-text-secondary/40',
            idle:   'border-bg-border text-text-secondary hover:border-text-secondary/40' }
};

export default function TagPicker({ value = {}, onChange }) {
  const categories = useStore(s => s.settings.tag_categories || []);

  function toggle(catId, tagId) {
    const current = new Set(value[catId] || []);
    if (current.has(tagId)) current.delete(tagId);
    else current.add(tagId);
    const next = { ...value, [catId]: [...current] };
    if (next[catId].length === 0) delete next[catId];
    onChange(next);
  }

  if (!categories.length) {
    return (
      <div className="text-[11px] text-text-muted italic">
        No tag categories configured. Add some in Settings → Tag Categories.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {categories.map(cat => {
        const colors = COLOR_MAP[cat.color] || COLOR_MAP.muted;
        const selected = new Set(value[cat.id] || []);
        return (
          <div key={cat.id}>
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
              {cat.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(cat.tags || []).length === 0 ? (
                <span className="text-[10px] text-text-muted italic">no tags yet</span>
              ) : (
                cat.tags.map(tag => {
                  const active = selected.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggle(cat.id, tag.id)}
                      className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
                        active ? colors.active : colors.idle
                      }`}
                    >
                      {tag.label}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
