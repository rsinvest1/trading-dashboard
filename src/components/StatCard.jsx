export default function StatCard({ label, value, sub, tone = 'neutral', mono = true }) {
  const toneCls =
    tone === 'pos' ? 'text-accent-green' :
    tone === 'neg' ? 'text-accent-red'   :
    'text-text-primary';
  return (
    <div className="card px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={`stat-value mt-1 ${toneCls} ${mono ? 'font-mono' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-text-secondary mt-1">{sub}</div>}
    </div>
  );
}
