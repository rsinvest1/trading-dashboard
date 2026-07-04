import type { ReactNode } from 'react';

export function Card({
  title,
  action,
  children,
  className = ''
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/10 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Progress({
  value,
  color = 'bg-emerald-400'
}: {
  value: number;
  color?: string;
}) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function RangeField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
        {label}
        <strong className="text-sm tabular-nums text-slate-100">{value}/10</strong>
      </span>
      <input
        className="h-8 w-full cursor-pointer accent-emerald-400"
        type="range"
        min="0"
        max="10"
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
    </label>
  );
}
